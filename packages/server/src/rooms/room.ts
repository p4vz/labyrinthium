import { randomUUID } from 'node:crypto';
import {
  applyAction,
  createGame,
  visibleTo,
  InvalidActionError,
  type ActiveRules,
  type BotDifficulty,
  type GameConfig,
  type GameEvent,
  type GameState,
  type MapDocument,
  type PlayerAction,
  type ServerMessage,
} from '@labyrinthium/shared';
import { BotController, BOT_NAMES } from '../bots/bot.js';
import type { Db } from '../persistence/db.js';

export interface RoomPlayer {
  id: string;
  name: string;
  sessionToken: string;
  send: ((msg: ServerMessage) => void) | null; // null while disconnected
  isBot: boolean;
}

export type RoomPhase = 'lobby' | 'inProgress' | 'finished';

/**
 * One game room. All mutations funnel through a single path:
 * validate -> applyAction -> log -> fan out events.
 * The server is the only holder of the map; clients only ever see events.
 *
 * Under openInformation (the classic table rules, default on), EVERY event
 * is delivered to EVERY player — like a game master speaking aloud — and
 * clients attribute other players' lines by the event's owner. With it off,
 * players receive only their own private events plus public noises.
 */
export class Room {
  readonly code: string;
  hostId: string;
  phase: RoomPhase = 'lobby';
  players: RoomPlayer[] = [];
  map: MapDocument;
  seed: string;
  config: GameConfig;
  state: GameState | null = null;
  actionLog: { playerId: string; action: PlayerAction }[] = [];
  eventLog: GameEvent[] = [];
  /** Read-only observers. */
  spectators = new Set<(msg: ServerMessage) => void>();
  /** each player's hand-drawn maps, shared with spectators only */
  beliefMaps = new Map<string, unknown>();
  private bots = new Map<string, BotController>();
  private turnTimer: NodeJS.Timeout | null = null;
  private timerArmedForTurn = -1;
  private gameId = randomUUID();

  constructor(
    code: string,
    map: MapDocument,
    seed: string,
    config: GameConfig,
    private db: Db | null,
  ) {
    this.code = code;
    this.map = map;
    this.seed = seed;
    this.config = config;
    this.hostId = '';
  }

