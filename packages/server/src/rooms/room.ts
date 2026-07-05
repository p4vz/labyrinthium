import { randomUUID } from 'node:crypto';
import {
  applyAction,
  createGame,
  visibleTo,
  DEFAULT_CONFIG,
  InvalidActionError,
  type GameEvent,
  type GameState,
  type MapDocument,
  type PlayerAction,
  type ServerMessage,
} from '@labyrinthium/shared';
import type { Db } from '../persistence/db.js';

export interface RoomPlayer {
  id: string;
  name: string;
  sessionToken: string;
  send: ((msg: ServerMessage) => void) | null; // null while disconnected
}

export type RoomPhase = 'lobby' | 'inProgress' | 'finished';

/**
 * One game room. All mutations funnel through a single path:
 * validate -> applyAction -> log -> fan out visibility-filtered events.
 * The server is the only holder of the map; clients only ever see events.
 */
export class Room {
  readonly code: string;
  hostId: string;
  phase: RoomPhase = 'lobby';
  players: RoomPlayer[] = [];
  map: MapDocument;
  seed: string;
  state: GameState | null = null;
  actionLog: { playerId: string; action: PlayerAction }[] = [];
  eventLog: GameEvent[] = [];
  private gameId = randomUUID();

  constructor(
    code: string,
    map: MapDocument,
    seed: string,
    private db: Db | null,
  ) {
    this.code = code;
    this.map = map;
    this.seed = seed;
    this.hostId = '';
  }

  addPlayer(name: string): RoomPlayer {
    const player: RoomPlayer = {
      id: randomUUID(),
      name,
      sessionToken: randomUUID(),
      send: null,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    return player;
  }

  broadcast(msg: ServerMessage): void {
    for (const p of this.players) p.send?.(msg);
  }

  roomStateMessage(): ServerMessage {
    return {
      type: 'room.state',
      roomCode: this.code,
      hostId: this.hostId,
      phase: this.phase,
      players: this.players.map((p) => ({ id: p.id, name: p.name, connected: p.send !== null })),
      mapMeta: {
        ...(this.map.metadata.name !== undefined ? { name: this.map.metadata.name } : {}),
        ...(this.map.metadata.difficulty !== undefined
          ? { difficulty: this.map.metadata.difficulty }
          : {}),
        levelCount: this.map.levels.length,
      },
    };
  }

  start(): void {
    if (this.phase !== 'lobby') throw new RoomError('ALREADY_STARTED', 'game already started');
    if (this.players.length < 1) throw new RoomError('NO_PLAYERS', 'nobody to play');
    this.state = createGame(
      this.map,
      this.players.map((p) => ({ id: p.id, name: p.name })),
      DEFAULT_CONFIG,
      this.seed,
    );
    this.phase = 'inProgress';
    for (const p of this.players) {
      p.send?.(this.gameStartedMessage(p.id));
    }
    this.announceTurn();
    this.pumpParalyzed();
  }

  gameStartedMessage(playerId: string): ServerMessage {
    return {
      type: 'game.started',
      yourPlayerId: playerId,
      levelSizes: this.map.levels.map((l) => ({ width: l.width, height: l.height })),
      entrance: this.map.entrance,
      turnOrder: this.players.map((p) => ({ id: p.id, name: p.name })),
      inventory: { ...DEFAULT_CONFIG.startingInventory },
    };
  }

  /** The active player submitted an action. Throws RoomError to the caller only. */
  handleAction(playerId: string, action: PlayerAction): void {
    if (this.phase !== 'inProgress' || !this.state) {
      throw new RoomError('NOT_IN_GAME', 'no game in progress');
    }
    const active = this.state.players[this.state.turnIndex]!;
    if (active.id !== playerId) throw new RoomError('NOT_YOUR_TURN', 'not your turn');
    this.step(playerId, action);
    this.pumpParalyzed();
  }

  /** Apply one action, log it, and fan out its events. */
  private step(playerId: string, action: PlayerAction): void {
    if (!this.state) return;
    let result;
    try {
      result = applyAction(this.state, action);
    } catch (err) {
      if (err instanceof InvalidActionError) {
        throw new RoomError(err.code, err.message);
      }
      throw err;
    }
    this.state = result.state;
    this.actionLog.push({ playerId, action });
    this.eventLog.push(...result.events);
    for (const p of this.players) {
      const mine = result.events.filter((e) => visibleTo(e, p.id));
      if (mine.length > 0) p.send?.({ type: 'game.events', events: mine });
    }
    if (this.state.phase === 'finished') {
      this.finish();
    } else {
      this.announceTurn();
    }
  }

  /** Auto-skip paralyzed players so the game never waits on them. */
  private pumpParalyzed(): void {
    while (this.phase === 'inProgress' && this.state) {
      const active = this.state.players[this.state.turnIndex]!;
      if (active.paralysis <= 0) break;
      this.step(active.id, { type: 'skip' });
    }
  }

  private announceTurn(): void {
    if (!this.state) return;
    const active = this.state.players[this.state.turnIndex]!;
    this.broadcast({
      type: 'game.turn',
      activePlayerId: active.id,
      turnNumber: this.state.turnNumber,
    });
  }

  private finish(): void {
    if (!this.state) return;
    this.phase = 'finished';
    const winner = this.players.find((p) => p.id === this.state!.winnerId);
    this.broadcast({
      type: 'game.finished',
      winnerId: this.state.winnerId ?? '',
      winnerName: winner?.name ?? '',
      turnNumber: this.state.turnNumber,
      mapReveal: this.map, // the big reveal: everyone finally sees the truth
    });
    try {
      this.db?.saveFinishedGame({
        id: this.gameId,
        roomCode: this.code,
        map: this.map,
        seed: this.seed,
        state: this.state,
        actions: this.actionLog,
      });
    } catch (err) {
      // Persistence failure must never take the room down mid-celebration.
      console.error('failed to persist finished game', err);
    }
  }

  /** Visible-event tail for a reconnecting player. */
  eventsSince(playerId: string, lastAckedSeq: number): GameEvent[] {
    return this.eventLog.filter((e) => e.seq > lastAckedSeq && visibleTo(e, playerId));
  }
}

export class RoomError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RoomError';
  }
}
