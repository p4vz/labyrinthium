import type { CosmeticSlot, Rarity } from './items.js';

/**
 * The finite content catalog: every cosmetic drop is one of these templates
 * plus a palette and a generated name. A small fixed catalog is what makes
 * the collection log ("hats 7/12") reachable; variety comes from dyes and
 * names, not from unbounded silhouettes.
 *
 * Bitmap format (same procedural pixel-art approach as PixelLogo): each row
 * is exactly 16 chars; `y` is the row the bitmap starts on inside the 16x16
 * avatar frame. Chars: '0' transparent, '1'..'4' = palette ramp index from
 * darkest/outline to highlight. Layers paint in order body -> outfit ->
 * trinket -> hat, later layers overpainting earlier ones.
 */
export interface CosmeticTemplate {
  id: string;
  slot: Exclude<CosmeticSlot, 'dye'>;
  label: string;
  /** the lowest rarity this silhouette can drop at */
  minRarity: Rarity;
  /** themed set id (see SETS) */
  set?: string;
  /** fixed name used when the item rolls legendary */
  legendaryName?: string;
  y: number;
  rows: string[];
}

/** 4-color ramps, darkest/outline -> highlight. Keyed by palette id. */
export const PALETTES: Record<string, [string, string, string, string]> = {
  amber: ['#5a3a10', '#a05f13', '#e0902e', '#f7c46a'],
  arcane: ['#3f2f66', '#6a4fa8', '#b39ddb', '#d9c9f2'],
  moss: ['#22331d', '#3f5c33', '#7dc981', '#b9e6b3'],
  rust: ['#4a1f14', '#8a4426', '#c56a3a', '#e8a06a'],
  bone: ['#4a4234', '#8a7d63', '#cfc0a0', '#efe6cc'],
  river: ['#173447', '#2b5f7e', '#58a6d8', '#a8d4ee'],
  soot: ['#0d0a08', '#2a2119', '#46392b', '#6e5a41'],
  gold: ['#6b4a0e', '#b8860b', '#e8c547', '#fff0a8'],
  verdigris: ['#1f3d38', '#2e6b5e', '#4faf98', '#a3ded0'],
  blood: ['#3d0f12', '#7a1f24', '#c23b3b', '#e58a7a'],
  sandstone: ['#5c4a2e', '#9c7f4e', '#cfae72', '#ecd9ae'],
  midnight: ['#0b0e1f', '#1d2547', '#39518f', '#7288c9'],
  pearl: ['#6e6a75', '#a8a3b0', '#d8d4de', '#f4f2f7'],
  ember: ['#4a1206', '#963511', '#e0602e', '#ffb46a'],
};

/** Palettes anyone may equip without owning a dye. */
export const FREE_PALETTES = ['soot', 'rust', 'moss', 'sandstone'] as const;

/** Skin ramps — always free, picked in the wardrobe. */
export const SKIN_TONES: Record<string, [string, string, string, string]> = {
  'skin-1': ['#7a5138', '#e6b48c', '#f0cba6', '#f9e2c4'],
  'skin-2': ['#6b4630', '#d9a06e', '#e8bd8c', '#f4d8b0'],
  'skin-3': ['#5a3826', '#c08552', '#d8a670', '#eac794'],
  'skin-4': ['#4a2c1c', '#9c6238', '#b97f4e', '#d49e6c'],
  'skin-5': ['#3a2114', '#7a4526', '#96603a', '#b47e52'],
  'skin-6': ['#2a1710', '#57301a', '#714428', '#8f5c3a'],
};

/** The naked 16x16 body every avatar starts from (colored by skin tone). */
export const BODY_BITMAP: { y: number; rows: string[] } = {
  y: 2,
  rows: [
    '0000011111100000', // crown of the head
    '0000122222210000',
    '0000122222210000',
    '0000121221210000', // eyes
    '0000122222210000',
    '0000012222100000', // chin
    '0000122222210000', // shoulders
    '0001222222221000', // arms out
    '0001222222221000',
    '0000122222210000',
    '0000122222210000', // hips
    '0000122002210000', // legs
    '0000122002210000',
    '0000111001110000', // feet
  ],
};

