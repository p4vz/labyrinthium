import { describe, expect, it } from 'vitest';
import { InvalidActionError } from '../src/engine/actions.js';
import type { MapFeature } from '../src/map/document.js';
import { openLevel, payloadTypes, playScript, startGame, testItem, testMap, turn } from './fixtures.js';

/**
 * The aesthetic loot layer: coin piles scooped on the floor, and the ONE
 * prize item hidden inside the treasure — revealed only to the winner.
 * Loot never costs an action and never changes movement.
 */

/** 3x3 open arena, entrance (0,0), treasure (2,2), exit east of (2,0). */
function lootMap(features: { level?: number; feature: MapFeature }[] = []) {
  return testMap({
    levels: [openLevel(3, 3)],
    entrance: { level: 0, x: 0, y: 0 },
    treasure: { level: 0, x: 2, y: 2 },
    exits: [{ at: { x: 2, y: 0 }, dir: 'E' }],
    features,
  });
}

describe('coin scooping', () => {
  it('banks coins instantly', () => {
    const map = lootMap([{ feature: { type: 'coins', at: { x: 1, y: 0 }, amount: 12 } }]);
    const r = turn(startGame(map), { type: 'move', direction: 'E' });
    expect(payloadTypes(r.events)).toContain('coinsFound');
    expect(r.state.players[0]!.banked.coins).toBe(12);
    expect(r.state.coinPiles).toEqual([]);
  });

  it('a paralyzed arrival cannot scoop; the next able visitor can', () => {
    const map = lootMap([
      { feature: { type: 'coins', at: { x: 1, y: 0 }, amount: 5 } },
      { feature: { type: 'mine', at: { x: 1, y: 0 } } },
    ]);
    let state = startGame(map, 2);
    // p1 steps onto the mined coin cell: the mine fires first, no scoop
    let r = turn(state, { type: 'move', direction: 'E' });
    expect(payloadTypes(r.events)).toContain('mineTriggered');
    expect(payloadTypes(r.events)).not.toContain('coinsFound');
    expect(r.state.coinPiles).toHaveLength(1);
    // p2 walks over the (now spent) mine cell and scoops
    r = turn(r.state, { type: 'move', direction: 'E' });
    expect(payloadTypes(r.events)).toContain('coinsFound');
    expect(r.state.players[1]!.banked.coins).toBe(5);
  });
});

describe('the prize hidden in the treasure', () => {
  const prize = testItem({ id: 'itm-prize', rarity: 'rare', name: 'Gilded Straw Hat of the Deep' });

  it('is awarded to the winner at the moment of escape — never before', () => {
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      treasure: { level: 0, x: 1, y: 0 },
      prize,
      exits: [{ at: { x: 2, y: 0 }, dir: 'E' }],
    });
    let state = startGame(map);
    state = turn(state, { type: 'move', direction: 'E' }).state; // onto the treasure cell
    state = turn(state, { type: 'pickup' }).state; // lift it (action; turn stays open)
    // carrying the treasure does NOT hand over the prize
    expect(state.players[0]!.banked.items).toEqual([]);
    state = turn(state, { type: 'move', direction: 'E' }).state; // -> (2,0)
    const win = turn(state, { type: 'move', direction: 'E' }); // out through the exit
    const types = payloadTypes(win.events);
    expect(types).toContain('gameWon');
    expect(types).toContain('prizeFound');
    expect(win.state.players[0]!.banked.items.map((i) => i.id)).toEqual(['itm-prize']);
  });

  it('a game with no prize baked in simply awards nothing', () => {
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      treasure: { level: 0, x: 1, y: 0 },
      exits: [{ at: { x: 2, y: 0 }, dir: 'E' }],
    });
    const r = playScript(startGame(map), [
      { type: 'move', direction: 'E' },
      { type: 'pickup' },
      { type: 'move', direction: 'E' },
      { type: 'move', direction: 'E' },
    ]);
    expect(payloadTypes(r.events)).toContain('gameWon');
    expect(payloadTypes(r.events)).not.toContain('prizeFound');
    expect(r.state.players[0]!.banked.items).toEqual([]);
  });

  it('nobody gets the prize when everyone walks out without the treasure', () => {
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      treasure: { level: 0, x: 2, y: 2 },
      prize,
      exits: [{ at: { x: 2, y: 0 }, dir: 'E' }],
    });
    const r = playScript(startGame(map, 2), [
      { type: 'move', direction: 'E' }, // p1
      { type: 'move', direction: 'E' }, // p2
      { type: 'move', direction: 'E' }, // p1 -> (2,0)
      { type: 'move', direction: 'E' }, // p2 -> (2,0)
      { type: 'leave', direction: 'E' }, // p1 out
      { type: 'leave', direction: 'E' }, // p2 out -> game over
    ]);
    expect(payloadTypes(r.events)).toContain('gameEndedNoWinner');
    expect(payloadTypes(r.events)).not.toContain('prizeFound');
    expect(r.state.players.every((p) => p.banked.items.length === 0)).toBe(true);
  });
});

