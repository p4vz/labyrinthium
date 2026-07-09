import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/engine/apply.js';
import { createGame, DEFAULT_CONFIG } from '../src/engine/state.js';
import type { PlayerAction } from '../src/engine/actions.js';
import { deliver, driveGame, makeBrain, seededRng } from './aiHarness.js';
import { openLevel, testMap } from './fixtures.js';

describe('planner: exploit what you know', () => {
  it('walks the treasure straight out of a known exit', () => {
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      exits: [{ at: { x: 0, y: 0 }, dir: 'N' }],
      treasure: { level: 0, x: 2, y: 2 },
    });
    const r = driveGame({ map, brains: { p1: { tier: 'hard' } }, maxTurns: 60 });
    expect(r.illegalActions).toEqual([]);
    expect(r.won).toBe(true);
    // straight there and straight back is ~8 moves; leave probing slack
    expect(r.turns).toBeLessThan(40);
  });

  it('grenades through a sealed wall when nothing else is left to test', () => {
    // column 0 is walled off from the rest of the level: the only way to the
    // treasure is to blast through
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      exits: [{ at: { x: 0, y: 0 }, dir: 'N' }],
      treasure: { level: 0, x: 2, y: 2 },
      walls: [
        { at: { x: 0, y: 0 }, dir: 'E' },
        { at: { x: 0, y: 1 }, dir: 'E' },
        { at: { x: 0, y: 2 }, dir: 'E' },
      ],
    });
    const r = driveGame({
      map,
      brains: { p1: { tier: 'hard' } },
      maxTurns: 100,
      config: { startingInventory: { grenades: 2, bullets: 1, mines: 0 } },
    });
    expect(r.illegalActions).toEqual([]);
    expect(r.won).toBe(true);
    expect(r.state.players[0]!.inventory.grenades).toBeLessThan(2);
  });

  it('reinforced walls are learned from a wasted grenade and never re-attacked', () => {
    // same sealed column, but the northern two walls are reinforced; only
    // the southernmost is breakable
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      exits: [{ at: { x: 0, y: 0 }, dir: 'N' }],
      treasure: { level: 0, x: 2, y: 2 },
      walls: [
        { at: { x: 0, y: 0 }, dir: 'E', state: 'reinforced' },
        { at: { x: 0, y: 1 }, dir: 'E', state: 'reinforced' },
        { at: { x: 0, y: 2 }, dir: 'E' },
      ],
    });
    const r = driveGame({
      map,
      brains: { p1: { tier: 'hard' } },
      maxTurns: 150,
      config: { startingInventory: { grenades: 4, bullets: 1, mines: 0 } },
    });
    expect(r.illegalActions).toEqual([]);
    expect(r.won).toBe(true);
  });
});

describe('expert: opponent inference from table-talk', () => {
  it('shoots the treasure carrier down a charted corridor', () => {
    const map = testMap({
      levels: [openLevel(3, 3)],
      entrance: { level: 0, x: 0, y: 0 },
      exits: [{ at: { x: 0, y: 0 }, dir: 'N' }],
      treasure: { level: 0, x: 2, y: 0 },
    });
    const players = [
      { id: 'p1', name: 'Expert' },
      { id: 'p2', name: 'Runner' },
    ];
    let state = createGame(
      map,
      players,
      { ...DEFAULT_CONFIG, startingInventory: { grenades: 1, bullets: 2, mines: 1 } },
      'shoot-test',
    );
    const brain = makeBrain(map, state, 'p1', 'expert', seededRng(1));
    const play = (action: PlayerAction): void => {
      const r = applyAction(state, action);
      state = r.state;
      deliver(brain, 'p1', state, r.events);
    };
    // p1 charts the northern corridor and returns to the entrance;
    // p2 walks the same corridor and lifts the treasure at its end
    play({ type: 'move', direction: 'E' }); // p1 -> (1,0)
    play({ type: 'move', direction: 'E' }); // p2 -> (1,0)
    play({ type: 'move', direction: 'E' }); // p1 -> (2,0), sees the treasure
    play({ type: 'move', direction: 'E' }); // p2 -> (2,0)
    play({ type: 'move', direction: 'W' }); // p1 -> (1,0)
    play({ type: 'pickup' }); // p2 lifts the loot — announced at the table
    play({ type: 'endTurn' }); // p2 holds position
    play({ type: 'move', direction: 'W' }); // p1 -> (0,0)
    play({ type: 'endTurn' }); // p2 again holds
    // p1's turn: the carrier sits two cells east down a known-open corridor
    brain.noteTurn(state.turnNumber);
    const action = brain.decide(true);
    expect(action).toEqual({ type: 'shoot', direction: 'E' });
    play(action);
    const p2 = state.players[1]!;
    expect(p2.paralysis).toBeGreaterThan(0);
    expect(p2.hasTreasure).toBe(false);
  });

  it('an expert beats an idler to the treasure in a fair maze', () => {
    const map = testMap({
      levels: [openLevel(4, 4)],
      entrance: { level: 0, x: 0, y: 0 },
      exits: [{ at: { x: 0, y: 0 }, dir: 'W' }],
      treasure: { level: 0, x: 3, y: 3 },
    });
    const r = driveGame({
      map,
      players: 2,
      brains: { p2: { tier: 'expert' } },
      maxTurns: 120,
    });
    expect(r.won).toBe(true);
    expect(r.state.winnerId).toBe('p2');
  });
});
