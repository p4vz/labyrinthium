import { describe, expect, it } from 'vitest';
import { generateMap } from '../src/generator/index.js';
import { driveGame, seededRng } from './aiHarness.js';

/**
 * Whole-system checks on real generated labyrinths.
 *
 * Hard guarantees, asserted on EVERY game:
 *  - decide() only ever produces legal actions;
 *  - whenever the brain is confident about its absolute position, it is
 *    right — on every single turn (merges are guarded and rolled back
 *    when reality contradicts them, so confidence is never a lie).
 *
 * Strength, asserted statistically: the solo bot finishes most games well
 * inside the turn budget. (Not all: a river-moated treasure plus exhausted
 * grenades can genuinely wall a game off — human players stall on those
 * too, and in multiplayer somebody else ends the game first.)
 */
describe('bayesian bot on generated maps', () => {
  const fast = [
    { preset: 'small', complexity: 'classic', seed: 'ai-a', maxTurns: 400 },
    { preset: 'small', complexity: 'classic', seed: 'ai-b', maxTurns: 400 },
    { preset: 'medium', complexity: 'classic', seed: 's7', maxTurns: 400 },
    { preset: 'medium', complexity: 'advanced', seed: 's2', maxTurns: 600 },
    { preset: 'medium', complexity: 'advanced', seed: 's4', maxTurns: 600 },
    { preset: 'medium', complexity: 'full', seed: 's7', maxTurns: 800 },
    { preset: 'medium', complexity: 'full', seed: 's8', maxTurns: 800 },
  ] as const;

  for (const c of fast) {
    it(`hard bot wins ${c.preset}/${c.complexity} seed=${c.seed}, legally and truthfully`, () => {
      const map = generateMap({ preset: c.preset, complexity: c.complexity, seed: c.seed });
      const r = driveGame({
        map,
        brains: { p1: { tier: 'hard', rng: seededRng(17) } },
        maxTurns: c.maxTurns,
        seed: `g-${c.seed}`,
      });
      expect(r.illegalActions).toEqual([]);
      expect(r.mislocalizations).toBe(0);
      expect(r.localizedChecks).toBeGreaterThan(0);
      expect(r.won).toBe(true);
    });
  }

  it('sweep: sound on every board, wins the clear majority (advanced x10)', () => {
    let wins = 0;
    for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10']) {
      const map = generateMap({ preset: 'medium', complexity: 'advanced', seed });
      const r = driveGame({
        map,
        brains: { p1: { tier: 'hard', rng: seededRng(17) } },
        maxTurns: 1500,
        seed: `g-${seed}`,
      });
      // soundness is unconditional…
      expect(r.illegalActions).toEqual([]);
      expect(r.mislocalizations).toBe(0);
      if (r.won) wins++;
    }
    // …strength is statistical (8/10 at the time of writing)
    expect(wins).toBeGreaterThanOrEqual(6);
  }, 120000);

  it('expert vs hard on one board: someone wins, both stay truthful', () => {
    const map = generateMap({ preset: 'medium', complexity: 'advanced', seed: 'ai-duel' });
    const r = driveGame({
      map,
      brains: {
        p1: { tier: 'hard', rng: seededRng(23) },
        p2: { tier: 'expert', rng: seededRng(29) },
      },
      maxTurns: 2000,
      seed: 'game-duel',
    });
    expect(r.illegalActions).toEqual([]);
    expect(r.mislocalizations).toBe(0);
    expect(r.won).toBe(true);
  });

  it('is deterministic: same seeds, same game, same outcome', () => {
    const map = generateMap({ preset: 'medium', complexity: 'advanced', seed: 'ai-det' });
    const run = (): { turns: number; winner: string | null } => {
      const r = driveGame({
        map,
        brains: { p1: { tier: 'hard', rng: seededRng(41) } },
        maxTurns: 1500,
        seed: 'game-det',
      });
      return { turns: r.turns, winner: r.state.winnerId };
    };
    expect(run()).toEqual(run());
  });
});
