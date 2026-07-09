import type { Pos } from '../geometry.js';
import type { CosmeticItem } from '../cosmetics/items.js';
import type { MapDocument, MonsterAI } from '../map/document.js';
import type { EdgeGrid } from '../map/grid.js';
import { cloneEdgeGrid } from '../map/grid.js';
import { hashSeed } from '../rng.js';

export interface Inventory {
  grenades: number;
  bullets: number;
  mines: number;
}

export interface PlayerState {
  id: string;
  name: string;
  pos: Pos;
  inventory: Inventory;
  /** turns this player must still skip; 0 = able to act */
  paralysis: number;
  hasTreasure: boolean;
  exited: boolean;
  /**
   * This run's safely banked loot (coins on pickup; the treasure's hidden
   * prize on winning). Lives in state so replays and the server agree
   * byte-for-byte about who kept what. Purely aesthetic.
   */
  banked: { items: CosmeticItem[]; coins: number };
}

export interface MonsterState {
  id: string;
  pos: Pos;
  ai: MonsterAI;
  alive: boolean;
  route?: { x: number; y: number }[];
  routeIdx?: number;
  scentRadius?: number;
}

export interface GameConfig {
  /** turns skipped after being shot */
  paralysisTurns: number;
  /** turns skipped after stepping on a mine */
  mineParalysis: number;
  /** turns skipped after a monster encounter */
  monsterParalysis: number;
  allowBorderGrenade: boolean;
  /** dropped treasure drifts on rivers (hard-mode toggle) */
  treasureDrifts: boolean;
  /**
   * Classic table rules: every player's action and the game master's
   * answers are spoken aloud — everyone hears everything and can track
   * the others on their own map. Off = "secret GM" whisper variant.
   */
  openInformation: boolean;
  /** seconds per turn; 0 = untimed. Timed-out turns are skipped. */
  turnTimerSeconds: number;
  /** a shot player drops grenades/bullets/mines on their tile, not just treasure */
  dropAllOnShot: boolean;
  /**
   * Hard difficulty: the GM says the current dragged you but NOT which way —
   * you must rediscover where you are. Easy (default) names the direction.
   */
  hardRivers: boolean;
  /**
   * Any player may walk out through an exit without the treasure, forfeiting
   * the race but keeping (banking) the rare cosmetics they carry. The game
   * continues for everyone else; if all players leave, nobody wins.
   */
  allowLeave: boolean;
  startingInventory: Inventory;
}

export const DEFAULT_CONFIG: GameConfig = {
  paralysisTurns: 3,
  mineParalysis: 3,
  monsterParalysis: 1,
  allowBorderGrenade: false,
  treasureDrifts: false,
  openInformation: true,
  turnTimerSeconds: 0,
  dropAllOnShot: false,
  hardRivers: false,
  allowLeave: true,
  startingInventory: { grenades: 2, bullets: 2, mines: 1 },
};

export type GamePhase = 'inProgress' | 'finished';

/**
 * Fully serializable dynamic game state. The PRNG state lives inside, so
 * applyAction(state, action) is a pure function of its arguments and a game
 * is exactly reproducible from (initial state, action log).
 */
export interface GameState {
  phase: GamePhase;
  map: MapDocument;
  /** mutable per-level copies — grenades knock edges open here */
  edges: EdgeGrid[];
  /** hidden player-placed mines */
  placedMines: Pos[];
  /** positions of consumed baked mines / sprung single-use traps */
  sprungTraps: Pos[];
  /** gear dropped on the floor (dropAllOnShot rule); picked up by walking on it */
  floorItems: { pos: Pos; items: Inventory }[];
  /** un-scooped coin piles from the map bake */
  coinPiles: { pos: Pos; amount: number }[];
  players: PlayerState[];
  turnIndex: number;
  turnNumber: number;
  /** the active player already spent this turn's single action */
  actedThisTurn: boolean;
  /** turn-start river drift already resolved for the active player */
  turnStartResolved: boolean;
  treasure: { carriedBy: string | null; pos: Pos };
  monsters: MonsterState[];
  /** guardians sleep until the treasure is first lifted */
  monstersAwake: boolean;
  rngState: number;
  nextEventSeq: number;
  config: GameConfig;
  winnerId: string | null;
}

export function createGame(
  map: MapDocument,
  players: { id: string; name: string }[],
  config: GameConfig,
  seed: string,
): GameState {
  if (players.length === 0) throw new Error('createGame: need at least one player');
  return {
    phase: 'inProgress',
    map,
    edges: map.levels.map((l) => cloneEdgeGrid(l.edges)),
    placedMines: [],
    sprungTraps: [],
    floorItems: [],
    coinPiles: map.levels.flatMap((l, li) =>
      l.features
        .filter((f): f is Extract<(typeof l.features)[number], { type: 'coins' }> => f.type === 'coins')
        .map((f) => ({ pos: { level: li, x: f.at.x, y: f.at.y }, amount: f.amount })),
    ),
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      pos: { ...map.entrance },
      inventory: { ...config.startingInventory },
      paralysis: 0,
      hasTreasure: false,
      exited: false,
      banked: { items: [], coins: 0 },
    })),
    turnIndex: 0,
    turnNumber: 1,
    actedThisTurn: false,
    turnStartResolved: false,
    treasure: { carriedBy: null, pos: { ...map.spawns.treasure } },
    monsters: map.spawns.monsters.map((m, i) => ({
      id: `m${i}`,
      pos: { ...m.at },
      ai: m.ai,
      alive: true,
      ...(m.route ? { route: m.route.map((c) => ({ ...c })), routeIdx: 0 } : {}),
      ...(m.scentRadius !== undefined ? { scentRadius: m.scentRadius } : {}),
    })),
    monstersAwake: false,
    rngState: hashSeed(seed),
    nextEventSeq: 0,
    config,
    winnerId: null,
  };
}

export function activePlayer(state: GameState): PlayerState {
  const p = state.players[state.turnIndex];
  if (!p) throw new Error('invalid turnIndex');
  return p;
}

export function cloneState(state: GameState): GameState {
  // GameState is plain JSON data by design (that's what makes replays and
  // persistence trivial), so a JSON round-trip is a correct deep clone.
  return JSON.parse(JSON.stringify(state)) as GameState;
}
