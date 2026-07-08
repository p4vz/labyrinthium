import { create } from 'zustand';
import type {
  ActiveRules,
  AvatarConfig,
  ClientMessage,
  CosmeticItem,
  GameEvent,
  Inventory,
  MapDocument,
  PlanarDirection,
  PlayerAction,
  PlayerLootSummary,
  Pos,
  ServerMessage,
} from '@labyrinthium/shared';
import { useProfileStore } from './profileStore.js';
import { useMapStore } from './mapStore.js';

export type Screen = 'home' | 'lobby' | 'game' | 'editor' | 'replay' | 'wardrobe';

export interface FeedEntry {
  seq: number;
  turn: number;
  isPublic: boolean;
  /** set when this line belongs to ANOTHER player (open-information rules) */
  ownerName?: string;
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
    players: { id: string; name: string; connected: boolean; isBot?: boolean; avatar?: AvatarConfig }[];
    mapMeta: { name?: string; difficulty?: number; levelCount: number };
  } | null;
  started: {
    yourPlayerId: string;
    levelSizes: { width: number; height: number }[];
    entrance: Pos;
    turnOrder: { id: string; name: string; avatar?: AvatarConfig }[];
    inventory: Inventory;
    rules: ActiveRules;
  } | null;
  activePlayerId: string | null;
  turnNumber: number;
  /** the active player's one action is still unspent this turn */
  canAct: boolean;
  /** the GM said the treasure lies under your feet (pickup available) */
  treasureUnderfoot: boolean;
  /** rare cosmetics you carry — at risk until you walk out */
  carriedRares: CosmeticItem[];
  /** loot already safely banked this run */
  runLoot: { items: CosmeticItem[]; coins: number };
  /** the GM confirmed an exit right beside you, in this direction */
  exitAdjacent: PlanarDirection | null;
  /** you walked out early — the game goes on without you */
  leftGame: boolean;
  /** epoch ms when the current turn times out; null = untimed */
  turnDeadline: number | null;
  /** observer mode: the unlocked truth + everyone's live state + their maps */
  spectate: {
    trueMap: MapDocument | null;
    live: {
      players: {
        id: string;
        name: string;
        pos: Pos;
        paralysis: number;
        hasTreasure: boolean;
        exited: boolean;
        carriedRareCount: number;
      }[];
      monsters: Pos[];
      treasure: { pos: Pos; carriedBy: string | null };
    } | null;
    beliefMaps: Record<string, { playerName: string; maps: unknown }>;
    /** which tab the observer is looking at: 'true' or a playerId */
    view: string;
  };
  setSpectateView(view: string): void;
  feed: FeedEntry[];
  lastAckedSeq: number;
  finished: {
    winnerId: string;
    winnerName: string;
    turnNumber: number;
    mapReveal: MapDocument;
    lootSummary: PlayerLootSummary[];
  } | null;
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
  canAct: true,
  treasureUnderfoot: false,
  carriedRares: [],
  runLoot: { items: [], coins: 0 },
  exitAdjacent: null,
  leftGame: false,
  turnDeadline: null,
  spectate: { trueMap: null, live: null, beliefMaps: {}, view: 'true' },
  setSpectateView(view: string) {
    set({ spectate: { ...get().spectate, view } });
  },
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
      canAct: true,
      treasureUnderfoot: false,
      carriedRares: [],
      runLoot: { items: [], coins: 0 },
      exitAdjacent: null,
      leftGame: false,
      turnDeadline: null,
      spectate: { trueMap: null, live: null, beliefMaps: {}, view: 'true' },
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
          carriedRares: [],
          runLoot: { items: [], coins: 0 },
          exitAdjacent: null,
          leftGame: false,
        });
        // A fresh main map starts with the entrance marked and one tracking
        // piece per player (everyone begins there) plus your own pawn.
        const key = get().session?.roomCode ?? get().room?.roomCode ?? 'solo';
        useMapStore
          .getState()
          .initForGame(key, msg.levelSizes, msg.entrance, msg.turnOrder.length);
        break;
      }
      case 'game.turn': {
        const timer = get().started?.rules.turnTimerSeconds ?? 0;
        const sameTurn = msg.turnNumber === get().turnNumber;
        set({
          activePlayerId: msg.activePlayerId,
          turnNumber: msg.turnNumber,
          canAct: msg.canAct,
          // sub-actions re-announce the same turn: keep the clock running
          turnDeadline: sameTurn
            ? get().turnDeadline
            : timer > 0
              ? Date.now() + timer * 1000
              : null,
        });
        break;
      }
      case 'spectate.reveal': {
        set({ spectate: { ...get().spectate, trueMap: msg.map } });
        break;
      }
      case 'spectate.state': {
        set({
          spectate: {
            ...get().spectate,
            live: { players: msg.players, monsters: msg.monsters, treasure: msg.treasure },
          },
        });
        break;
      }
      case 'spectate.maps': {
        set({
          spectate: {
            ...get().spectate,
            beliefMaps: {
              ...get().spectate.beliefMaps,
              [msg.playerId]: { playerName: msg.playerName, maps: msg.maps },
            },
          },
        });
        break;
      }
      case 'game.events': {
        const me = get().started?.yourPlayerId;
        const names = new Map((get().started?.turnOrder ?? []).map((p) => [p.id, p.name]));
        // The GM confirmed we physically moved (walk or river current):
        // advance the "you" pawn on the player's maps automatically.
        for (const e of msg.events) {
          if (e.visibility.kind !== 'private' || e.visibility.playerId !== me) continue;
          if (e.payload.type === 'moved' || e.payload.type === 'riverDrift') {
            useMapStore.getState().moveYouPawn(e.payload.direction);
            // stepping away from the exit (or anywhere) invalidates the hint
            set({ treasureUnderfoot: false, exitAdjacent: null });
          } else if (e.payload.type === 'teleported' || e.payload.type === 'fellThroughTrapdoor' || e.payload.type === 'tookStairs') {
            set({ exitAdjacent: null });
          } else if (e.payload.type === 'foundExit') {
            // The GM confirmed an exit right next to you — chart the gate.
            useMapStore.getState().markExitEdge(e.payload.direction);
            set({ exitAdjacent: e.payload.direction });
          } else if (e.payload.type === 'treasureHere') {
            set({ treasureUnderfoot: true });
          } else if (e.payload.type === 'treasurePickedUp') {
            set({ treasureUnderfoot: false });
          } else if (e.payload.type === 'rareLootFound') {
            set({ carriedRares: [...get().carriedRares, e.payload.item] });
          } else if (e.payload.type === 'rareLootDropped') {
            set({ carriedRares: [] });
          } else if (e.payload.type === 'rareLootBanked') {
            const loot = get().runLoot;
            set({ carriedRares: [], runLoot: { ...loot, items: [...loot.items, ...e.payload.items] } });
          } else if (e.payload.type === 'cosmeticFound') {
            const loot = get().runLoot;
            set({ runLoot: { ...loot, items: [...loot.items, e.payload.item] } });
          } else if (e.payload.type === 'coinsFound') {
            const loot = get().runLoot;
            set({ runLoot: { ...loot, coins: loot.coins + e.payload.amount } });
          } else if (e.payload.type === 'leftLabyrinth') {
            set({ leftGame: true, exitAdjacent: null });
          }
        }
        const entries: FeedEntry[] = msg.events.map((e) => {
          const foreign =
            e.visibility.kind === 'private' && me !== undefined && e.visibility.playerId !== me
              ? names.get(e.visibility.playerId)
              : undefined;
          return {
            seq: e.seq,
            turn: e.turn,
            isPublic: e.visibility.kind === 'public',
            ...(foreign ? { ownerName: foreign } : {}),
            event: e,
          };
        });
        const maxSeq = Math.max(get().lastAckedSeq, ...msg.events.map((e) => e.seq));
        set({ feed: [...get().feed, ...entries].slice(-500), lastAckedSeq: maxSeq });
        break;
      }
      case 'game.finished': {
        set({ finished: msg });
        // pull the server-truth coins/items into the wardrobe right away
        void useProfileStore.getState().refresh();
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
