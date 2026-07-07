import {
  generateMap,
  validateMap,
  DEFAULT_CONFIG,
  type Complexity,
  type GameConfig,
  type GameRules,
  type MapDocument,
  type SizePreset,
} from '@labyrinthium/shared';
import { randomInt } from 'node:crypto';
import type { Db } from '../persistence/db.js';
import { Room, RoomError, type RoomPlayer } from './room.js';

// No 0/O/1/I — room codes get read out loud across the table.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface CreateRoomOptions {
  preset?: SizePreset;
  complexity?: Complexity;
  seed?: string;
  mapId?: string;
  rules?: GameRules;
}

/** Fold the create-screen checkboxes into a full engine config. */
export function configFromRules(rules: GameRules | undefined): GameConfig {
  const base: GameConfig = { ...DEFAULT_CONFIG, startingInventory: { ...DEFAULT_CONFIG.startingInventory } };
  if (!rules) return base;
  if (rules.openInformation !== undefined) base.openInformation = rules.openInformation;
  if (rules.turnTimerSeconds !== undefined) base.turnTimerSeconds = rules.turnTimerSeconds;
  if (rules.dropAllOnShot !== undefined) base.dropAllOnShot = rules.dropAllOnShot;
  if (rules.allowBorderGrenade !== undefined) base.allowBorderGrenade = rules.allowBorderGrenade;
  if (rules.treasureDrifts !== undefined) base.treasureDrifts = rules.treasureDrifts;
  if (rules.doubleAmmo) {
    base.startingInventory = {
      grenades: base.startingInventory.grenades * 2,
      bullets: base.startingInventory.bullets * 2,
      mines: base.startingInventory.mines * 2,
    };
  }
  return base;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byToken = new Map<string, { room: Room; player: RoomPlayer }>();

  constructor(private db: Db | null) {}

  createRoom(opts: CreateRoomOptions): Room {
    let map: MapDocument;
    const seed = opts.seed ?? randomSeed();
    if (opts.mapId) {
      const stored = this.db?.getMap(opts.mapId);
      if (!stored) throw new RoomError('MAP_NOT_FOUND', `no stored map ${opts.mapId}`);
      const check = validateMap(stored.doc);
      if (!check.ok) {
        throw new RoomError('MAP_INVALID', `stored map fails validation: ${check.issues[0]?.code}`);
      }
      map = stored.doc;
    } else {
      map = generateMap({
        preset: opts.preset ?? 'medium',
        complexity: opts.complexity ?? 'classic',
        seed,
      });
    }
    const code = this.uniqueCode();
    const room = new Room(code, map, seed, configFromRules(opts.rules), this.db);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  join(code: string, name: string): { room: Room; player: RoomPlayer } {
    const room = this.get(code);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', `no room ${code}`);
    if (room.phase !== 'lobby') throw new RoomError('GAME_IN_PROGRESS', 'game already started');
    if (room.players.length >= 8) throw new RoomError('ROOM_FULL', 'room is full');
    const player = room.addPlayer(name);
    this.byToken.set(player.sessionToken, { room, player });
    return { room, player };
  }

  resume(token: string): { room: Room; player: RoomPlayer } | undefined {
    return this.byToken.get(token);
  }

  /** Drop finished/abandoned rooms (called opportunistically). */
  removeRoom(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const p of room.players) this.byToken.delete(p.sessionToken);
    this.rooms.delete(code);
  }

  private uniqueCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}

function randomSeed(): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}
