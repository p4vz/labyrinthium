import { z } from 'zod';

export const sizePresetSchema = z.enum(['small', 'medium', 'large']);
export type SizePreset = z.infer<typeof sizePresetSchema>;

/**
 * Complexity is a second axis on top of size:
 *   classic  — the original game: 1 layer, no mines/traps/reinforced walls,
 *              wanderer monsters only, one-way teleports only
 *   advanced — everything unlocked in moderation
 *   full     — everything, dialed up
 */
export const complexitySchema = z.enum(['classic', 'advanced', 'full']);
export type Complexity = z.infer<typeof complexitySchema>;

export interface GeneratorParams {
  minSize: number;
  maxSize: number;
  layerRange: [number, number];
  braidFactor: number;
  /** share of interior walls promoted to reinforced (indestructible) */
  reinforcedShare: number;
  riverCount: [number, number];
  /** river length as a fraction of the level's cell count */
  riverLengthFactor: number;
  grateChance: number;
  oneWayTeleports: [number, number];
  twoWayTeleportPairs: [number, number];
  monsterCount: [number, number];
  monsterAIs: readonly ('wanderer' | 'patroller' | 'hunter')[];
  mineCount: [number, number];
  trapCount: [number, number];
  trapdoorCount: [number, number];
  exitCount: number;
  /** starting inventory per player */
  inventory: { grenades: number; bullets: number; mines: number };
  /** aesthetic loot (all complexities — the meta-layer feeds from every game) */
  coinPileCount: [number, number];
  coinPileValue: [number, number];
  /** shallow common/uncommon cosmetic drops, banked on pickup */
  cosmeticCount: [number, number];
  /** deep-placed rare+ cosmetics that must be carried out alive */
  deepRareCount: [number, number];
}

const SIZE_BASE: Record<SizePreset, Omit<GeneratorParams, 'layerRange' | 'reinforcedShare' | 'mineCount' | 'trapCount' | 'trapdoorCount' | 'monsterAIs' | 'twoWayTeleportPairs' | 'deepRareCount'>> = {
  small: {
    minSize: 3,
    maxSize: 5,
    braidFactor: 0.2,
    riverCount: [0, 1],
    riverLengthFactor: 0.2,
    grateChance: 0,
    oneWayTeleports: [0, 1],
    monsterCount: [0, 0],
    exitCount: 1,
    inventory: { grenades: 1, bullets: 1, mines: 0 },
    coinPileCount: [1, 2],
    coinPileValue: [5, 20],
    cosmeticCount: [1, 2],
  },
  medium: {
    minSize: 6,
    maxSize: 9,
    braidFactor: 0.35,
    riverCount: [1, 1],
    riverLengthFactor: 0.15,
    grateChance: 0.3,
    oneWayTeleports: [1, 1],
    monsterCount: [1, 1],
    exitCount: 1,
    inventory: { grenades: 2, bullets: 2, mines: 1 },
    coinPileCount: [2, 3],
    coinPileValue: [5, 20],
    cosmeticCount: [2, 3],
  },
  large: {
    minSize: 10,
    maxSize: 15,
    braidFactor: 0.5,
    riverCount: [2, 2],
    riverLengthFactor: 0.12,
    grateChance: 0.4,
    oneWayTeleports: [1, 2],
    monsterCount: [1, 2],
    exitCount: 2,
    inventory: { grenades: 3, bullets: 3, mines: 2 },
    coinPileCount: [3, 5],
    coinPileValue: [5, 20],
    cosmeticCount: [3, 4],
  },
};

export function generatorParams(preset: SizePreset, complexity: Complexity): GeneratorParams {
  const base = SIZE_BASE[preset];
  switch (complexity) {
    case 'classic':
      return {
        ...base,
        layerRange: [1, 1],
        reinforcedShare: 0,
        twoWayTeleportPairs: [0, 0],
        mineCount: [0, 0],
        trapCount: [0, 0],
        trapdoorCount: [0, 0],
        monsterAIs: ['wanderer'],
        inventory: { ...base.inventory, mines: 0 },
        deepRareCount: [0, 1],
      };
    case 'advanced':
      return {
        ...base,
        layerRange: preset === 'small' ? [1, 1] : [1, 2],
        reinforcedShare: 0.05,
        twoWayTeleportPairs: [0, 1],
        mineCount: preset === 'small' ? [0, 0] : [1, 1],
        trapCount: preset === 'small' ? [0, 0] : [1, 1],
        trapdoorCount: preset === 'small' ? [0, 0] : [0, 1],
        monsterAIs: ['wanderer', 'patroller'],
        deepRareCount: [1, 1],
      };
    case 'full':
      return {
        ...base,
        layerRange: preset === 'small' ? [1, 2] : preset === 'medium' ? [2, 2] : [2, 3],
        reinforcedShare: 0.1,
        twoWayTeleportPairs: [1, 1],
        mineCount: preset === 'small' ? [1, 1] : [2, 2],
        trapCount: preset === 'small' ? [1, 1] : [2, 2],
        trapdoorCount: [1, 2],
        monsterAIs: ['wanderer', 'patroller', 'hunter'],
        deepRareCount: [1, 2],
      };
  }
}
