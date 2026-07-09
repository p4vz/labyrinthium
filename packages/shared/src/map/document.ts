import { z } from 'zod';
import type { Coord, Pos } from '../geometry.js';
import { cosmeticItemSchema } from '../cosmetics/items.js';
import type { EdgeGrid } from './grid.js';

export const MIN_SIZE = 3;
export const MAX_SIZE = 15;
export const MAX_LEVELS = 5;

export const coordSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

export const posSchema = coordSchema.extend({
  level: z.number().int().min(0),
});

const edgeStateSchema = z.enum(['open', 'wall', 'reinforced', 'grate', 'exit']);

export const edgeGridSchema = z.object({
  width: z.number().int().min(MIN_SIZE).max(MAX_SIZE),
  height: z.number().int().min(MIN_SIZE).max(MAX_SIZE),
  h: z.array(edgeStateSchema),
  v: z.array(edgeStateSchema),
});

/**
 * Map elements are a discriminated union — THE extension point of the whole
 * game. Future elements (pit, fakeTreasure, bearTrap, key, door, ...) are
 * added as new variants here plus one behavior module in engine/features;
 * the core engine never changes.
 */
export const mapFeatureSchema = z.discriminatedUnion('type', [
  // Ordered cells; flow runs cells[i] -> cells[i+1]. Last cell is the mouth.
  z.object({ type: z.literal('river'), cells: z.array(coordSchema).min(2) }),
  // twoWay teleports are stored as two mirrored one-step entries. `label`
  // is the visible rune on the pad (pair #1, #2, ...) — both ends share it.
  z.object({
    type: z.literal('teleport'),
    at: coordSchema,
    target: posSchema,
    mode: z.enum(['oneWay', 'twoWay']),
    label: z.number().int().min(1).max(99).optional(),
  }),
  // Bidirectional; a mirrored entry must exist on the target level.
  z.object({ type: z.literal('stairs'), at: coordSchema, to: posSchema }),
  // One-way drop; target level must be exactly one below.
  z.object({ type: z.literal('trapdoor'), at: coordSchema, to: posSchema }),
  // Pre-baked mine. Player-placed mines live in GameState, not the document.
  z.object({ type: z.literal('mine'), at: coordSchema }),
  // Single-use trap; springs once, then inert forever.
  z.object({ type: z.literal('trap'), at: coordSchema, paralysis: z.number().int().min(1).max(10) }),
  // Aesthetic loot (zero gameplay effect). Coins bank instantly on pickup.
  z.object({ type: z.literal('coins'), at: coordSchema, amount: z.number().int().min(1).max(500) }),
]);

export type MapFeature = z.infer<typeof mapFeatureSchema>;

export const monsterAISchema = z.enum(['wanderer', 'patroller', 'hunter']);
export type MonsterAI = z.infer<typeof monsterAISchema>;

export const monsterSpawnSchema = z.object({
  at: posSchema,
  ai: monsterAISchema,
  route: z.array(coordSchema).optional(),
  scentRadius: z.number().int().min(1).max(30).optional(),
});
export type MonsterSpawn = z.infer<typeof monsterSpawnSchema>;

export const levelDocumentSchema = z.object({
  width: z.number().int().min(MIN_SIZE).max(MAX_SIZE),
  height: z.number().int().min(MIN_SIZE).max(MAX_SIZE),
  edges: edgeGridSchema,
  features: z.array(mapFeatureSchema),
});
export type LevelDocument = z.infer<typeof levelDocumentSchema>;

/** Versioned map document — the unit the editor and generator both produce. */
export const mapDocumentSchema = z.object({
  version: z.literal(1),
  levels: z.array(levelDocumentSchema).min(1).max(MAX_LEVELS),
  entrance: posSchema, // always level 0, on the border ring
  spawns: z.object({
    treasure: posSchema,
    /** the ONE prize item hidden inside the treasure (one item, one color),
     * rolled at bake time; the winner receives it on escaping */
    prize: cosmeticItemSchema.optional(),
    monsters: z.array(monsterSpawnSchema),
  }),
  metadata: z.object({
    name: z.string().max(120).optional(),
    seed: z.string().max(120).optional(),
    difficulty: z.number().min(1).max(10).optional(),
    author: z.string().max(120).optional(),
  }),
});
export type MapDocument = z.infer<typeof mapDocumentSchema>;

// Narrow re-exported types so engine code can use the structural interfaces.
export type { Coord, Pos, EdgeGrid };

export function levelOf(map: MapDocument, index: number): LevelDocument {
  const level = map.levels[index];
  if (!level) throw new Error(`level ${index} out of range (map has ${map.levels.length})`);
  return level;
}

export function featuresAt(level: LevelDocument, c: Coord): MapFeature[] {
  return level.features.filter((f) => {
    if (f.type === 'river') return f.cells.some((rc) => rc.x === c.x && rc.y === c.y);
    return f.at.x === c.x && f.at.y === c.y;
  });
}

/** For a river covering cell c, the next cell downstream (null at the mouth). */
export function riverNext(river: Extract<MapFeature, { type: 'river' }>, c: Coord): Coord | null {
  const i = river.cells.findIndex((rc) => rc.x === c.x && rc.y === c.y);
  if (i === -1 || i === river.cells.length - 1) return null;
  return river.cells[i + 1]!;
}
