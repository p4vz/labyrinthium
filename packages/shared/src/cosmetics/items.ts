import { z } from 'zod';

/**
 * Cosmetic loot: purely aesthetic items collected in labyrinths and worn by
 * the player's persistent avatar. Nothing here may ever influence gameplay.
 */

export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export const raritySchema = z.enum(RARITIES);
export type Rarity = z.infer<typeof raritySchema>;

/** rare and above must be carried out of the labyrinth to be kept */
export function isRarePlus(rarity: Rarity): boolean {
  return rarity === 'rare' || rarity === 'epic' || rarity === 'legendary';
}

export const cosmeticSlotSchema = z.enum(['hat', 'outfit', 'trinket', 'dye']);
export type CosmeticSlot = z.infer<typeof cosmeticSlotSchema>;

/**
 * Where an item came from. `mapSeed` is baked at map generation; the rest is
 * added server-side at banking time (never inside the engine — a wall-clock
 * date in GameState would break deterministic replays).
 */
export const provenanceSchema = z
  .object({
    mapSeed: z.string().max(120).optional(),
    /** ISO date the item was banked (server-added) */
    foundOn: z.string().optional(),
    /** true when a rare+ item was carried out of the labyrinth alive */
    extractedAlive: z.boolean().optional(),
    gameId: z.string().optional(),
  })
  .optional();

export const cosmeticItemSchema = z.object({
  /** deterministic hex id drawn from the generation RNG (dedupes re-farmed seeds) */
  id: z.string().min(1).max(40),
  slot: cosmeticSlotSchema,
  /** must exist in the catalog */
  templateId: z.string().min(1),
  rarity: raritySchema,
  /** palette/dye ramp applied to the template's bitmap */
  paletteId: z.string().min(1),
  /** grammar-generated display name, e.g. "Tattered Hood of the Drowned Hall" */
  name: z.string().min(1).max(120),
  provenance: provenanceSchema,
});
export type CosmeticItem = z.infer<typeof cosmeticItemSchema>;

const equippedPieceSchema = z.object({
  templateId: z.string().min(1),
  paletteId: z.string().min(1),
});
export type EquippedPiece = z.infer<typeof equippedPieceSchema>;

/**
 * Everything needed to RENDER a player's avatar. Sent over the wire so other
 * players can see the look; never trusted for ownership (the server validates
 * equips against the profile's item list).
 */
export const avatarConfigSchema = z.object({
  skinToneId: z.string().min(1),
  hat: equippedPieceSchema.optional(),
  outfit: equippedPieceSchema.optional(),
  trinket: equippedPieceSchema.optional(),
});
export type AvatarConfig = z.infer<typeof avatarConfigSchema>;

export const DEFAULT_AVATAR: AvatarConfig = { skinToneId: 'skin-2' };
