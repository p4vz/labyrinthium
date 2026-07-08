import { Rng } from '../rng.js';
import type { CosmeticItem, Rarity } from './items.js';
import { rollCosmetic, rollDye } from './roll.js';

/**
 * The wardrobe shop: a rotating daily stock, deterministic from the UTC date
 * string. The server is the authority (it recomputes the stock to validate a
 * purchase); the client renders the same list as a preview. Coins only —
 * strictly aesthetic.
 */

export interface ShopOffer {
  offerId: string;
  item: CosmeticItem;
  price: number;
}

export const RARITY_PRICES: Record<Rarity, number> = {
  common: 30,
  uncommon: 80,
  rare: 200,
  epic: 500,
  legendary: 1200,
};

/** 6 offers per UTC day: 3 commons (one per slot), 1 uncommon, 1 rare, 1 dye. */
export function dailyShopStock(dateISO: string): ShopOffer[] {
  const rng = Rng.fromSeed(`shop:${dateISO}`);
  const items: CosmeticItem[] = [
    rollCosmetic(rng, { rarity: 'common', slot: 'hat' }),
    rollCosmetic(rng, { rarity: 'common', slot: 'outfit' }),
    rollCosmetic(rng, { rarity: 'common', slot: 'trinket' }),
    rollCosmetic(rng, { rarity: 'uncommon' }),
    rollCosmetic(rng, { rarity: 'rare' }),
    rollDye(rng),
  ];
  return items.map((item, i) => ({
    offerId: `${dateISO}:${i}`,
    item,
    price: RARITY_PRICES[item.rarity],
  }));
}