export const HATS: CosmeticTemplate[] = [
  {
    id: 'miners-helm',
    slot: 'hat',
    label: "Miner's Helm",
    minRarity: 'common',
    set: 'delver',
    legendaryName: 'The First Delver’s Lamp',
    y: 0,
    rows: [
      '0000011111100000',
      '0000122222210000',
      '0000122442210000', // headlamp
      '0001111111111000', // brim
    ],
  },
  {
    id: 'wizard-hood',
    slot: 'hat',
    label: 'Wizard Hood',
    minRarity: 'common',
    set: 'arcanist',
    legendaryName: 'Hood of the Last Archmage',
    y: 0,
    rows: [
      '0000000110000000',
      '0000001221000000',
      '0000012222100000',
      '0000122222210000',
      '0001222222221000',
    ],
  },
  {
    id: 'rusted-crown',
    slot: 'hat',
    label: 'Rusted Crown',
    minRarity: 'rare',
    set: 'royal',
    legendaryName: 'Crown of the Maze King',
    y: 1,
    rows: ['0000020220200000', '0000122222210000'],
  },
  {
    id: 'gravekeepers-cowl',
    slot: 'hat',
    label: "Gravekeeper's Cowl",
    minRarity: 'common',
    set: 'gravekeeper',
    legendaryName: 'Cowl of the Silent Warden',
    y: 0,
    rows: [
      '0000011111100000',
      '0000122222210000',
      '0001222222221000',
      '0001220000221000',
      '0001210000121000',
    ],
  },
  {
    id: 'horned-helm',
    slot: 'hat',
    label: 'Horned Helm',
    minRarity: 'legendary',
    set: 'minotaur',
    legendaryName: "The Minotaur's Own Horns",
    y: 0,
    rows: [
      '0011000000001100',
      '0011011111101100',
      '0001122222211000',
      '0000122222210000',
    ],
  },
  {
    id: 'torchbearers-band',
    slot: 'hat',
    label: "Torchbearer's Band",
    minRarity: 'common',
    legendaryName: 'Band of the Undying Flame',
    y: 1,
    rows: ['0000000440000000', '0000000340000000', '0000124222210000'],
  },
  {
    id: 'cartographers-cap',
    slot: 'hat',
    label: "Cartographer's Cap",
    minRarity: 'common',
    set: 'cartographer',
    legendaryName: 'Cap of the Mapmaker Royal',
    y: 1,
    rows: ['0000011111100000', '0000122222210000', '0000111111111100'],
  },
  {
    id: 'rogues-bandana',
    slot: 'hat',
    label: "Rogue's Bandana",
    minRarity: 'common',
    set: 'rogue',
    legendaryName: 'Bandana of the Unseen Hand',
    y: 2,
    rows: ['0000122222210000', '0000122222212000'],
  },
  {
    id: 'plumed-helm',
    slot: 'hat',
    label: 'Plumed Helm',
    minRarity: 'rare',
    set: 'royal',
    legendaryName: 'Plume of the Royal Line',
    y: 0,
    rows: [
      '0003300000000000',
      '0003311111100000',
      '0000122222210000',
      '0000122222210000',
    ],
  },
  {
    id: 'fishers-hood',
    slot: 'hat',
    label: "Fisher's Hood",
    minRarity: 'common',
    set: 'river-folk',
    legendaryName: 'Hood of the River Mother',
    y: 0,
    rows: [
      '0000001111000000',
      '0000012222100000',
      '0000122222210000',
      '0001222222221000',
    ],
  },
  {
    id: 'bone-circlet',
    slot: 'hat',
    label: 'Bone Circlet',
    minRarity: 'uncommon',
    set: 'gravekeeper',
    legendaryName: 'Circlet of the First Buried',
    y: 3,
    rows: ['0000132323210000'],
  },
  {
    id: 'straw-hat',
    slot: 'hat',
    label: 'Straw Hat',
    minRarity: 'common',
    legendaryName: 'The Scarecrow’s Sunday Best',
    y: 1,
    rows: ['0000012222100000', '0011111111111100'],
  },
];