  addPlayer(name: string): RoomPlayer {
    const player: RoomPlayer = {
      id: randomUUID(),
      name,
      sessionToken: randomUUID(),
      send: null,
      isBot: false,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = player.id;
    return player;
  }

  addBot(difficulty: BotDifficulty): RoomPlayer {
    if (this.phase !== 'lobby') throw new RoomError('ALREADY_STARTED', 'game already started');
    if (this.players.length >= 8) throw new RoomError('ROOM_FULL', 'room is full');
    const taken = new Set(this.players.map((p) => p.name));
    const name =
      BOT_NAMES[difficulty].find((n) => !taken.has(`${n} (${difficulty})`)) ??
      `Bot ${this.players.length + 1}`;
    const player: RoomPlayer = {
      id: randomUUID(),
      name: `${name} (${difficulty})`,
      sessionToken: randomUUID(),
      send: null,
      isBot: true,
    };
    const bot = new BotController(player.id, difficulty, (action) => {
      try {
        this.handleAction(player.id, action);
      } catch {
        // e.g. NO_AMMO race: one legal retry, then let the turn timer cope.
        try {
          this.handleAction(player.id, {
            type: 'move',
            direction: (['N', 'E', 'S', 'W'] as const)[Math.floor(Math.random() * 4)]!,
          });
        } catch {
          /* stay quiet; a re-announce or timeout will recover */
        }
      }
    });
    player.send = (msg) => bot.handle(msg);
    this.players.push(player);
    this.bots.set(player.id, bot);
    return player;
  }

  removeBot(playerId: string): void {
    if (this.phase !== 'lobby') throw new RoomError('ALREADY_STARTED', 'game already started');
    const bot = this.bots.get(playerId);
    if (!bot) throw new RoomError('NOT_A_BOT', 'no such bot');
    bot.stop();
    this.bots.delete(playerId);
    this.players = this.players.filter((p) => p.id !== playerId);
  }

  broadcast(msg: ServerMessage): void {
    for (const p of this.players) p.send?.(msg);
    for (const send of this.spectators) send(msg);
  }

  activeRules(): ActiveRules {
    return {
      openInformation: this.config.openInformation,
      turnTimerSeconds: this.config.turnTimerSeconds,
      dropAllOnShot: this.config.dropAllOnShot,
      allowBorderGrenade: this.config.allowBorderGrenade,
      treasureDrifts: this.config.treasureDrifts,
    };
  }

  roomStateMessage(): ServerMessage {
    return {
      type: 'room.state',
      roomCode: this.code,
      hostId: this.hostId,
      phase: this.phase,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.isBot || p.send !== null,
        isBot: p.isBot,
      })),
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
      this.config,
      this.seed,
    );
    this.phase = 'inProgress';
    for (const p of this.players) {
      p.send?.(this.gameStartedMessage(p.id));
    }
    // Spectators get the brief plus the unlocked map — they see everything.
    for (const send of this.spectators) {
      send(this.gameStartedMessage(''));
      send({ type: 'spectate.reveal', map: this.map });
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
      inventory: { ...this.config.startingInventory },
      rules: this.activeRules(),
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
      const mine = this.config.openInformation
        ? result.events
        : result.events.filter((e) => visibleTo(e, p.id));
      if (mine.length > 0) p.send?.({ type: 'game.events', events: mine });
    }
    const forSpectators = this.config.openInformation
      ? result.events
      : result.events.filter((e) => e.visibility.kind === 'public');
    if (forSpectators.length > 0) {
      for (const send of this.spectators) send({ type: 'game.events', events: forSpectators });
    }
    // Bots share their belief maps too, so observers can watch them think.
    const actingBot = this.bots.get(playerId);
    if (actingBot && (this.spectators.size > 0 || this.beliefMaps.has(playerId))) {
      this.handleMapsSync(playerId, actingBot.exportBeliefMaps());
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
      canAct: !this.state.actedThisTurn,
    });
    this.sendSpectatorState();
    this.armTurnTimer();
  }

  /** Live truth for observers: positions, paralysis, the loot. */
  spectatorStateMessage(): ServerMessage | null {
    if (!this.state) return null;
    return {
      type: 'spectate.state',
      players: this.state.players.map((p) => ({
        id: p.id,
        name: p.name,
        pos: p.pos,
        paralysis: p.paralysis,
        hasTreasure: p.hasTreasure,
        exited: p.exited,
      })),
      monsters: this.state.monsters.filter((m) => m.alive).map((m) => m.pos),
      treasure: { pos: this.state.treasure.pos, carriedBy: this.state.treasure.carriedBy },
    };
  }

  private sendSpectatorState(): void {
    const msg = this.spectatorStateMessage();
    if (!msg || this.spectators.size === 0) return;
    for (const send of this.spectators) send(msg);
  }

  /** A player shared their hand-drawn maps: forward to the watchers. */
  handleMapsSync(playerId: string, maps: unknown): void {
    this.beliefMaps.set(playerId, maps);
    const player = this.players.find((p) => p.id === playerId);
    for (const send of this.spectators) {
      send({ type: 'spectate.maps', playerId, playerName: player?.name ?? '?', maps });
    }
  }

  /** Optional per-turn clock: when it runs out, the turn is skipped.
   * Sub-actions and free bumps do NOT reset it — one clock per turn. */
  private armTurnTimer(): void {
    if (this.config.turnTimerSeconds <= 0 || this.phase !== 'inProgress' || !this.state) return;
    if (this.timerArmedForTurn === this.state.turnNumber && this.turnTimer) return;
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
    this.timerArmedForTurn = this.state.turnNumber;
    const turnAtArm = this.state.turnNumber;
    this.turnTimer = setTimeout(() => {
      if (this.phase !== 'inProgress' || !this.state) return;
      if (this.state.turnNumber !== turnAtArm) return; // someone acted in time
      const active = this.state.players[this.state.turnIndex]!;
      try {
        this.step(active.id, { type: 'skip' });
        this.pumpParalyzed();
      } catch (err) {
        console.error('turn timer skip failed', err);
      }
    }, this.config.turnTimerSeconds * 1000);
  }

  private finish(): void {
    if (!this.state) return;
    this.phase = 'finished';
    if (this.turnTimer) clearTimeout(this.turnTimer);
    for (const bot of this.bots.values()) bot.stop();
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
    return this.eventLog.filter(
      (e) => e.seq > lastAckedSeq && (this.config.openInformation || visibleTo(e, playerId)),
    );
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
