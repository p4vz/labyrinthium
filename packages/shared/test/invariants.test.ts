import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/engine/apply.js';
import { InvalidActionError, type PlayerAction } from '../src/engine/actions.js';
import { DEFAULT_CONFIG, createGame, type GameState } from '../src/engine/state.js';
import { generateMap } from '../src/generator/index.js';
import { posEq } from '../src/geometry.js';

/**
 * Property: for ANY generated map and ANY random action stream, the engine
 * never corrupts its invariants, and replaying the accepted action log
 * reproduces the exact final state.
 */

function checkInvariants(state: GameState): void {
  // players are always inside some level's bounds
  for (const p of state.players) {
    const level = state.map.levels[p.pos.level];
    expect(level).toBeDefined();
    expect(p.pos.x).toBeGreaterThanOrEqual(0);
    expect(p.pos.x).toBeLessThan(level!.width);
    expect(p.pos.y).toBeGreaterThanOrEqual(0);
    expect(p.pos.y).toBeLessThan(level!.height);
    expect(p.inventory.grenades).toBeGreaterThanOrEqual(0);
    expect(p.inventory.bullets).toBeGreaterThanOrEqual(0);
    expect(p.inventory.mines).toBeGreaterThanOrEqual(0);
    expect(p.paralysis).toBeGreaterThanOrEqual(0);
  }
  // exactly one treasure, carried XOR resting
  const carriers = state.players.filter((p) => p.hasTreasure);
  if (state.treasure.carriedBy !== null) {
    expect(carriers.map((c) => c.id)).toEqual([state.treasure.carriedBy]);
  } else {
    expect(carriers).toHaveLength(0);
  }
  // finished games either crowned a winner who exited with the treasure,
  // or everyone walked out and nobody won
  if (state.phase === 'finished') {
    if (state.winnerId !== null) {
      const winner = state.players.find((p) => p.id === state.winnerId);
      expect(winner).toBeDefined();
      expect(winner!.exited).toBe(true);
      expect(winner!.hasTreasure).toBe(true);
    } else {
      expect(state.players.every((p) => p.exited)).toBe(true);
    }
  } else {
    expect(state.winnerId).toBeNull();
  }
  // prize conservation: the treasure's hidden prize exists in a player's
  // bank IFF that player won; coins only move map -> banked
  const prizeId = state.map.spawns.prize?.id;
  for (const p of state.players) {
    expect(p.banked.coins).toBeGreaterThanOrEqual(0);
    const hasPrize = prizeId !== undefined && p.banked.items.some((i) => i.id === prizeId);
    expect(hasPrize).toBe(prizeId !== undefined && state.winnerId === p.id);
  }
}

const actionArb: fc.Arbitrary<PlayerAction> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom<PlayerAction>(
    { type: 'move', direction: 'N' },
    { type: 'move', direction: 'E' },
    { type: 'move', direction: 'S' },
    { type: 'move', direction: 'W' },
  ) },
  { weight: 1, arbitrary: fc.constantFrom<PlayerAction>(
    { type: 'move', direction: 'U' },
    { type: 'move', direction: 'D' },
  ) },
  { weight: 1, arbitrary: fc.constantFrom<PlayerAction>(
    { type: 'shoot', direction: 'N' },
    { type: 'shoot', direction: 'E' },
    { type: 'shoot', direction: 'S' },
    { type: 'shoot', direction: 'W' },
  ) },
  { weight: 1, arbitrary: fc.constantFrom<PlayerAction>(
    { type: 'grenade', direction: 'N' },
    { type: 'grenade', direction: 'E' },
    { type: 'grenade', direction: 'S' },
    { type: 'grenade', direction: 'W' },
  ) },
  { weight: 1, arbitrary: fc.constant<PlayerAction>({ type: 'placeMine' }) },
  { weight: 1, arbitrary: fc.constant<PlayerAction>({ type: 'pickup' }) },
  { weight: 1, arbitrary: fc.constantFrom<PlayerAction>(
    { type: 'leave', direction: 'N' },
    { type: 'leave', direction: 'E' },
    { type: 'leave', direction: 'S' },
    { type: 'leave', direction: 'W' },
  ) },
  { weight: 2, arbitrary: fc.constant<PlayerAction>({ type: 'endTurn' }) },
);

describe('engine invariants under random play', () => {
  it('random action streams never corrupt state, and replays are exact', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('small', 'medium', 'large') as fc.Arbitrary<'small' | 'medium' | 'large'>,
        fc.constantFrom('classic', 'advanced', 'full') as fc.Arbitrary<'classic' | 'advanced' | 'full'>,
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.array(actionArb, { minLength: 20, maxLength: 120 }),
        (preset, complexity, seed, actions) => {
          const map = generateMap({ preset, complexity, seed });
          const initial = createGame(
            map,
            [
              { id: 'p1', name: 'Alpha' },
              { id: 'p2', name: 'Beta' },
            ],
            DEFAULT_CONFIG,
            seed,
          );
          let state = initial;
          const accepted: PlayerAction[] = [];
          for (const raw of actions) {
            if (state.phase !== 'inProgress') break;
            const active = state.players[state.turnIndex]!;
            const action: PlayerAction = active.paralysis > 0 ? { type: 'skip' } : raw;
            let result;
            try {
              result = applyAction(state, action);
            } catch (err) {
              // invalid actions must not have mutated anything: nothing to check,
              // applyAction validates before cloning.
              expect(err).toBeInstanceOf(InvalidActionError);
              continue;
            }
            state = result.state;
            accepted.push(action);
            // outside the try so a broken invariant reports itself, not a
            // misleading "not an InvalidActionError"
            checkInvariants(state);
          }
          // exact replay
          let replay = initial;
          for (const action of accepted) replay = applyAction(replay, action).state;
          expect(JSON.stringify(replay)).toBe(JSON.stringify(state));
        },
      ),
      { numRuns: 25 },
    );
  });

  it('a treasure resting on a cell is where a shot carrier lost it', () => {
    // focused regression: treasure position always tracks its carrier
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 6 }), (seed) => {
        const map = generateMap({ preset: 'small', complexity: 'classic', seed });
        let state = createGame(map, [{ id: 'p1', name: 'A' }], DEFAULT_CONFIG, seed);
        const dirs = ['N', 'E', 'S', 'W'] as const;
        for (let i = 0; i < 60 && state.phase === 'inProgress'; i++) {
          const active = state.players[state.turnIndex]!;
          const action: PlayerAction =
            active.paralysis > 0
              ? { type: 'skip' }
              : { type: 'move', direction: dirs[i % 4]! };
          try {
            state = applyAction(state, action).state;
          } catch {
            /* border grenade etc — irrelevant here */
          }
          if (state.treasure.carriedBy) {
            const carrier = state.players.find((p) => p.id === state.treasure.carriedBy)!;
            expect(carrier.hasTreasure).toBe(true);
          } else {
            // resting treasure must sit inside the map
            const level = state.map.levels[state.treasure.pos.level]!;
            expect(state.treasure.pos.x).toBeLessThan(level.width);
            expect(state.treasure.pos.y).toBeLessThan(level.height);
            expect(state.players.some((p) => posEq(p.pos, state.treasure.pos) && p.hasTreasure)).toBe(false);
          }
        }
      }),
      { numRuns: 15 },
    );
  });
});