export const OUTFITS: CosmeticTemplate[] = [
  {
    id: 'pit-overalls',
    slot: 'outfit',
    label: 'Pit Overalls',
    minRarity: 'common',
    set: 'delver',
    legendaryName: 'Overalls of the Deep Seam',
    y: 8,
    rows: [
      '0000002002000000', // straps
      '0000122222210000',
      '0000122222210000',
      '0000122222210000',
      '0000122222210000',
      '0000122002210000',
      '0000122002210000',
      '0000111001110000',
    ],
  },
  {
    id: 'runed-robe',
    slot: 'outfit',
    label: 'Runed Robe',
    minRarity: 'common',
    set: 'arcanist',
    legendaryName: 'Robe of the Hundred Wards',
    y: 8,
    rows: [
      '0000122222210000',
      '0001222222221000',
      '0001222422221000', // rune
      '0000122222210000',
      '0000122222210000',
      '0000122222210000', // robe covers the legs
      '0000122222210000',
      '0000111111110000',
    ],
  },
  {
    id: 'tattered-cloak',
    slot: 'outfit',
    label: 'Tattered Cloak',
    minRarity: 'common',
    set: 'gravekeeper',
    legendaryName: 'Shroud of the Mourning Watch',
    y: 8,
    rows: [
      '0001222222221000',
      '0001222222221000',
      '0000122222210000',
      '0000122222210000',
      '0000122222210000',
      '0000120220210000', // tatters
      '0000102002010000',
    ],
  },
  {
    id: 'royal-doublet',
    slot: 'outfit',
    label: 'Royal Doublet',
    minRarity: 'rare',
    set: 'royal',
    legendaryName: 'Doublet of the Maze King',
    y: 8,
    rows: [
      '0000122222210000',
      '0001322222231000', // puffed shoulders
      '0001222442221000', // gold buttons
      '0000122442210000',
      '0000122222210000',
      '0000122002210000',
      '0000122002210000',
      '0000111001110000',
    ],
  },
  {
    id: 'bullhide-harness',
    slot: 'outfit',
    label: 'Bull-hide Harness',
    minRarity: 'epic',
    set: 'minotaur',
    legendaryName: 'Harness of the Labyrinth Bull',
    y: 9,
    rows: [
      '0000020000200000', // crossed straps
      '0000002002000000',
      '0000000220000000', // buckle
      '0000002002000000',
      '0000122002210000',
      '0000122002210000',
    ],
  },
  {
    id: 'oiled-coat',
    slot: 'outfit',
    label: 'Oiled Coat',
    minRarity: 'common',
    set: 'river-folk',
    legendaryName: 'Coat of the Drowned Ferryman',
    y: 8,
    rows: [
      '0000122222210000',
      '0001222222221000',
      '0001222222221000',
      '0000122122210000', // seam
      '0000122122210000',
      '0000122122210000',
      '0000121021210000', // split hem
    ],
  },
  {
    id: 'scout-leathers',
    slot: 'outfit',
    label: 'Scout Leathers',
    minRarity: 'common',
    set: 'rogue',
    legendaryName: 'Leathers of the Long Dark',
    y: 8,
    rows: [
      '0000122222210000', // sleeveless
      '0000122222210000',
      '0000122222210000',
      '0000133333310000', // belt
      '0000122222210000',
      '0000122002210000',
      '0000122002210000',
      '0000111001110000',
    ],
  },
  {
    id: 'surveyors-vest',
    slot: 'outfit',
    label: "Surveyor's Vest",
    minRarity: 'common',
    set: 'cartographer',
    legendaryName: 'Vest of a Thousand Corridors',
    y: 8,
    rows: [
      '0000122002210000', // open front
      '0000122002210000',
      '0000132002310000', // pockets
      '0000122002210000',
      '0000122222210000',
    ],
  },
  {
    id: 'quilted-gambeson',
    slot: 'outfit',
    label: 'Quilted Gambeson',
    minRarity: 'common',
    legendaryName: 'Gambeson of the Old Guard',
    y: 8,
    rows: [
      '0000122222210000',
      '0001223223221000', // quilting
      '0001232232321000',
      '0000123223210000',
      '0000122222210000',
      '0000122002210000',
      '0000122002210000',
      '0000111001110000',
    ],
  },
  {
    id: 'travelers-tunic',
    slot: 'outfit',
    label: "Traveler's Tunic",
    minRarity: 'common',
    legendaryName: 'Tunic of the Endless Road',
    y: 8,
    rows: [
      '0000122222210000',
      '0001222222221000',
      '0000122222210000',
      '0000133333310000', // belt
      '0000122222210000',
      '0000122002210000',
      '0000122002210000',
      '0000111001110000',
    ],
  },
];