describe('leave (walking out)', () => {
  it('forfeits the race; banked coins stay banked; the game continues', () => {
    const map = lootMap([{ feature: { type: 'coins', at: { x: 1, y: 0 }, amount: 7 } }]);
    let state = startGame(map, 2);
    state = turn(state, { type: 'move', direction: 'E' }).state; // p1 scoops
    state = turn(state, { type: 'endTurn' }).state; // p2 passes
    state = turn(state, { type: 'move', direction: 'E' }).state; // p1 -> (2,0)
    state = turn(state, { type: 'endTurn' }).state; // p2 passes
    const r = turn(state, { type: 'leave', direction: 'E' });
    const types = payloadTypes(r.events);
    expect(types).toContain('leftLabyrinth');
    expect(types).toContain('playerLeft');
    const p1 = r.state.players[0]!;
    expect(p1.exited).toBe(true);
    expect(p1.banked.coins).toBe(7);
    expect(r.state.phase).toBe('inProgress'); // p2 plays on
    expect(r.state.players[r.state.turnIndex]!.id).toBe('p2');
  });

  it('leaving while holding the treasure is simply winning (prize included)', () => {
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      treasure: { level: 0, x: 1, y: 0 },
      prize: testItem({ id: 'itm-prize', rarity: 'epic' }),
      exits: [{ at: { x: 2, y: 0 }, dir: 'E' }],
    });
    const r = playScript(startGame(map), [
      { type: 'move', direction: 'E' }, // onto the treasure cell
      { type: 'pickup' },
      { type: 'move', direction: 'E' }, // -> (2,0)
      { type: 'leave', direction: 'E' },
    ]);
    expect(payloadTypes(r.events)).toContain('gameWon');
    expect(payloadTypes(r.events)).toContain('prizeFound');
    expect(r.state.winnerId).toBe('p1');
    expect(r.state.players[0]!.banked.items.map((i) => i.id)).toEqual(['itm-prize']);
    expect(r.state.phase).toBe('finished');
  });

  it('rejects leave with no exit edge, without consuming the turn', () => {
    const state = startGame(lootMap());
    expect(() => turn(state, { type: 'leave', direction: 'N' })).toThrowError(InvalidActionError);
    try {
      turn(state, { type: 'leave', direction: 'N' });
    } catch (err) {
      expect((err as InvalidActionError).code).toBe('NO_EXIT_THERE');
    }
    // still p1's turn — nothing was consumed
    expect(state.turnIndex).toBe(0);
  });

  it('rejects leave when the house rule is off', () => {
    let state = startGame(lootMap(), 1, { allowLeave: false });
    state = playScript(state, [
      { type: 'move', direction: 'E' },
      { type: 'move', direction: 'E' },
    ]).state;
    try {
      turn(state, { type: 'leave', direction: 'E' });
      expect.unreachable('leave should have thrown');
    } catch (err) {
      expect((err as InvalidActionError).code).toBe('LEAVING_DISABLED');
    }
  });
});
