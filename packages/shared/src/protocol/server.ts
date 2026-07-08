import type { Pos } from '../geometry.js';
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
}

export interface ActiveRules {
  openInformation: boolean;
  turnTimerSeconds: number;
  dropAllOnShot: boolean;
  allowBorderGrenade: boolean;
  treasureDrifts: boolean;
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
      turnOrder: { id: string; name: string }[];
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
      }[];
      monsters: Pos[];
      treasure: { pos: Pos; carriedBy: string | null };
    }
  | { type: 'spectate.maps'; playerId: string; playerName: string; maps: unknown }
  | { type: 'game.events'; events: GameEvent[] }
  | {
      type: 'game.finished';
      winnerId: string;
      winnerName: string;
      turnNumber: number;
      mapReveal: MapDocument;
    }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };
