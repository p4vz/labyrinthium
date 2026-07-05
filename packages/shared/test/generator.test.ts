import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { generateMap, validateMap } from '../src/generator/index.js';
import type { Complexity, SizePreset } from '../src/map/presets.js';
import { mapDocumentSchema } from '../src/map/document.js';

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
        expect(level.features.every((f) => f.type === 'river' || f.type === 'teleport')).toBe(true);
        expect(level.edges.h.every((e) => e !== 'reinforced')).toBe(true);
        expect(level.edges.v.every((e) => e !== 'reinforced')).toBe(true);
      }
      expect(map.spawns.monsters.every((m) => m.ai === 'wanderer')).toBe(true);
    }
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