export const TRINKETS: CosmeticTemplate[] = [
  {
    id: 'lantern',
    slot: 'trinket',
    label: 'Lantern',
    minRarity: 'common',
    set: 'delver',
    legendaryName: 'The Lamp That Never Dims',
    y: 9,
    rows: [
      '0000000000011100',
      '0000000000014100', // glowing pane
      '0000000000011100',
    ],
  },
  {
    id: 'crystal-orb',
    slot: 'trinket',
    label: 'Crystal Orb',
    minRarity: 'common',
    set: 'arcanist',
    legendaryName: 'Orb of the Deep Sight',
    y: 10,
    rows: ['0000000000013100', '0000000000034100', '0000000000013100'],
  },
  {
    id: 'rope-coil',
    slot: 'trinket',
    label: 'Coil of Rope',
    minRarity: 'common',
    set: 'cartographer',
    legendaryName: 'The Rope That Found the Way Back',
    y: 10,
    rows: ['0000000000022200', '0000000000020200', '0000000000022200'],
  },
  {
    id: 'skull-charm',
    slot: 'trinket',
    label: 'Skull Charm',
    minRarity: 'uncommon',
    set: 'gravekeeper',
    legendaryName: 'Charm of the First Buried',
    y: 10,
    rows: ['0000000000033300', '0000000000031300', '0000000000003000'],
  },
  {
    id: 'golden-bell',
    slot: 'trinket',
    label: 'Golden Bell',
    minRarity: 'rare',
    set: 'royal',
    legendaryName: 'Bell of the Court Herald',
    y: 10,
    rows: ['0000000000003000', '0000000000034300', '0000000000033300'],
  },
  {
    id: 'river-pearl',
    slot: 'trinket',
    label: 'River Pearl',
    minRarity: 'uncommon',
    set: 'river-folk',
    legendaryName: 'Pearl of the Undertow',
    y: 11,
    rows: ['0000000000034000', '0000000000043000'],
  },
  {
    id: 'lockpick-fob',
    slot: 'trinket',
    label: 'Lockpick Fob',
    minRarity: 'common',
    set: 'rogue',
    legendaryName: 'The Pick That Opened the Last Door',
    y: 9,
    rows: ['0000000000003000', '0000000000030000', '0000000000003000'],
  },
  {
    id: 'minotaur-nose-ring',
    slot: 'trinket',
    label: 'Minotaur Nose-ring',
    minRarity: 'legendary',
    set: 'minotaur',
    legendaryName: 'The Ring the Bull Wore',
    y: 10,
    rows: ['0000000000033000', '0000000000330000'],
  },
];

export const TEMPLATES: CosmeticTemplate[] = [...HATS, ...OUTFITS, ...TRINKETS];

export interface CosmeticSet {
  id: string;
  label: string;
  templateIds: string[];
}

export const SETS: CosmeticSet[] = [
  { id: 'delver', label: 'The Delver', templateIds: ['miners-helm', 'pit-overalls', 'lantern'] },
  { id: 'arcanist', label: 'The Arcanist', templateIds: ['wizard-hood', 'runed-robe', 'crystal-orb'] },
  {
    id: 'gravekeeper',
    label: 'The Gravekeeper',
    templateIds: ['gravekeepers-cowl', 'bone-circlet', 'tattered-cloak', 'skull-charm'],
  },
  {
    id: 'royal',
    label: 'The Royal Line',
    templateIds: ['rusted-crown', 'plumed-helm', 'royal-doublet', 'golden-bell'],
  },
  {
    id: 'minotaur',
    label: 'The Minotaur',
    templateIds: ['horned-helm', 'bullhide-harness', 'minotaur-nose-ring'],
  },
  { id: 'river-folk', label: 'The River Folk', templateIds: ['fishers-hood', 'oiled-coat', 'river-pearl'] },
  { id: 'rogue', label: 'The Rogue', templateIds: ['rogues-bandana', 'scout-leathers', 'lockpick-fob'] },
  {
    id: 'cartographer',
    label: 'The Cartographer',
    templateIds: ['cartographers-cap', 'surveyors-vest', 'rope-coil'],
  },
];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

export function templateById(id: string): CosmeticTemplate | undefined {
  return byId.get(id);
}

export function templatesForSlot(slot: CosmeticTemplate['slot']): CosmeticTemplate[] {
  return TEMPLATES.filter((t) => t.slot === slot);
}
