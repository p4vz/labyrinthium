import { BayesianBrain, type BrainTier } from '../src/ai/index.js';
import { applyAction } from '../src/engine/apply.js';
import { InvalidActionError, type PlayerAction } from '../src/engine/actions.js';
import type { GameEvent } from '../src/engine/events.js';
import { visibleTo } from '../src/engine/events.js';
import { DEFAULT_CONFIG, createGame, type GameConfig, type GameState } from '../src/engine/state.js';
import { getEdge } from '../src/map/grid.js';
import type { MapDocument } from '../src/map/document.js';
import type { PlanarDirection } from '../src/geometry.js';

/** Deterministic rng for reproducible bot decisions (mulberry32). */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function exitSidesOf(map: MapDocument): PlanarDirection[] {
  const level0 = map.levels[0]!;
  return (['N', 'E', 'S', 'W'] as const).filter(
    (d) => getEdge(level0.edges, map.entrance, d) === 'exit',
  );
}

/** Build a brain wired exactly like the room's game.started would wire it. */
export function makeBrain(
  map: MapDocument,
  state: GameState,
  selfId: string,
  tier: BrainTier,
  rng: () => number = seededRng(7),
): BayesianBrain {
  return new BayesianBrain({
    tier,
    selfId,
    levelSizes: map.levels.map((l) => ({ width: l.width, height: l.height })),
    entrance: map.entrance,
    exitSides: exitSidesOf(map),
    inventory: { ...state.config.startingInventory },
    rules: {
      openInformation: state.config.openInformation,
      turnTimerSeconds: state.config.turnTimerSeconds,
      dropAllOnShot: state.config.dropAllOnShot,
      allowBorderGrenade: state.config.allowBorderGrenade,
      treasureDrifts: state.config.treasureDrifts,
    },
    playerIds: state.players.map((p) => p.id),
    rng,
  });
}

/** Deliver events to the brain the way the room fans them out. */
export function deliver(brain: BayesianBrain, selfId: string, state: GameState, events: GameEvent[]): void {
  for (const e of events) {
    if (state.config.openInformation || visibleTo(e, selfId)) brain.handleEvent(e);
  }
}

export interface DriveResult {
  state: GameState;
  turns: number;
  won: boolean;
  /** decide() threw or produced an action the engine rejected */
  illegalActions: { action: PlayerAction; code: string }[];
  /** turns where the brain claimed a wrong absolute position */
  mislocalizations: number;
  /** turns where the brain was confidently localized */
  localizedChecks: number;
}

/**
 * Drive a full game with brains controlling every listed player id and a
 * scripted fallback for the rest. Verifies the money invariant along the
 * way: whenever a brain says "I know where I am", it is actually there.
 */
export function driveGame(opts: {
  map: MapDocument;
  players?: number;
  brains: Record<string, { tier: BrainTier; rng?: () => number }>;
  /** action supplier for non-brain players (default: pass the turn) */
  scripted?: (playerId: string, state: GameState) => PlayerAction;
  maxTurns?: number;
  config?: Partial<GameConfig>;
  seed?: string;
}): DriveResult & { brains: Record<string, BayesianBrain> } {
  const playerCount = opts.players ?? Object.keys(opts.brains).length;
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
  }));
  let state = createGame(opts.map, players, { ...DEFAULT_CONFIG, ...opts.config }, opts.seed ?? 'ai-test');
  const brains: Record<string, BayesianBrain> = {};
  for (const [id, cfg] of Object.entries(opts.brains)) {
    brains[id] = makeBrain(opts.map, state, id, cfg.tier, cfg.rng ?? seededRng(11));
  }
  const result: DriveResult = {
    state,
    turns: 0,
    won: false,
    illegalActions: [],
    mislocalizations: 0,
    localizedChecks: 0,
  };
  const maxTurns = opts.maxTurns ?? 800;
  let guard = 0;
  while (state.phase === 'inProgress' && state.turnNumber < maxTurns && guard++ < maxTurns * 12) {
    const active = state.players[state.turnIndex]!;
    const brain = brains[active.id];
    let action: PlayerAction;
    if (active.paralysis > 0) {
      action = { type: 'endTurn' }; // engine turns any action into the skip
    } else if (brain) {
      brain.noteTurn(state.turnNumber);
      action = brain.decide(!state.actedThisTurn);
    } else {
      action = opts.scripted?.(active.id, state) ?? { type: 'endTurn' };
    }
    let events: GameEvent[];
    try {
      const r = applyAction(state, action);
      state = r.state;
      events = r.events;
    } catch (err) {
      if (err instanceof InvalidActionError && brain) {
        // the refusal itself is information — feed it back like the room does
        brain.noteRejected(action, err.code);
        // asking to climb stairs that aren't there is a legitimate probe of a
        // speculative placement (the GM just says no); anything else is a
        // bookkeeping bug and fails the suite
        if (err.code !== 'NO_STAIRS_HERE') result.illegalActions.push({ action, code: err.code });
        const r = applyAction(state, { type: 'endTurn' });
        state = r.state;
        events = r.events;
      } else {
        throw err;
      }
    }
    for (const [id, b] of Object.entries(brains)) deliver(b, id, state, events);
    // the money invariant: confident localization is always correct
    // (a merge still on probation is a declared hypothesis, not a claim)
    for (const [id, b] of Object.entries(brains)) {
      if (!b.isConfident()) continue;
      const believed = b.believedPosition();
      if (!believed) continue;
      result.localizedChecks++;
      const actual = state.players.find((p) => p.id === id)!.pos;
      if (believed.level !== actual.level || believed.x !== actual.x || believed.y !== actual.y) {
        result.mislocalizations++;
      }
    }
  }
  result.state = state;
  result.turns = state.turnNumber;
  result.won = state.phase === 'finished';
  return { ...result, brains };
}
