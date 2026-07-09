import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  BODIES,
  DEFAULT_AVATAR,
  FREE_PALETTES,
  PALETTES,
  SKIN_TONES,
  dailyShopStock,
  templateById,
  templatesForSlot,
  visibleTo,
  type AvatarConfig,
  type CosmeticItem,
  type CosmeticSlot,
  type GameEvent,
} from '@labyrinthium/shared';
import type { Db, ProfileItemRow, ProfileRow } from '../persistence/db.js';

export class ProfileError extends Error {
  constructor(
    public code:
      | 'USERNAME_TAKEN'
      | 'ALREADY_UPGRADED'
      | 'BAD_CREDENTIALS'
      | 'NOT_OWNED'
      | 'UNKNOWN_OFFER'
      | 'ALREADY_PURCHASED'
      | 'NOT_ENOUGH_COINS',
    message: string,
  ) {
    super(message);
    this.name = 'ProfileError';
  }
}

export interface CollectionSlot {
  discovered: string[];
  total: number;
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function hashToken(token: string): string {
  // Bearer tokens are 32 random bytes — high-entropy, so a plain SHA-256 is
  // the right storage form (a KDF would only slow every request down).
  return createHash('sha256').update(token).digest('hex');
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, 'base64');
  const actual = scryptSync(password, Buffer.from(saltB64!, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The account layer of the cosmetics meta-progression. Frictionless by
 * design: a guest profile is minted on first visit and identified by an
 * opaque bearer token; username+password only SECURE the same profile later.
 * All writes are server-authoritative — loot comes from engine events the
 * server computed itself, never from client claims.
 */
export class ProfileService {
  constructor(private db: Db) {}

  createGuest(displayName = ''): { profile: ProfileRow; token: string } {
    const token = randomBytes(32).toString('base64url');
    const profile = this.db.createProfile(randomUUID(), hashToken(token), displayName);
    return { profile, token };
  }

  authenticate(token: string): ProfileRow | null {
    if (!token) return null;
    return this.db.getProfileByTokenHash(hashToken(token));
  }

  upgrade(profileId: string, username: string, password: string): void {
    const profile = this.db.getProfileById(profileId);
    if (!profile) throw new ProfileError('BAD_CREDENTIALS', 'profile not found');
    if (profile.username) throw new ProfileError('ALREADY_UPGRADED', 'this profile already has a username');
    if (this.db.getAuthByUsername(username)) throw new ProfileError('USERNAME_TAKEN', 'that name is taken');
    this.db.updateProfileAuth(profileId, username, hashPassword(password));
  }

  /** Login from a new device: rotates the token (the old device re-bootstraps). */
  login(username: string, password: string): { profile: ProfileRow; token: string } {
    const auth = this.db.getAuthByUsername(username);
    if (!auth?.passwordHash || !verifyPassword(password, auth.passwordHash)) {
      throw new ProfileError('BAD_CREDENTIALS', 'wrong username or password');
    }
    const token = randomBytes(32).toString('base64url');
    this.db.rotateToken(auth.id, hashToken(token));
    return { profile: this.db.getProfileById(auth.id)!, token };
  }

  avatarOf(profile: ProfileRow): AvatarConfig {
    return profile.equipped ?? DEFAULT_AVATAR;
  }

  /**
   * Equip an avatar. Ownership is enforced here: each equipped piece needs an
   * owned item of that template, and a non-free palette needs a matching dye
   * or an owned item that dropped in that palette. Skin tones are free.
   */
  equip(profileId: string, avatar: AvatarConfig): void {
    if (!SKIN_TONES[avatar.skinToneId]) throw new ProfileError('NOT_OWNED', 'unknown skin tone');
    // body shapes are free, but must exist in the catalog
    if (avatar.bodyId !== undefined && !BODIES.some((b) => b.id === avatar.bodyId)) {
      throw new ProfileError('NOT_OWNED', 'unknown body shape');
    }
    const owned = this.db.listItems(profileId);
    for (const slot of ['hat', 'outfit', 'trinket'] as const) {
      const piece = avatar[slot];
      if (!piece) continue;
      const template = templateById(piece.templateId);
      if (!template || template.slot !== slot) throw new ProfileError('NOT_OWNED', `unknown ${slot} template`);
      if (!owned.some((o) => o.item.templateId === piece.templateId)) {
        throw new ProfileError('NOT_OWNED', `you have not found ${template.label}`);
      }
      if (!PALETTES[piece.paletteId]) throw new ProfileError('NOT_OWNED', 'unknown palette');
      const paletteOk =
        (FREE_PALETTES as readonly string[]).includes(piece.paletteId) ||
        owned.some((o) => o.item.slot === 'dye' && o.item.paletteId === piece.paletteId) ||
        owned.some((o) => o.item.templateId === piece.templateId && o.item.paletteId === piece.paletteId);
      if (!paletteOk) throw new ProfileError('NOT_OWNED', 'you have not unlocked that dye');
    }
    this.db.setEquipped(profileId, avatar);
  }

  items(profileId: string): ProfileItemRow[] {
    return this.db.listItems(profileId);
  }

  setDisplayName(profileId: string, displayName: string): void {
    this.db.setDisplayName(profileId, displayName);
  }

  /** Collection log: which silhouettes of the finite catalog you've found. */
  collection(profileId: string): Record<Exclude<CosmeticSlot, 'dye'>, CollectionSlot> {
    const owned = this.db.listItems(profileId);
    const out = {} as Record<Exclude<CosmeticSlot, 'dye'>, CollectionSlot>;
    for (const slot of ['hat', 'outfit', 'trinket'] as const) {
      const templates = templatesForSlot(slot);
      const discovered = templates
        .filter((t) => owned.some((o) => o.item.templateId === t.id))
        .map((t) => t.id);
      out[slot] = { discovered, total: templates.length };
    }
    return out;
  }

  shop(profileId: string): {
    date: string;
    offers: ReturnType<typeof dailyShopStock>;
    purchasedOfferIds: string[];
  } {
    const date = todayUTC();
    return {
      date,
      offers: dailyShopStock(date),
      purchasedOfferIds: this.db.listPurchasedOffers(profileId, date),
    };
  }

  buy(profileId: string, offerId: string): { item: CosmeticItem; coins: number } {
    // The client's offerId is only a lookup into stock the server recomputes.
    const offer = dailyShopStock(todayUTC()).find((o) => o.offerId === offerId);
    if (!offer) throw new ProfileError('UNKNOWN_OFFER', 'that offer is not in today’s stock');
    try {
      this.db.debitCoinsAndGrant(profileId, offer.offerId, offer.price, offer.item);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'ALREADY_PURCHASED') throw new ProfileError('ALREADY_PURCHASED', 'already bought today');
      if (msg === 'NOT_ENOUGH_COINS') throw new ProfileError('NOT_ENOUGH_COINS', 'not enough coins');
      throw err;
    }
    return { item: offer.item, coins: this.db.getProfileById(profileId)!.coins };
  }

  /**
   * Bank loot from one turn's engine events (Room.step calls this with the
   * events it just computed — the single server-authoritative source).
   * Commons/coins credit the moment they were scooped; rares credit at their
   * extraction moment. Provenance dates/gameId are added HERE, never inside
   * the engine, so replays stay byte-identical.
   */
  creditLootEvents(
    profileId: string,
    playerId: string,
    events: GameEvent[],
    ctx: { gameId: string },
  ): void {
    const stamp = (item: CosmeticItem, extractedAlive?: boolean): CosmeticItem => ({
      ...item,
      provenance: {
        ...item.provenance,
        foundOn: todayUTC(),
        gameId: ctx.gameId,
        ...(extractedAlive !== undefined ? { extractedAlive } : {}),
      },
    });
    for (const event of events) {
      if (!visibleTo(event, playerId) || event.visibility.kind !== 'private') continue;
      const p = event.payload;
      if (p.type === 'coinsFound') this.db.creditCoins(profileId, p.amount);
      else if (p.type === 'prizeFound') {
        // the treasure's hidden prize, won by escaping alive
        this.db.creditItems(profileId, [stamp(p.item, true)], 'run', ctx.gameId);
      }
    }
  }
}
