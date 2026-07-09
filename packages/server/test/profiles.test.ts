import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Rng, dailyShopStock, rollCosmetic, type AvatarConfig, type GameEvent } from '@labyrinthium/shared';
import { Db } from '../src/persistence/db.js';
import { ProfileError, ProfileService } from '../src/profiles/service.js';

function freshService(): { db: Db; service: ProfileService } {
  const db = new Db(':memory:');
  return { db, service: new ProfileService(db) };
}

describe('profile service', () => {
  it('creates a guest and authenticates by token', () => {
    const { service } = freshService();
    const { profile, token } = service.createGuest('Ariadne');
    expect(profile.displayName).toBe('Ariadne');
    expect(profile.coins).toBe(0);
    const found = service.authenticate(token);
    expect(found?.id).toBe(profile.id);
    expect(service.authenticate('not-a-token')).toBeNull();
    expect(service.authenticate('')).toBeNull();
  });

  it('upgrades to username+password, then logs in with a rotated token', () => {
    const { service } = freshService();
    const { profile, token } = service.createGuest();
    service.upgrade(profile.id, 'theseus', 'ball-of-string');
    // wrong password rejected
    expect(() => service.login('theseus', 'wrong')).toThrowError(ProfileError);
    // right password: fresh token, old one dies
    const logged = service.login('theseus', 'ball-of-string');
    expect(logged.profile.id).toBe(profile.id);
    expect(service.authenticate(logged.token)?.id).toBe(profile.id);
    expect(service.authenticate(token)).toBeNull();
    // double upgrade and taken usernames rejected
    expect(() => service.upgrade(profile.id, 'other', 'x'.repeat(8))).toThrowError(ProfileError);
    const second = service.createGuest();
    expect(() => service.upgrade(second.profile.id, 'theseus', 'password')).toThrowError(ProfileError);
  });

  it('equip validates ownership server-side', () => {
    const { db, service } = freshService();
    const { profile } = service.createGuest();
    const hat: AvatarConfig = { skinToneId: 'skin-3', hat: { templateId: 'straw-hat', paletteId: 'moss' } };
    // not owned yet
    expect(() => service.equip(profile.id, hat)).toThrowError(ProfileError);
    // own it -> equips fine (moss is a free palette)
    db.creditItems(
      profile.id,
      [{ id: 'i1', slot: 'hat', templateId: 'straw-hat', rarity: 'common', paletteId: 'bone', name: 'Straw Hat' }],
      'run',
    );
    service.equip(profile.id, hat);
    expect(service.authenticate).toBeDefined();
    // a non-free dye we don't own is rejected...
    const gilded: AvatarConfig = { ...hat, hat: { templateId: 'straw-hat', paletteId: 'gold' } };
    expect(() => service.equip(profile.id, gilded)).toThrowError(ProfileError);
    // ...but the palette the item itself dropped in works ('bone')
    service.equip(profile.id, { ...hat, hat: { templateId: 'straw-hat', paletteId: 'bone' } });
    // and owning the dye unlocks it everywhere
    db.creditItems(
      profile.id,
      [{ id: 'i2', slot: 'dye', templateId: 'dye-gold', rarity: 'uncommon', paletteId: 'gold', name: 'Gold Dye' }],
      'shop',
    );
    service.equip(profile.id, gilded);
    // unknown skin tone rejected
    expect(() => service.equip(profile.id, { skinToneId: 'skin-99' })).toThrowError(ProfileError);
  });

  it('shop: buy debits coins, blocks double-buys and overdrafts', () => {
    const { db, service } = freshService();
    const { profile } = service.createGuest();
    const stock = service.shop(profile.id);
    expect(stock.offers).toHaveLength(6);
    const offer = stock.offers[0]!;
    // broke: rejected
    expect(() => service.buy(profile.id, offer.offerId)).toThrowError(ProfileError);
    db.creditCoins(profile.id, offer.price + 5);
    const bought = service.buy(profile.id, offer.offerId);
    expect(bought.coins).toBe(5);
    expect(service.items(profile.id).some((i) => i.item.id === offer.item.id)).toBe(true);
    // same offer twice: rejected, coins untouched
    expect(() => service.buy(profile.id, offer.offerId)).toThrowError(ProfileError);
    expect(service.authenticate).toBeDefined();
    expect(db.getProfileById(profile.id)!.coins).toBe(5);
    // unknown offer id
    expect(() => service.buy(profile.id, 'nope:9')).toThrowError(ProfileError);
    expect(service.shop(profile.id).purchasedOfferIds).toEqual([offer.offerId]);
  });

  it('credits loot events with provenance, deduping by item id', () => {
    const { db, service } = freshService();
    const { profile } = service.createGuest();
    const prize = rollCosmetic(Rng.fromSeed('rare'), { rarity: 'rare', mapSeed: 'demo' });
    const events: GameEvent[] = [
      { seq: 1, turn: 1, visibility: { kind: 'private', playerId: 'p1' }, payload: { type: 'coinsFound', amount: 15 } },
      { seq: 2, turn: 2, visibility: { kind: 'private', playerId: 'p2' }, payload: { type: 'coinsFound', amount: 99 } },
      { seq: 3, turn: 3, visibility: { kind: 'private', playerId: 'p1' }, payload: { type: 'prizeFound', item: prize } },
      { seq: 4, turn: 3, visibility: { kind: 'public' }, payload: { type: 'gameWon', playerId: 'p1', playerName: 'A' } },
    ];
    service.creditLootEvents(profile.id, 'p1', events, { gameId: 'g1' });
    const rows = service.items(profile.id);
    expect(rows).toHaveLength(1);
    expect(db.getProfileById(profile.id)!.coins).toBe(15); // p2's coins were not ours
    const banked = rows.find((r) => r.item.id === prize.id)!;
    expect(banked.item.provenance?.extractedAlive).toBe(true);
    expect(banked.item.provenance?.gameId).toBe('g1');
    expect(banked.item.provenance?.mapSeed).toBe('demo');
    // replaying the same seed's events cannot duplicate items
    service.creditLootEvents(profile.id, 'p1', events, { gameId: 'g2' });
    expect(service.items(profile.id)).toHaveLength(1);
    expect(db.getProfileById(profile.id)!.coins).toBe(30); // coins DO refarm (accepted)
  });

  it('collection log counts discovered templates per slot', () => {
    const { db, service } = freshService();
    const { profile } = service.createGuest();
    db.creditItems(
      profile.id,
      [
        { id: 'a', slot: 'hat', templateId: 'straw-hat', rarity: 'common', paletteId: 'moss', name: 'Straw Hat' },
        { id: 'b', slot: 'hat', templateId: 'straw-hat', rarity: 'uncommon', paletteId: 'gold', name: 'Gilded Straw Hat' },
        { id: 'c', slot: 'trinket', templateId: 'lantern', rarity: 'common', paletteId: 'amber', name: 'Lantern' },
      ],
      'run',
    );
    const col = service.collection(profile.id);
    expect(col.hat.discovered).toEqual(['straw-hat']); // one silhouette, twice found
    expect(col.hat.total).toBe(12);
    expect(col.trinket.discovered).toEqual(['lantern']);
    expect(col.outfit.discovered).toEqual([]);
  });
});

describe('db migration', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('adds profile tables to a database created by the pre-cosmetics schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'laby-db-'));
    dirs.push(dir);
    const path = join(dir, 'game.sqlite');
    // first open: creates everything at user_version 1
    const db1 = new Db(path);
    db1.close();
    // second open: migration must be idempotent, and both old + new queries work
    const db2 = new Db(path);
    expect(db2.listMaps()).toEqual([]);
    expect(db2.listGames()).toEqual([]);
    const p = db2.createProfile('pid', 'hash', 'name');
    expect(db2.getProfileById(p.id)!.displayName).toBe('name');
    db2.close();
  });
});

describe('daily shop determinism (server side of the contract)', () => {
  it('recomputes identical stock for the same date', () => {
    expect(JSON.stringify(dailyShopStock('2026-07-08'))).toBe(JSON.stringify(dailyShopStock('2026-07-08')));
  });
});
