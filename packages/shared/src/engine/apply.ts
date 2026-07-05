import {
  directionBetween,
  isPlanar,
  posEq,
  step,
  type Direction,
  type PlanarDirection,
} from '../geometry.js';
import { featuresAt, levelOf, riverNext, type MapFeature } from '../map/document.js';
import { blocksMovement, getEdge, isBorderEdge, setEdge } from '../map/grid.js';
import { InvalidActionError, type PlayerAction } from './actions.js';
import { dropTreasure, runEntryPipeline, type EngineCtx } from './entry.js';
import type { EventPayload, GameEvent, Visibility } from './events.js';
import { moveMonsters } from './monsters.js';
import { activePlayer, cloneState, type GameState, type PlayerState } from './state.js';

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * The single entry point of the game engine: a pure, deterministic reducer.
 * Invalid actions throw InvalidActionError BEFORE any mutation and do not
 * consume the turn. Given the same state and action, the result is always
 * identical (the PRNG lives inside the state), so a game replays exactly
 * from (initial state, action log).
 */
export function applyAction(prev: GameState, action: PlayerAction): ApplyResult {
  validate(prev, action);

  const state = cloneState(prev);
  const events: GameEvent[] = [];
  const ctx: EngineCtx = {
    state,
    emit(visibility: Visibility, payload: EventPayload) {
      events.push({ seq: state.nextEventSeq++, turn: state.turnNumber, visibility, payload });
    },
  };
  const player = activePlayer(state);
  const priv: Visibility = { kind: 'private', playerId: player.id };

  if (player.paralysis > 0) {
    player.paralysis--;
    ctx.emit(priv, { type: 'turnSkippedParalyzed', remaining: player.paralysis });
    advanceTurn(state);
    return { state, events };
  }

  // The current sweeps anyone starting their turn in a river, before they act.
  driftAtTurnStart(ctx, player);

  if (!player.exited) {
    switch (action.type) {
      case 'move':
        resolveMove(ctx, player, action.direction);
        break;
      case 'shoot':
        resolveShoot(ctx, player, action.direction as PlanarDirection);
        break;
      case 'grenade':
        resolveGrenade(ctx, player, action.direction as PlanarDirection);
        break;
      case 'placeMine':
        player.inventory.mines--;
        state.placedMines.push({ ...player.pos });
        ctx.emit(priv, { type: 'minePlaced' });
        break;
      case 'skip':
        break; // unreachable: validate() rejects skip for able players
    }
  }

  moveMonsters(ctx);
  driftTreasure(state);

  if (player.exited && player.hasTreasure && state.phase === 'inProgress') {
    state.phase = 'finished';
    state.winnerId = player.id;
    ctx.emit({ kind: 'public' }, { type: 'gameWon', playerId: player.id, playerName: player.name });
  }

  if (state.phase === 'inProgress') advanceTurn(state);
  return { state, events };
}

function validate(state: GameState, action: PlayerAction): void {
  if (state.phase !== 'inProgress') {
    throw new InvalidActionError('GAME_FINISHED', 'the game is over');
  }
  const player = activePlayer(state);
  if (player.exited) throw new InvalidActionError('ALREADY_EXITED', 'you already left the labyrinth');
  if (player.paralysis > 0) return; // any action is accepted and becomes the skip

  switch (action.type) {
    case 'skip':
      throw new InvalidActionError('NOT_PARALYZED', 'you can only skip while paralyzed');
    case 'shoot':
      if (player.inventory.bullets <= 0) throw new InvalidActionError('NO_AMMO', 'no bullets left');
      break;
    case 'grenade': {
      if (player.inventory.grenades <= 0) {
        throw new InvalidActionError('NO_GRENADES', 'no grenades left');
      }
      const edges = state.edges[player.pos.level]!;
      if (
        isBorderEdge(edges, player.pos, action.direction as PlanarDirection) &&
        !state.config.allowBorderGrenade
      ) {
        throw new InvalidActionError('BORDER_INDESTRUCTIBLE', 'the outer wall cannot be breached');
      }
      break;
    }
    case 'placeMine':
      if (player.inventory.mines <= 0) throw new InvalidActionError('NO_MINES', 'no mines left');
      break;
    case 'move':
      if (!isPlanar(action.direction)) {
        const level = levelOf(state.map, player.pos.level);
        const wantUp = action.direction === 'U';
        const stairs = featuresAt(level, player.pos).some(
          (f) =>
            f.type === 'stairs' &&
            (wantUp ? f.to.level < player.pos.level : f.to.level > player.pos.level),
        );
        if (!stairs) throw new InvalidActionError('NO_STAIRS_HERE', 'no stairway here going that way');
      }
      break;
  }
}

function driftAtTurnStart(ctx: EngineCtx, player: PlayerState): void {
  const level = levelOf(ctx.state.map, player.pos.level);
  const river = featuresAt(level, player.pos).find(
    (f): f is Extract<MapFeature, { type: 'river' }> => f.type === 'river',
  );
  if (!river) return;
  const next = riverNext(river, player.pos);
  if (!next) return; // river mouth: the current has nowhere to push
  const direction = directionBetween(player.pos, next);
  if (!direction) return;
  player.pos = { ...player.pos, ...next };
  ctx.emit({ kind: 'private', playerId: player.id }, { type: 'riverDrift', direction });
  runEntryPipeline(ctx, player, { driftBudget: 0 });
}

