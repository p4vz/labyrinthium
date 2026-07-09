import type { Pos } from '../geometry.js';
import type { AvatarConfig, CosmeticItem } from '../cosmetics/items.js';
import type { GameEvent } from '../engine/events.js';
import type { Inventory } from '../engine/state.js';
import type { MapDocument } from '../map/document.js';

/**
 * Server -> client messages. Constructed server-side only; the shape is the
 * contract the phase-4 web client builds against. Players learn each level's
 * dimensions and the entrance — nothing else about the map until game end.
 */
export interface RoomPlayerInfo {
  id: string;
  name: string;
  connected: boolean;
  isBot?: boolean;
  /** the persistent pixel avatar; absent for bots and anonymous players */
  avatar?: AvatarConfig;
}

export interface ActiveRules {
  openInformation: boolean;
  turnTimerSeconds: number;
  dropAllOnShot: boolean;
  allowBorderGrenade: boolean;
  treasureDrifts: boolean;
  allowLeave: boolean;
  hardRivers: boolean;
}

/** Map-element kinds that exist in the current maze — table knowledge, so
 * the drawing palette can grey out stamps that can never apply. */
export type PresentFeature =
  | 'river'
  | 'teleport'
  | 'stairs'
  | 'trapdoor'
  | 'mine'
  | 'trap'
  | 'monster';

/** Per-player end-of-game haul, shown on the finish screen. */
export interface PlayerLootSummary {
  playerId: string;
  name: string;
  bankedItems: CosmeticItem[];
  coins: number;
  /** rares still carried inside when the game ended — lost in the dark */
  lostRares: number;
  /** walked out without the treasure (forfeited the race) */
  left: boolean;
}

export type ServerMessage =
  | { type: 'session.created'; playerId: string; sessionToken: string; roomCode: string }
  | {
      type: 'room.state';
      roomCode: string;
      hostId: string;
      phase: 'lobby' | 'inProgress' | 'finished';
      players: RoomPlayerInfo[];
      mapMeta: { name?: string; difficulty?: number; levelCount: number };
    }
  | { type: 'room.playerJoined'; playerId: string; name: string }
  | { type: 'room.playerLeft'; playerId: string }
  | { type: 'room.playerReconnected'; playerId: string }
  | {
      type: 'game.started';
      yourPlayerId: string;
      levelSizes: { width: number; height: number }[];
      entrance: Pos;
      /** which border side(s) of the entrance cell are the way in AND out —
       * common knowledge, marked on everyone's map automatically */
      exitSides: ('N' | 'E' | 'S' | 'W')[];
      /** which element kinds exist in this maze (the GM announces the rules
       * in play, never their positions) */
      featuresPresent: PresentFeature[];
      turnOrder: { id: string; name: string; avatar?: AvatarConfig }[];
      inventory: Inventory;
      rules: ActiveRules;
    }
  | { type: 'game.paused'; paused: boolean }
  | {
      type: 'game.turn';
      activePlayerId: string;
      turnNumber: number;
      /** the active player's one action (shoot/grenade/mine/pickup) is still available */
      canAct: boolean;
    }
  // ---- observer mode: spectators see everything ----
  | { type: 'spectate.reveal'; map: MapDocument }
  | {
      type: 'spectate.state';
      players: {
        id: string;
        name: string;
        pos: Pos;
        paralysis: number;
        hasTreasure: boolean;
        exited: boolean;
        /** how many at-risk rares they carry (details stay private) */
        carriedRareCount: number;
      }[];
      monsters: Pos[];
      treasure: { pos: Pos; carriedBy: string | null };
    }
  | { type: 'spectate.maps'; playerId: string; playerName: string; maps: unknown }
  | { type: 'game.events'; events: GameEvent[] }
  | {
      type: 'game.finished';
      /** '' = nobody won (everyone walked out) */
      winnerId: string;
      winnerName: string;
      turnNumber: number;
      mapReveal: MapDocument;
      lootSummary: PlayerLootSummary[];
    }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };
