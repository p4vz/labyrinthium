import { create } from 'zustand';
import type {
  ClientMessage,
  GameEvent,
  Inventory,
  MapDocument,
  PlayerAction,
  Pos,
  ServerMessage,
} from '@labyrinthium/shared';
import { useMapStore } from './mapStore.js';

export type Screen = 'home' | 'lobby' | 'game' | 'editor' | 'replay';

export interface FeedEntry {
  seq: number;
  turn: number;
  isPublic: boolean;
  event: GameEvent;
}

interface SessionInfo {
  token: string;
  playerId: string;
  roomCode: string;
}

export interface GameStoreState {
  screen: Screen;
  connected: boolean;
  spectating: boolean;
  session: SessionInfo | null;
  room: {
    roomCode: string;
    hostId: string;
    phase: 'lobby' | 'inProgress' | 'finished';
    players: { id: string; name: string; connected: boolean }[];
    mapMeta: { name?: string; difficulty?: number; levelCount: number };
  } | null;
  started: {
    yourPlayerId: string;
    levelSizes: { width: number; height: number }[];
    entrance: Pos;
    turnOrder: { id: string; name: string }[];
    inventory: Inventory;
  } | null;
  activePlayerId: string | null;
  turnNumber: number;
  feed: FeedEntry[];
  lastAckedSeq: number;
  finished: { winnerId: string; winnerName: string; turnNumber: number; mapReveal: MapDocument } | null;
  errors: string[];
  /** currently selected action mode in the HUD */
  actionMode: 'walk' | 'shoot' | 'grenade';

  setScreen(screen: Screen): void;
  setActionMode(mode: 'walk' | 'shoot' | 'grenade'): void;
  handleMessage(msg: ServerMessage): void;
  setConnected(up: boolean): void;
  dismissError(index: number): void;
  reset(): void;
}

const SESSION_KEY = 'labyrinthium:session';

export function loadSession(): SessionInfo | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
}

function saveSession(s: SessionInfo | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  screen: 'home',
  connected: false,
  spectating: false,
  session: null,
  room: null,
  started: null,
  activePlayerId: null,
  turnNumber: 0,
  feed: [],
  lastAckedSeq: -1,
  finished: null,
  errors: [],
  actionMode: 'walk',

  setScreen(screen) {
    set({ screen });
  },

  setActionMode(actionMode) {
    set({ actionMode });
  },

  setConnected(up) {
    set({ connected: up });
  },

  dismissError(index) {
    set({ errors: get().errors.filter((_, i) => i !== index) });
  },

  reset() {
    saveSession(null);
    set({
      screen: 'home',
      spectating: false,
      session: null,
      room: null,
      started: null,
      activePlayerId: null,
      turnNumber: 0,
      feed: [],
      lastAckedSeq: -1,
      finished: null,
      actionMode: 'walk',
    });
  },

  handleMessage(msg) {
    switch (msg.type) {
      case 'session.created': {
        const session = { token: msg.sessionToken, playerId: msg.playerId, roomCode: msg.roomCode };
        saveSession(session);
        set({ session, spectating: false });
        break;
      }
      case 'room.state': {
        set({ room: msg });
        const { screen } = get();
        if (msg.phase === 'lobby' && screen !== 'lobby') set({ screen: 'lobby' });
        break;
      }
      case 'game.started': {
        set({
          started: msg,
          feed: [],
          finished: null,
          screen: 'game',
          spectating: msg.yourPlayerId === '',
        });
        // A fresh main map starts with "you are here" on the entrance.
        const key = get().session?.roomCode ?? get().room?.roomCode ?? 'solo';
        useMapStore.getState().initForGame(key, msg.levelSizes, msg.entrance);
        break;
      }
      case 'game.turn': {
        set({ activePlayerId: msg.activePlayerId, turnNumber: msg.turnNumber });
        break;
      }
      case 'game.events': {
        const entries: FeedEntry[] = msg.events.map((e) => ({
          seq: e.seq,
          turn: e.turn,
          isPublic: e.visibility.kind === 'public',
          event: e,
        }));
        const maxSeq = Math.max(get().lastAckedSeq, ...msg.events.map((e) => e.seq));
        set({ feed: [...get().feed, ...entries].slice(-500), lastAckedSeq: maxSeq });
        break;
      }
      case 'game.finished': {
        set({ finished: msg });
        break;
      }
      case 'error': {
        set({ errors: [...get().errors, `${msg.code}: ${msg.message}`].slice(-5) });
        break;
      }
      case 'room.playerJoined':
      case 'room.playerLeft':
      case 'room.playerReconnected':
      case 'pong':
        break;
    }
  },
}));

export type SendFn = (msg: ClientMessage) => void;

export function actionFor(
  mode: 'walk' | 'shoot' | 'grenade',
  direction: 'N' | 'E' | 'S' | 'W' | 'U' | 'D',
): PlayerAction | null {
  if (mode === 'walk') return { type: 'move', direction };
  if (direction === 'U' || direction === 'D') return null; // can't shoot up stairs
  return mode === 'shoot' ? { type: 'shoot', direction } : { type: 'grenade', direction };
}
