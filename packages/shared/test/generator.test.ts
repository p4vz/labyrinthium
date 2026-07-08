import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { generateMap, validateMap } from '../src/generator/index.js';
import { generatorParams, type Complexity, type SizePreset } from '../src/map/presets.js';
import { mapDocumentSchema } from '../src/map/document.js';
import { cosmeticItemSchema, isRarePlus, rollCosmetic } from '../src/cosmetics/index.js';
import { Rng } from '../src/rng.js';

const presets: SizePreset[] = ['small', 'medium', 'large'];
const complexities: Complexity[] = ['classic', 'advanced', 'full'];

describe('map generator', () => {
  it('every generated map passes cross-layer validation (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...presets),
        fc.constantFrom(...complexities),
        fc.string({ minLength: 1, maxLength: 16 }),
        (preset, complexity, seed) => {
          const map = generateMap({ preset, complexity, seed });
          const result = validateMap(map);
          expect(result.issues).toEqual([]);
          expect(mapDocumentSchema.safeParse(map).success).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('the same seed yields a byte-identical document (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...presets),
        fc.constantFrom(...complexities),
        fc.string({ minLength: 1, maxLength: 16 }),
        (preset, complexity, seed) => {
          const a = generateMap({ preset, complexity, seed });
          const b = generateMap({ preset, complexity, seed });
          expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        },
      ),
      { numRuns: 20 },
    );
  });

  it('classic complexity keeps the original game: one layer, no extras', () => {
    for (const preset of presets) {
      const map = generateMap({ preset, complexity: 'classic', seed: 'classic-check' });
      expect(map.levels).toHaveLength(1);
      for (const level of map.levels) {
        // aesthetic loot is allowed everywhere — it changes nothing about play
        expect(
          level.features.every(
            (f) => f.type === 'river' || f.type === 'teleport' || f.type === 'coins' || f.type === 'cosmetic',
          ),
        ).toBe(true);
        expect(level.edges.h.every((e) => e !== 'reinforced')).toBe(true);
        expect(level.edges.v.every((e) => e !== 'reinforced')).toBe(true);
      }
      expect(map.spawns.monsters.every((m) => m.ai === 'wanderer')).toBe(true);
    }
  });

  it('places aesthetic loot within preset ranges, deep rares rare+ (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...presets),
        fc.constantFrom(...complexities),
        fc.string({ minLength: 1, maxLength: 16 }),
        (preset, complexity, seed) => {
          const map = generateMap({ preset, complexity, seed });
          const params = generatorParams(preset, complexity);
          const features = map.levels.flatMap((l) => l.features);
          const coins = features.filter((f) => f.type === 'coins');
          const cosmetics = features.filter((f) => f.type === 'cosmetic');
          expect(coins.length).toBeLessThanOrEqual(params.coinPileCount[1]);
          expect(cosmetics.length).toBeLessThanOrEqual(params.cosmeticCount[1] + params.deepRareCount[1]);
          for (const c of coins) {
            expect(c.amount).toBeGreaterThanOrEqual(params.coinPileValue[0]);
            expect(c.amount).toBeLessThanOrEqual(params.coinPileValue[1]);
          }
          const rares = cosmetics.filter((f) => isRarePlus(f.item.rarity));
          expect(rares.length).toBeLessThanOrEqual(params.deepRareCount[1]);
          for (const c of cosmetics) {
            expect(c.item.provenance?.mapSeed).toBe(seed);
            cosmeticItemSchema.parse(c.item);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it('a medium/advanced map reliably carries loot including a deep rare', () => {
    const map = generateMap({ preset: 'medium', complexity: 'advanced', seed: 'loot-check' });
    const features = map.levels.flatMap((l) => l.features);
    expect(features.some((f) => f.type === 'coins')).toBe(true);
    const cosmetics = features.filter((f) => f.type === 'cosmetic');
    expect(cosmetics.length).toBeGreaterThan(0);
    expect(cosmetics.some((f) => isRarePlus(f.item.rarity))).toBe(true);
  });

  it('flags loot placed on a hazard cell (editor guard)', () => {
    const map = generateMap({ preset: 'small', complexity: 'classic', seed: 'hazard-guard' });
    const item = rollCosmetic(Rng.fromSeed('x'), { rarity: 'common' });
    // drop a cosmetic onto the entrance's teleport-free cell, then add a trap under it
    const at = { x: map.entrance.x, y: map.entrance.y };
    map.levels[0]!.features.push({ type: 'cosmetic', at, item });
    map.levels[0]!.features.push({ type: 'trap', at, paralysis: 2 });
    const result = validateMap(map);
    expect(result.issues.some((i) => i.code === 'LOOT_ON_HAZARD')).toBe(true);
  });

  it('a pre-loot v1 map document still parses (schema evolution)', () => {
    const map = generateMap({ preset: 'small', complexity: 'classic', seed: 'old-doc' });
    const stripped = {
      ...map,
      levels: map.levels.map((l) => ({
        ...l,
        features: l.features.filter((f) => f.type !== 'coins' && f.type !== 'cosmetic'),
      })),
    };
    const reparsed = mapDocumentSchema.safeParse(JSON.parse(JSON.stringify(stripped)));
    expect(reparsed.success).toBe(true);
  });

  it('respects size bounds and puts the entrance on the border of level 0', () => {
    for (const preset of presets) {
      const map = generateMap({ preset, complexity: 'full', seed: `bounds-${preset}` });
      for (const level of map.levels) {
        expect(level.width).toBeGreaterThanOrEqual(3);
        expect(level.width).toBeLessThanOrEqual(15);
        expect(level.height).toBeGreaterThanOrEqual(3);
        expect(level.height).toBeLessThanOrEqual(15);
      }
      const l0 = map.levels[0]!;
      const e = map.entrance;
      expect(e.level).toBe(0);
      expect(
        e.x === 0 || e.y === 0 || e.x === l0.width - 1 || e.y === l0.height - 1,
      ).toBe(true);
    }
  });

  it('difficulty is scored 1..10', () => {
    for (const preset of presets) {
      for (const complexity of complexities) {
        const map = generateMap({ preset, complexity, seed: 'diff' });
        expect(map.metadata.difficulty).toBeGreaterThanOrEqual(1);
        expect(map.metadata.difficulty).toBeLessThanOrEqual(10);
      }
    }
  });
});
