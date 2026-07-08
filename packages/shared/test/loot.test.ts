import { describe, expect, it } from 'vitest';
import { InvalidActionError } from '../src/engine/actions.js';
import type { MapFeature } from '../src/map/document.js';
import { openLevel, payloadTypes, playScript, startGame, testItem, testMap, turn } from './fixtures.js';

/**
 * The cosmetics loot layer: scooping, carrying, dropping, and the `leave`
 * extraction action. Loot is aesthetic-only — these tests also pin that it
 * never costs an action or changes movement.
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

describe('loot scooping', () => {
  it('banks a common cosmetic the moment it is walked over', () => {
    const map = lootMap([{ feature: { type: 'cosmetic', at: { x: 1, y: 0 }, item: testItem() } }]);
    const r = turn(startGame(map), { type: 'move', direction: 'E' });
    expect(payloadTypes(r.events)).toContain('cosmeticFound');
    expect(r.state.players[0]!.banked.items.map((i) => i.id)).toEqual(['itm-test-1']);
    expect(r.state.players[0]!.carriedRares).toEqual([]);
    expect(r.state.groundCosmetics).toEqual([]);
  });

  it('banks coins instantly', () => {
    const map = lootMap([{ feature: { type: 'coins', at: { x: 1, y: 0 }, amount: 12 } }]);
    const r = turn(startGame(map), { type: 'move', direction: 'E' });
    expect(payloadTypes(r.events)).toContain('coinsFound');
    expect(r.state.players[0]!.banked.coins).toBe(12);
    expect(r.state.coinPiles).toEqual([]);
  });

  it('a rare is carried, not banked', () => {
    const rare = testItem({ id: 'itm-rare', rarity: 'rare', name: 'Gilded Straw Hat of the Deep' });
    const map = lootMap([{ feature: { type: 'cosmetic', at: { x: 1, y: 0 }, item: rare } }]);
    const r = turn(startGame(map), { type: 'move', direction: 'E' });
    expect(payloadTypes(r.events)).toContain('rareLootFound');
    expect(r.state.players[0]!.carriedRares.map((i) => i.id)).toEqual(['itm-rare']);
    expect(r.state.players[0]!.banked.items).toEqual([]);
  });

  it('a paralyzed arrival cannot scoop; the next able visitor can', () => {
    const map = lootMap([
      { feature: { type: 'cosmetic', at: { x: 1, y: 0 }, item: testItem() } },
      { feature: { type: 'mine', at: { x: 1, y: 0 } } },
    ]);
    let state = startGame(map, 2);
    // p1 steps onto the mined loot cell: mine fires first, no scoop
    let r = turn(state, { type: 'move', direction: 'E' });
    expect(payloadTypes(r.events)).toContain('mineTriggered');
    expect(payloadTypes(r.events)).not.toContain('cosmeticFound');
    expect(r.state.groundCosmetics).toHaveLength(1);
    // p2 walks over the (now spent) mine cell and scoops
    r = turn(r.state, { type: 'move', direction: 'E' });
    expect(payloadTypes(r.events)).toContain('cosmeticFound');
    expect(r.state.players[1]!.banked.items).toHaveLength(1);
  });
});

describe('carried rares at risk', () => {
  it('drop on the carrier tile when shot, and can be stolen', () => {
    const rare = testItem({ id: 'itm-rare', rarity: 'rare' });
    const map = lootMap([{ feature: { type: 'cosmetic', at: { x: 1, y: 0 }, item: rare } }]);
    let state = startGame(map, 2);
    // p1 grabs the rare at (1,0)
    state = turn(state, { type: 'move', direction: 'E' }).state;
    // p2 (still at 0,0) shoots east down the row and hits p1
    const shot = turn(state, { type: 'shoot', direction: 'E' });
    expect(payloadTypes(shot.events)).toContain('rareLootDropped');
    expect(shot.state.players[0]!.carriedRares).toEqual([]);
    expect(shot.state.groundCosmetics.map((g) => ({ ...g.pos }))).toEqual([{ level: 0, x: 1, y: 0 }]);
    // p2 ends the turn (shooting keeps it open), p1 skips paralyzed x3,
    // then p2 walks onto the dropped rare and claims it
    const r = playScript(shot.state, [
      { type: 'endTurn' }, // p2
      { type: 'endTurn' }, // p1 paralyzed skip
      { type: 'move', direction: 'E' }, // p2 -> (1,0), scoops
    ]);
    expect(r.state.players[1]!.carriedRares.map((i) => i.id)).toEqual(['itm-rare']);
    expect(r.state.groundCosmetics).toEqual([]);
  });

  it('drop when a mine goes off under the carrier', () => {
    const rare = testItem({ id: 'itm-rare', rarity: 'epic' });
    const map = lootMap([
      { feature: { type: 'cosmetic', at: { x: 1, y: 0 }, item: rare } },
      { feature: { type: 'mine', at: { x: 2, y: 0 } } },
    ]);
    const r = playScript(startGame(map), [
      { type: 'move', direction: 'E' }, // grab rare
      { type: 'move', direction: 'E' }, // step on mine
    ]);
    expect(payloadTypes(r.events)).toContain('rareLootDropped');
    expect(r.state.groundCosmetics[0]!.pos).toEqual({ level: 0, x: 2, y: 0 });
  });
});

describe('leave (extraction)', () => {
  it('banks carried rares, forfeits the race, and the game continues', () => {
    const rare = testItem({ id: 'itm-rare', rarity: 'rare' });
    const map = lootMap([{ feature: { type: 'cosmetic', at: { x: 1, y: 0 }, item: rare } }]);
    let state = startGame(map, 2);
    state = turn(state, { type: 'move', direction: 'E' }).state; // p1 grabs rare
    state = turn(state, { type: 'endTurn' }).state; // p2 passes
    state = turn(state, { type: 'move', direction: 'E' }).state; // p1 -> (2,0)
    state = turn(state, { type: 'endTurn' }).state; // p2 passes
    const r = turn(state, { type: 'leave', direction: 'E' });
    const types = payloadTypes(r.events);
    expect(types).toContain('rareLootBanked');
    expect(types).toContain('leftLabyrinth');
    expect(types).toContain('playerLeft');
    const p1 = r.state.players[0]!;
    expect(p1.exited).toBe(true);
    expect(p1.banked.items.map((i) => i.id)).toEqual(['itm-rare']);
    expect(p1.carriedRares).toEqual([]);
    expect(r.state.phase).toBe('inProgress'); // p2 plays on
    expect(r.state.players[r.state.turnIndex]!.id).toBe('p2');
  });

  it('leaving while holding the treasure is simply winning', () => {
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      treasure: { level: 0, x: 1, y: 0 },
      exits: [{ at: { x: 2, y: 0 }, dir: 'E' }],
    });
    const r = playScript(startGame(map), [
      { type: 'move', direction: 'E' }, // onto the treasure cell
      { type: 'pickup' },
      { type: 'move', direction: 'E' }, // -> (2,0)
      { type: 'leave', direction: 'E' },
    ]);
    expect(payloadTypes(r.events)).toContain('gameWon');
    expect(r.state.winnerId).toBe('p1');
    expect(r.state.phase).toBe('finished');
  });

  it('when everyone walks out the game ends with no winner', () => {
    const map = lootMap();
    const r = playScript(startGame(map, 2), [
      { type: 'move', direction: 'E' }, // p1
      { type: 'move', direction: 'E' }, // p2
      { type: 'move', direction: 'E' }, // p1 -> (2,0)
      { type: 'move', direction: 'E' }, // p2 -> (2,0)
      { type: 'leave', direction: 'E' }, // p1 out
      { type: 'leave', direction: 'E' }, // p2 out -> game over
    ]);
    expect(payloadTypes(r.events)).toContain('gameEndedNoWinner');
    expect(r.state.phase).toBe('finished');
    expect(r.state.winnerId).toBeNull();
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

  it('a loser still carrying a rare inside when someone wins simply loses it', () => {
    const rare = testItem({ id: 'itm-rare', rarity: 'legendary' });
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      treasure: { level: 0, x: 0, y: 1 },
      exits: [{ at: { x: 2, y: 0 }, dir: 'E' }],
      features: [{ feature: { type: 'cosmetic', at: { x: 1, y: 0 }, item: rare } }],
    });
    const r = playScript(startGame(map, 2), [
      { type: 'move', direction: 'E' }, // p1 -> (1,0): carries the rare, then loiters
      { type: 'move', direction: 'S' }, // p2 -> (0,1): the treasure cell
      { type: 'endTurn' }, // p1
      { type: 'pickup' }, // p2 lifts the treasure (turn stays open)
      { type: 'move', direction: 'N' }, // p2 -> (0,0)
      { type: 'endTurn' }, // p1
      { type: 'move', direction: 'E' }, // p2 -> (1,0)
      { type: 'endTurn' }, // p1
      { type: 'move', direction: 'E' }, // p2 -> (2,0)
      { type: 'endTurn' }, // p1
      { type: 'move', direction: 'E' }, // p2 walks the exit with the treasure: wins
    ]);
    expect(r.state.phase).toBe('finished');
    expect(r.state.winnerId).toBe('p2');
    const loser = r.state.players[0]!;
    expect(loser.carriedRares.map((i) => i.id)).toEqual(['itm-rare']); // never extracted
    expect(loser.banked.items).toEqual([]);
    expect(r.state.groundCosmetics).toEqual([]);
  });

  it('the winner banks carried rares on the way out', () => {
    const rare = testItem({ id: 'itm-rare', rarity: 'rare' });
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      treasure: { level: 0, x: 1, y: 0 },
      exits: [{ at: { x: 2, y: 0 }, dir: 'E' }],
      features: [{ feature: { type: 'cosmetic', at: { x: 2, y: 0 }, item: rare } }],
    });
    const r = playScript(startGame(map), [
      { type: 'move', direction: 'E' }, // onto the treasure cell
      { type: 'pickup' },
      { type: 'move', direction: 'E' }, // -> (2,0): scoops the rare en route
      { type: 'move', direction: 'E' }, // exit: win + bank
    ]);
    expect(r.state.winnerId).toBe('p1');
    expect(payloadTypes(r.events)).toContain('rareLootBanked');
    expect(r.state.players[0]!.banked.items.map((i) => i.id)).toEqual(['itm-rare']);
  });
});