function resolveMove(ctx: EngineCtx, player: PlayerState, direction: Direction): void {
  const { state } = ctx;
  const priv: Visibility = { kind: 'private', playerId: player.id };

  if (!isPlanar(direction)) {
    const level = levelOf(state.map, player.pos.level);
    const wantUp = direction === 'U';
    const stairs = featuresAt(level, player.pos).find(
      (f): f is Extract<MapFeature, { type: 'stairs' }> =>
        f.type === 'stairs' &&
        (wantUp ? f.to.level < player.pos.level : f.to.level > player.pos.level),
    );
    if (!stairs) throw new InvalidActionError('NO_STAIRS_HERE', 'no stairway here going that way');
    player.pos = { ...stairs.to };
    ctx.emit(priv, { type: 'tookStairs', direction: wantUp ? 'U' : 'D' });
    runEntryPipeline(ctx, player, { driftBudget: 1 });
    return;
  }

  const edges = state.edges[player.pos.level]!;
  const edge = getEdge(edges, player.pos, direction);
  switch (edge) {
    case 'wall':
    case 'reinforced':
      // Bumping cannot tell a reinforced wall from a plain one.
      ctx.emit(priv, { type: 'bumpedWall', direction });
      return;
    case 'grate':
      ctx.emit(priv, { type: 'bumpedGrate', direction });
      return;
    case 'exit':
      if (player.hasTreasure) {
        player.exited = true;
        ctx.emit(priv, { type: 'exitedLabyrinth' });
      } else {
        ctx.emit(priv, { type: 'foundExit', direction });
      }
      return;
    case 'open': {
      const next = step(player.pos, direction);
      player.pos = { ...player.pos, ...next };
      ctx.emit(priv, { type: 'moved', direction });
      runEntryPipeline(ctx, player, { driftBudget: 1 });
      return;
    }
  }
}

function resolveShoot(ctx: EngineCtx, player: PlayerState, direction: PlanarDirection): void {
  const { state } = ctx;
  player.inventory.bullets--;
  ctx.emit({ kind: 'public' }, { type: 'shotFired' });

  const edges = state.edges[player.pos.level]!;
  let cell = { x: player.pos.x, y: player.pos.y };
  // Walk the bullet cell by cell; grates and exits stop bullets like walls do.
  for (let i = 0; i < Math.max(edges.width, edges.height) + 1; i++) {
    const edge = getEdge(edges, cell, direction);
    if (blocksMovement(edge) || edge === 'exit') return;
    cell = step(cell, direction);

    const victims = state.players.filter(
      (p) => p.id !== player.id && !p.exited && p.pos.level === player.pos.level && posEq(p.pos, { ...cell, level: player.pos.level }),
    );
    if (victims.length > 0) {
      for (const victim of victims) {
        victim.paralysis = state.config.paralysisTurns;
        dropTreasure(ctx, victim);
        ctx.emit(
          { kind: 'private', playerId: victim.id },
          { type: 'youWereShot', paralysis: state.config.paralysisTurns },
        );
      }
      ctx.emit({ kind: 'public' }, { type: 'screamHeard' });
      return;
    }

    const monster = state.monsters.find(
      (m) => m.alive && m.pos.level === player.pos.level && m.pos.x === cell.x && m.pos.y === cell.y,
    );
    if (monster) {
      monster.alive = false; // dies silently — shooter can't tell it from a wall
      return;
    }
  }
}

function resolveGrenade(ctx: EngineCtx, player: PlayerState, direction: PlanarDirection): void {
  const { state } = ctx;
  const priv: Visibility = { kind: 'private', playerId: player.id };
  player.inventory.grenades--;
  ctx.emit({ kind: 'public' }, { type: 'explosionHeard' });

  const edges = state.edges[player.pos.level]!;
  const edge = getEdge(edges, player.pos, direction);
  switch (edge) {
    case 'wall':
      setEdge(edges, player.pos, direction, 'open');
      ctx.emit(priv, { type: 'wallDestroyed', direction, kind: 'wall' });
      return;
    case 'grate':
      setEdge(edges, player.pos, direction, 'open');
      ctx.emit(priv, { type: 'wallDestroyed', direction, kind: 'grate' });
      return;
    case 'reinforced':
      ctx.emit(priv, { type: 'grenadeNoEffect', direction, reason: 'reinforced' });
      return;
    case 'open':
    case 'exit':
      ctx.emit(priv, { type: 'grenadeNoEffect', direction, reason: 'nothingThere' });
      return;
  }
}

function driftTreasure(state: GameState): void {
  if (!state.config.treasureDrifts || state.treasure.carriedBy !== null) return;
  const level = levelOf(state.map, state.treasure.pos.level);
  const river = featuresAt(level, state.treasure.pos).find(
    (f): f is Extract<MapFeature, { type: 'river' }> => f.type === 'river',
  );
  if (!river) return;
  const next = riverNext(river, state.treasure.pos);
  if (next) state.treasure.pos = { ...state.treasure.pos, ...next };
}

function advanceTurn(state: GameState): void {
  for (let i = 0; i < state.players.length; i++) {
    state.turnIndex = (state.turnIndex + 1) % state.players.length;
    if (!state.players[state.turnIndex]!.exited) break;
  }
  state.turnNumber++;
}
