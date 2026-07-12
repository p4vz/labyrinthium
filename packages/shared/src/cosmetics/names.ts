import type { Rng } from '../rng.js';
import type { Rarity } from './items.js';
import type { CosmeticTemplate } from './catalog.js';

/**
 * Item names come from a slot grammar: [Condition] [Base] of the [Origin].
 * Rarity gates how many slots are filled — commons are just the base label,
 * legendaries carry a fixed epithet — so the name itself telegraphs rarity
 * and bakes a little provenance into every drop.
 */

export const CONDITIONS = [
  'Dusty',
  'Tattered',
  'Moss-grown',
  'Waterlogged',
  'Scorched',
  'Patched',
  'Crooked',
  'Weathered',
  'Cobwebbed',
  'Rat-gnawed',
  'Faded',
  'Torchlit',
  'Polished',
  'Gilded',
  'Rune-etched',
  'Ancient',
] as const;

/** Fancier condition pool for epic rolls. */
export const EPIC_CONDITIONS = [
  'Gilded',
  'Rune-etched',
  'Ancient',
  'Moonlit',
  'Kingly',
  'Shadow-stitched',
  'Ever-burning',
  'Depth-touched',
] as const;

export const ORIGINS = [
  'of the Deep',
  'of the First Maze',
  'of the Drowned Hall',
  'of the North Gate',
  'of the Long Dark',
  'of the Minotaur',
  'of the Broken Stair',
  'of the Nine Corridors',
  'of the Silent River',
  'of the Old Warden',
  'of the Buried Court',
  'of the Last Torch',
  'of the Grinning Grate',
  'of the Forgotten Exit',
] as const;

export function rollName(rng: Rng, template: CosmeticTemplate, rarity: Rarity): string {
  switch (rarity) {
    case 'common':
      return template.label;
    case 'uncommon':
      return `${rng.pick(CONDITIONS)} ${template.label}`;
    case 'rare':
      return `${rng.pick(CONDITIONS)} ${template.label} ${rng.pick(ORIGINS)}`;
    case 'epic':
      return `${rng.pick(EPIC_CONDITIONS)} ${template.label} ${rng.pick(ORIGINS)}`;
    case 'legendary':
      return template.legendaryName ?? `${template.label} of Legend`;
  }
}
