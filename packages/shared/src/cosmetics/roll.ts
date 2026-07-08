import type { Rng } from '../rng.js';
import { RARITIES, type CosmeticItem, type Rarity } from './items.js';
import { PALETTES, TEMPLATES, type CosmeticTemplate } from './catalog.js';
import { rollName } from './names.js';

/** Baseline drop odds; specialized pools (deep rares, shop) pass their own. */
export const RARITY_WEIGHTS: Record<Rarity, number> = {
  common: 60,
  uncommon: 25,
  rare: 11,
  epic: 3.5,
  legendary: 0.5,
};

const RARITY_ORDER: Record<Rarity, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
};

export function rarityAtLeast(a: Rarity, b: Rarity): boolean {
  return RARITY_ORDER[a] >= RARITY_ORDER[b];
}

export function rollRarity(rng: Rng, weights: Record<Rarity, number> = RARITY_WEIGHTS): Rarity {
  const total = RARITIES.reduce((s, r) => s + weights[r], 0);
  let roll = rng.next() * total;
  for (const r of RARITIES) {
    roll -= weights[r];
    if (roll < 0) return r;
  }
  return 'common';
}

const PALETTE_IDS = Object.keys(PALETTES);

/** Deterministic 8-hex-byte id drawn from the rng (dedupes re-farmed seeds). */
function rollId(rng: Rng): string {
  let id = '';
  for (let i = 0; i < 8; i++) id += rng.int(256).toString(16).padStart(2, '0');
  return id;
}

export interface RollCosmeticOpts {
  rarity?: Rarity;
  slot?: CosmeticTemplate['slot'];
  mapSeed?: string;
}

/**
 * Roll one cosmetic item: template (gated so its minRarity fits the rolled
 * rarity), palette, grammar name, deterministic id. All randomness flows
 * through the caller's Rng — same rng state, byte-identical item.
 */
export function rollCosmetic(rng: Rng, opts: RollCosmeticOpts = {}): CosmeticItem {
  const rarity = opts.rarity ?? rollRarity(rng);
  let pool = TEMPLATES.filter((t) => rarityAtLeast(rarity, t.minRarity));
  if (opts.slot) pool = pool.filter((t) => t.slot === opts.slot);
  if (pool.length === 0) {
    // A slot/rarity combination with no fitting silhouette (e.g. a common
    // roll in a slot whose templates are all gated) falls back to slot-only.
    pool = TEMPLATES.filter((t) => (opts.slot ? t.slot === opts.slot : true));
  }
  const template = rng.pick(pool);
  const paletteId = rng.pick(PALETTE_IDS);
  const name = rollName(rng, template, rarity);
  return {
    id: rollId(rng),
    slot: template.slot,
    templateId: template.id,
    rarity,
    paletteId,
    name,
    ...(opts.mapSeed !== undefined ? { provenance: { mapSeed: opts.mapSeed } } : {}),
  };
}

/** Roll a dye item: unlocks a palette for any equipped piece. */
export function rollDye(rng: Rng, rarity: Rarity = 'uncommon'): CosmeticItem {
  const paletteId = rng.pick(PALETTE_IDS);
  const pretty = paletteId.charAt(0).toUpperCase() + paletteId.slice(1);
  return {
    id: rollId(rng),
    slot: 'dye',
    templateId: `dye-${paletteId}`,
    rarity,
    paletteId,
    name: `${pretty} Dye`,
  };
}
