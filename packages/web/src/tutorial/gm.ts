import {
  applyAction,
  createGame,
  getEdge,
  DEFAULT_CONFIG,
  InvalidActionError,
  type AvatarConfig,
  type ClientMessage,
  type GameState,
  type PlayerAction,
  type PresentFeature,
  type ServerMessage,
} from '@labyrinthium/shared';
import { tutorialMap, TUTORIAL_ARSENAL } from './map.js';

export const TUTORIAL_ROOM_CODE = 'TUTORIAL';
export const TUTORIAL_PLAYER_ID = 'tutorial-you';

/**
 * An in-browser game master for the tutorial: the same pure engine the
 * server runs, wrapped in the same message flow as a Room, but delivered
 * straight into the client's message handler. The whole game UI — map,
 * palette, action bar, event feed, finish reveal — works unchanged; it
 * cannot tell this GM from the real server.
 */
export class TutorialGM {
  state: GameState;

  constructor(
    private deliver: (msg: ServerMessage) => void,
    private playerName = 'you',
    private avatar: AvatarConfig | null = null,
  ) {
    this.state = createGame(
      tutorialMap(),
      [{ id: TUTORIAL_PLAYER_ID, name: playerName }],
      { ...DEFAULT_CONFIG },
      'tutorial',
    );
    // The arsenal: gear waiting on the floor, exactly as if a previous
    // adventurer had dropped it — walking over it scoops the lot.
    this.state.floorItems.push({
      pos: { ...TUTORIAL_ARSENAL.pos },
      items: { ...TUTORIAL_ARSENAL.items },
    });
  }

  start(): void {
    const map = this.state.map;
    // room.state first: it carries the room code the game header shows and
    // the roomCode the map store keys its local storage under.
    this.deliver({
      type: 'room.state',
      roomCode: TUTORIAL_ROOM_CODE,
      hostId: TUTORIAL_PLAYER_ID,
      phase: 'inProgress',
      players: [{ id: TUTORIAL_PLAYER_ID, name: this.playerName, connected: true }],
      mapMeta: { name: map.metadata.name ?? 'tutorial', levelCount: map.levels.length },
    });
    const level0 = map.levels[0]!;
    const exitSides = (['N', 'E', 'S', 'W'] as const).filter(
      (d) => getEdge(level0.edges, map.entrance, d) === 'exit',
    );
    const present = new Set<PresentFeature>();
    for (const level of map.levels) {
      for (const f of level.features) {
        if (f.type !== 'coins') present.add(f.type);
      }
    }
    if (map.spawns.monsters.length > 0) present.add('monster');
    this.deliver({
      type: 'game.started',
      yourPlayerId: TUTORIAL_PLAYER_ID,
      levelSizes: map.levels.map((l) => ({ width: l.width, height: l.height })),
      entrance: map.entrance,
      exitSides,
      featuresPresent: [...present],
      turnOrder: [
        {
          id: TUTORIAL_PLAYER_ID,
          name: this.playerName,
          ...(this.avatar ? { avatar: this.avatar } : {}),
        },
      ],
      inventory: { ...this.state.config.startingInventory },
      rules: {
        openInformation: this.state.config.openInformation,
        turnTimerSeconds: this.state.config.turnTimerSeconds,
        dropAllOnShot: this.state.config.dropAllOnShot,
        allowBorderGrenade: this.state.config.allowBorderGrenade,
        treasureDrifts: this.state.config.treasureDrifts,
        allowLeave: this.state.config.allowLeave,
        hardRivers: this.state.config.hardRivers,
      },
    });
    this.announceTurn();
  }

  /**
   * The local leg of the client's `send()`: consume what a live game needs,
   * pass everything else (room.create on the home screen, …) to the socket.
   * @returns true when the message was handled here.
   */
  handle = (msg: ClientMessage): boolean => {
    switch (msg.type) {
      case 'game.action':
        try {
          this.step(msg.action);
          this.pumpParalyzed();
        } catch (err) {
          if (err instanceof InvalidActionError) {
            this.deliver({ type: 'error', code: err.code, message: err.message });
          } else {
            throw err;
          }
        }
        return true;
      // No spectators and no server: sync/pause/pings vanish quietly.
      case 'maps.sync':
      case 'room.pause':
      case 'room.leave':
      case 'ping':
        return true;
      default:
        return false;
    }
  };

  private step(action: PlayerAction): void {
    const result = applyAction(this.state, action);
    this.state = result.state;
    if (result.events.length > 0) {
      this.deliver({ type: 'game.events', events: result.events });
    }
    if (this.state.phase === 'finished') this.finish();
    else this.announceTurn();
  }

  /** Solo insurance: if a self-placed mine paralyzes the player, the skipped
   * turns tick away instantly instead of demanding pointless clicks. */
  private pumpParalyzed(): void {
    while (this.state.phase === 'inProgress' && this.state.players[0]!.paralysis > 0) {
      this.step({ type: 'skip' });
    }
  }

  private announceTurn(): void {
    this.deliver({
      type: 'game.turn',
      activePlayerId: TUTORIAL_PLAYER_ID,
      turnNumber: this.state.turnNumber,
      roundNumber: this.state.roundNumber,
      canAct: !this.state.actedThisTurn,
    });
  }

  private finish(): void {
    const you = this.state.players[0]!;
    this.deliver({
      type: 'game.finished',
      winnerId: this.state.winnerId ?? '',
      winnerName: this.state.winnerId ? you.name : '',
      turnNumber: this.state.roundNumber,
      mapReveal: this.state.map,
      lootSummary: [
        {
          playerId: you.id,
          name: you.name,
          bankedItems: you.banked.items,
          coins: you.banked.coins,
          left: you.exited && !you.hasTreasure,
        },
      ],
    });
  }
}
