import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GameState, MapDocument, PlayerAction } from '@labyrinthium/shared';

/**
 * Persistence is deliberately small: stored maps (the editor's backend) and
 * finished games. Because the engine is deterministic and the PRNG lives in
 * the state, (map, seed, config, action log) IS the full replay.
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

  close(): void {
    this.db.close();
  }
}
