import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AvatarConfig, CosmeticItem, GameState, MapDocument, PlayerAction } from '@labyrinthium/shared';

export interface ProfileRow {
  id: string;
  username: string | null;
  displayName: string;
  coins: number;
  equipped: AvatarConfig | null;
  createdAt: string;
}

export interface ProfileItemRow {
  item: CosmeticItem;
  source: 'run' | 'shop';
  gameId: string | null;
  acquiredAt: string;
}

/**
 * Persistence is deliberately small: stored maps (the editor's backend),
 * finished games, and player profiles for the cosmetics meta-layer. Because
 * the engine is deterministic and the PRNG lives in the state, (map, seed,
 * config, action log) IS the full replay.
 */
export class Db {
  private db: Database.Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS maps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        doc_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        room_code TEXT NOT NULL,
        map_json TEXT NOT NULL,
        seed TEXT NOT NULL,
        config_json TEXT NOT NULL,
        players_json TEXT NOT NULL,
        winner_id TEXT,
        turn_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );
      CREATE TABLE IF NOT EXISTS game_actions (
        game_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        action_json TEXT NOT NULL,
        PRIMARY KEY (game_id, seq)
      );
    `);
    this.migrate();
  }

  /**
   * Additive schema migrations keyed on PRAGMA user_version. Version 1 adds
   * the cosmetics meta-layer: profiles (guest token first, optional
   * username/password upgrade), their item collections, and shop purchases.
   */
  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version < 1) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
          id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL UNIQUE,
          username TEXT UNIQUE,
          password_hash TEXT,
          display_name TEXT NOT NULL DEFAULT '',
          coins INTEGER NOT NULL DEFAULT 0,
          equipped_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS profile_items (
          profile_id TEXT NOT NULL REFERENCES profiles(id),
          item_id TEXT NOT NULL,
          item_json TEXT NOT NULL,
          source TEXT NOT NULL,
          game_id TEXT,
          acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (profile_id, item_id)
        );
        CREATE TABLE IF NOT EXISTS shop_purchases (
          profile_id TEXT NOT NULL,
          offer_id TEXT NOT NULL,
          PRIMARY KEY (profile_id, offer_id)
        );
        PRAGMA user_version = 1;
      `);
    }
  }

  saveMap(id: string, name: string, doc: MapDocument): void {
    this.db
      .prepare(
        `INSERT INTO maps (id, name, doc_json) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, doc_json = excluded.doc_json,
         updated_at = datetime('now')`,
      )
      .run(id, name, JSON.stringify(doc));
  }

  getMap(id: string): { id: string; name: string; doc: MapDocument } | null {
    const row = this.db.prepare('SELECT id, name, doc_json FROM maps WHERE id = ?').get(id) as
      | { id: string; name: string; doc_json: string }
      | undefined;
    if (!row) return null;
    return { id: row.id, name: row.name, doc: JSON.parse(row.doc_json) as MapDocument };
  }

  listMaps(): { id: string; name: string }[] {
    return this.db.prepare('SELECT id, name FROM maps ORDER BY updated_at DESC').all() as {
      id: string;
      name: string;
    }[];
  }

  deleteMap(id: string): boolean {
    return this.db.prepare('DELETE FROM maps WHERE id = ?').run(id).changes > 0;
  }

  saveFinishedGame(args: {
    id: string;
    roomCode: string;
    map: MapDocument;
    seed: string;
    state: GameState;
    actions: { playerId: string; action: PlayerAction }[];
  }): void {
    const insertGame = this.db.prepare(
      `INSERT INTO games (id, room_code, map_json, seed, config_json, players_json, winner_id, turn_count, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    );
    const insertAction = this.db.prepare(
      'INSERT INTO game_actions (game_id, seq, player_id, action_json) VALUES (?, ?, ?, ?)',
    );
    const tx = this.db.transaction(() => {
      insertGame.run(
        args.id,
        args.roomCode,
        JSON.stringify(args.map),
        args.seed,
        JSON.stringify(args.state.config),
        JSON.stringify(args.state.players.map((p) => ({ id: p.id, name: p.name }))),
        args.state.winnerId,
        args.state.turnNumber,
      );
      args.actions.forEach((a, i) => {
        insertAction.run(args.id, i, a.playerId, JSON.stringify(a.action));
      });
    });
    tx();
  }

  listGames(): {
    id: string;
    roomCode: string;
    winnerId: string | null;
    turnCount: number;
    players: { id: string; name: string }[];
    finishedAt: string | null;
  }[] {
    const rows = this.db
      .prepare(
        'SELECT id, room_code, winner_id, turn_count, players_json, finished_at FROM games ORDER BY finished_at DESC LIMIT 100',
      )
      .all() as {
      id: string;
      room_code: string;
      winner_id: string | null;
      turn_count: number;
      players_json: string;
      finished_at: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      roomCode: r.room_code,
      winnerId: r.winner_id,
      turnCount: r.turn_count,
      players: JSON.parse(r.players_json) as { id: string; name: string }[],
      finishedAt: r.finished_at,
    }));
  }

  /** Full record for the replay viewer: everything needed to re-run the game. */
  getGame(id: string): {
    id: string;
    roomCode: string;
    map: MapDocument;
    seed: string;
    config: unknown;
    players: { id: string; name: string }[];
    winnerId: string | null;
    actions: { playerId: string; action: PlayerAction }[];
  } | null {
    const row = this.db
      .prepare('SELECT id, room_code, map_json, seed, config_json, players_json, winner_id FROM games WHERE id = ?')
      .get(id) as
      | {
          id: string;
          room_code: string;
          map_json: string;
          seed: string;
          config_json: string;
          players_json: string;
          winner_id: string | null;
        }
      | undefined;
    if (!row) return null;
    const actionRows = this.db
      .prepare('SELECT player_id, action_json FROM game_actions WHERE game_id = ? ORDER BY seq')
      .all(id) as { player_id: string; action_json: string }[];
    return {
      id: row.id,
      roomCode: row.room_code,
      map: JSON.parse(row.map_json) as MapDocument,
      seed: row.seed,
      config: JSON.parse(row.config_json),
      players: JSON.parse(row.players_json) as { id: string; name: string }[],
      winnerId: row.winner_id,
      actions: actionRows.map((a) => ({
        playerId: a.player_id,
        action: JSON.parse(a.action_json) as PlayerAction,
      })),
    };
  }

  // ---- profiles (cosmetics meta-layer) ----

  private profileFromRow(row: {
    id: string;
    username: string | null;
    display_name: string;
    coins: number;
    equipped_json: string;
    created_at: string;
  }): ProfileRow {
    let equipped: AvatarConfig | null = null;
    try {
      const parsed = JSON.parse(row.equipped_json) as AvatarConfig;
      if (parsed && typeof parsed === 'object' && 'skinToneId' in parsed) equipped = parsed;
    } catch {
      /* corrupt equipped_json degrades to the default avatar */
    }
    return {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      coins: row.coins,
      equipped,
      createdAt: row.created_at,
    };
  }

  createProfile(id: string, tokenHash: string, displayName: string): ProfileRow {
    this.db
      .prepare('INSERT INTO profiles (id, token_hash, display_name) VALUES (?, ?, ?)')
      .run(id, tokenHash, displayName);
    return this.getProfileByTokenHash(tokenHash)!;
  }

  getProfileByTokenHash(tokenHash: string): ProfileRow | null {
    const row = this.db
      .prepare(
        'SELECT id, username, display_name, coins, equipped_json, created_at FROM profiles WHERE token_hash = ?',
      )
      .get(tokenHash) as Parameters<Db['profileFromRow']>[0] | undefined;
    if (!row) return null;
    this.db.prepare("UPDATE profiles SET last_seen_at = datetime('now') WHERE id = ?").run(row.id);
    return this.profileFromRow(row);
  }

  getProfileById(id: string): ProfileRow | null {
    const row = this.db
      .prepare('SELECT id, username, display_name, coins, equipped_json, created_at FROM profiles WHERE id = ?')
      .get(id) as Parameters<Db['profileFromRow']>[0] | undefined;
    return row ? this.profileFromRow(row) : null;
  }

  getAuthByUsername(username: string): { id: string; passwordHash: string | null } | null {
    const row = this.db
      .prepare('SELECT id, password_hash FROM profiles WHERE username = ?')
      .get(username) as { id: string; password_hash: string | null } | undefined;
    return row ? { id: row.id, passwordHash: row.password_hash } : null;
  }

  /** Attach username+password to a guest profile (the "secure progress" upgrade). */
  updateProfileAuth(id: string, username: string, passwordHash: string): void {
    this.db
      .prepare('UPDATE profiles SET username = ?, password_hash = ? WHERE id = ?')
      .run(username, passwordHash, id);
  }

  /** Point the profile at a fresh token (login from a new device). */
  rotateToken(id: string, tokenHash: string): void {
    this.db.prepare('UPDATE profiles SET token_hash = ? WHERE id = ?').run(tokenHash, id);
  }

  setEquipped(id: string, avatar: AvatarConfig): void {
    this.db.prepare('UPDATE profiles SET equipped_json = ? WHERE id = ?').run(JSON.stringify(avatar), id);
  }

  setDisplayName(id: string, displayName: string): void {
    this.db.prepare('UPDATE profiles SET display_name = ? WHERE id = ?').run(displayName, id);
  }

  /**
   * Credit items to a profile. INSERT OR IGNORE on (profile_id, item_id):
   * item ids are deterministic per map seed, so re-farming the same seeded
   * labyrinth cannot duplicate a drop.
   */
  creditItems(profileId: string, items: CosmeticItem[], source: 'run' | 'shop', gameId?: string): number {
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO profile_items (profile_id, item_id, item_json, source, game_id) VALUES (?, ?, ?, ?, ?)',
    );
    let credited = 0;
    const tx = this.db.transaction(() => {
      for (const item of items) {
        credited += stmt.run(profileId, item.id, JSON.stringify(item), source, gameId ?? null).changes;
      }
    });
    tx();
    return credited;
  }

  creditCoins(profileId: string, amount: number): void {
    this.db.prepare('UPDATE profiles SET coins = coins + ? WHERE id = ?').run(amount, profileId);
  }

  /**
   * Atomic shop purchase: one buy per offer per profile, balance may not go
   * negative, and the item lands in the collection — or nothing happens.
   */
  debitCoinsAndGrant(profileId: string, offerId: string, price: number, item: CosmeticItem): void {
    const tx = this.db.transaction(() => {
      const bought = this.db
        .prepare('INSERT OR IGNORE INTO shop_purchases (profile_id, offer_id) VALUES (?, ?)')
        .run(profileId, offerId).changes;
      if (bought === 0) throw new Error('ALREADY_PURCHASED');
      const debited = this.db
        .prepare('UPDATE profiles SET coins = coins - ? WHERE id = ? AND coins >= ?')
        .run(price, profileId, price).changes;
      if (debited === 0) throw new Error('NOT_ENOUGH_COINS');
      this.db
        .prepare(
          'INSERT OR IGNORE INTO profile_items (profile_id, item_id, item_json, source, game_id) VALUES (?, ?, ?, ?, NULL)',
        )
        .run(profileId, item.id, JSON.stringify(item), 'shop');
    });
    tx();
  }

  listItems(profileId: string): ProfileItemRow[] {
    const rows = this.db
      .prepare(
        'SELECT item_json, source, game_id, acquired_at FROM profile_items WHERE profile_id = ? ORDER BY acquired_at DESC, item_id',
      )
      .all(profileId) as { item_json: string; source: 'run' | 'shop'; game_id: string | null; acquired_at: string }[];
    return rows.map((r) => ({
      item: JSON.parse(r.item_json) as CosmeticItem,
      source: r.source,
      gameId: r.game_id,
      acquiredAt: r.acquired_at,
    }));
  }

  listPurchasedOffers(profileId: string, offerIdPrefix: string): string[] {
    const rows = this.db
      .prepare("SELECT offer_id FROM shop_purchases WHERE profile_id = ? AND offer_id LIKE ? || '%'")
      .all(profileId, offerIdPrefix) as { offer_id: string }[];
    return rows.map((r) => r.offer_id);
  }

  close(): void {
    this.db.close();
  }
}
