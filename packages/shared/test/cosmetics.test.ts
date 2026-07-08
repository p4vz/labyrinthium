import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  BODY_BITMAP,
  CONDITIONS,
  EPIC_CONDITIONS,
  FREE_PALETTES,
  ORIGINS,
  PALETTES,
  RARITY_PRICES,
  RARITY_WEIGHTS,
  Rng,
  SETS,
  SKIN_TONES,
  TEMPLATES,
  cosmeticItemSchema,
  dailyShopStock,
  isRarePlus,
  rollCosmetic,
  rollDye,
  rollRarity,
  templateById,
  templatesForSlot,
  type Rarity,
} from '../src/index.js';

describe('catalog integrity', () => {
  it('template ids are unique', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('bitmaps are 16 wide, fit the 16-row frame, and use only chars 0-4', () => {
    for (const t of [...TEMPLATES, { id: 'body', y: BODY_BITMAP.y, rows: BODY_BITMAP.rows }]) {
      expect(t.rows.length, t.id).toBeGreaterThan(0);
      expect(t.y, t.id).toBeGreaterThanOrEqual(0);
      expect(t.y + t.rows.length, t.id).toBeLessThanOrEqual(16);
      for (const row of t.rows) {
        expect(row.length, `${t.id}: "${row}"`).toBe(16);
        expect(row, `${t.id}: "${row}"`).toMatch(/^[0-4]{16}$/);
      }
      // a fully transparent bitmap is an authoring mistake
      expect(t.rows.join(''), t.id).toMatch(/[1-4]/);
    }
  });

  it('every set references existing templates and every template set exists', () => {
    const setIds = new Set(SETS.map((s) => s.id));
    for (const s of SETS) {
      for (const tid of s.templateIds) {
        expect(templateById(tid), `${s.id} -> ${tid}`).toBeDefined();
      }
    }
    for (const t of TEMPLATES) {
      if (t.set) expect(setIds.has(t.set), `${t.id} -> set ${t.set}`).toBe(true);
    }
  });

  it('palettes and skin tones are 4-color ramps of hex colors', () => {
    for (const ramp of [...Object.values(PALETTES), ...Object.values(SKIN_TONES)]) {
      expect(ramp.length).toBe(4);
      for (const c of ramp) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
    for (const free of FREE_PALETTES) expect(PALETTES[free]).toBeDefined();
  });

  it('every slot has at least one common-eligible template (fallback pools)', () => {
    for (const slot of ['hat', 'outfit', 'trinket'] as const) {
      const commons = templatesForSlot(slot).filter((t) => t.minRarity === 'common');
      expect(commons.length, slot).toBeGreaterThan(0);
    }
  });
});

describe('rollCosmetic', () => {
  it('is deterministic: same rng state, byte-identical item', () => {
    const a = rollCosmetic(new Rng(1234), { mapSeed: 'demo' });
    const b = rollCosmetic(new Rng(1234), { mapSeed: 'demo' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('respects requested slot and rarity, validates against the schema', () => {
    fc.assert(
      fc.property(fc.integer(), fc.constantFrom<Rarity>('common', 'uncommon', 'rare', 'epic', 'legendary'), (seed, rarity) => {
        const item = rollCosmetic(new Rng(seed >>> 0), { rarity, slot: 'hat' });
        cosmeticItemSchema.parse(item);
        expect(item.slot).toBe('hat');
        expect(item.rarity).toBe(rarity);
        expect(templateById(item.templateId)).toBeDefined();
        expect(PALETTES[item.paletteId]).toBeDefined();
      }),
    );
  });

  it('never picks a template above the rolled rarity gate', () => {
    for (let seed = 0; seed < 500; seed++) {
      const item = rollCosmetic(new Rng(seed), { rarity: 'common' });
      const t = templateById(item.templateId)!;
      expect(t.minRarity, item.templateId).toBe('common');
    }
  });

  it('name grammar matches rarity: commons are the bare label, rares carry an origin', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = new Rng(seed);
      const common = rollCosmetic(rng, { rarity: 'common' });
      expect(common.name).toBe(templateById(common.templateId)!.label);
      const uncommon = rollCosmetic(rng, { rarity: 'uncommon' });
      expect(CONDITIONS.some((c) => uncommon.name.startsWith(`${c} `))).toBe(true);
      const rare = rollCosmetic(rng, { rarity: 'rare' });
      expect(ORIGINS.some((o) => rare.name.endsWith(o))).toBe(true);
      const epic = rollCosmetic(rng, { rarity: 'epic' });
      expect(EPIC_CONDITIONS.some((c) => epic.name.startsWith(`${c} `))).toBe(true);
      const legendary = rollCosmetic(rng, { rarity: 'legendary' });
      expect(legendary.name.length).toBeGreaterThan(0);
    }
  });

  it('rarity distribution roughly follows the weights', () => {
    const rng = new Rng(42);
    const counts: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    const n = 5000;
    for (let i = 0; i < n; i++) counts[rollRarity(rng)]++;
    const total = Object.values(RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(counts.common / n).toBeGreaterThan((RARITY_WEIGHTS.common / total) * 0.8);
    expect(counts.common / n).toBeLessThan((RARITY_WEIGHTS.common / total) * 1.2);
    expect(counts.rare + counts.epic + counts.legendary).toBeGreaterThan(0);
  });

  it('isRarePlus splits the two persistence categories', () => {
    expect(isRarePlus('common')).toBe(false);
    expect(isRarePlus('uncommon')).toBe(false);
    expect(isRarePlus('rare')).toBe(true);
    expect(isRarePlus('epic')).toBe(true);
    expect(isRarePlus('legendary')).toBe(true);
  });

  it('rollDye produces a palette-unlock item', () => {
    const dye = rollDye(new Rng(7));
    expect(dye.slot).toBe('dye');
    expect(PALETTES[dye.paletteId]).toBeDefined();
    expect(dye.templateId).toBe(`dye-${dye.paletteId}`);
  });
});

describe('dailyShopStock', () => {
  it('is deterministic per date and priced by rarity', () => {
    const a = dailyShopStock('2026-07-08');
    const b = dailyShopStock('2026-07-08');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBe(6);
    for (const offer of a) {
      expect(offer.price).toBe(RARITY_PRICES[offer.item.rarity]);
      cosmeticItemSchema.parse(offer.item);
    }
    expect(a.map((o) => o.offerId)).toEqual(['2026-07-08:0', '2026-07-08:1', '2026-07-08:2', '2026-07-08:3', '2026-07-08:4', '2026-07-08:5']);
    // slots: 3 commons one per slot, then uncommon, rare, dye
    expect(a.slice(0, 3).map((o) => o.item.slot)).toEqual(['hat', 'outfit', 'trinket']);
    expect(a[5]!.item.slot).toBe('dye');
  });

  it('different dates give different stock', () => {
    const a = dailyShopStock('2026-07-08');
    const b = dailyShopStock('2026-07-09');
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});
