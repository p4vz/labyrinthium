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
import { bankCarriedRares, dropCarriedRares, dropTreasure, runEntryPipeline, type EngineCtx } from './entry.js';
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
  // At the table, actions are spoken aloud. Under open-information rules
  // everyone hears the declaration; otherwise only the actor's log gets it.
  const announceVis: Visibility = state.config.openInformation ? { kind: 'public' } : priv;

  if (player.paralysis > 0) {
    player.paralysis--;
    ctx.emit(announceVis, {
      type: 'actionAnnounced',
      playerId: player.id,
      playerName: player.name,
      action: 'skip',
    });
    ctx.emit(priv, { type: 'turnSkippedParalyzed', remaining: player.paralysis });
    advanceTurn(state);
    return { state, events };
  }

  if (action.type === 'skip') {
    // Only reachable under a turn timer (validate() rejects it otherwise):
    // the clock ran out and the server skips the turn for the player.
    ctx.emit({ kind: 'public' }, { type: 'turnTimedOut', playerName: player.name });
    advanceTurn(state);
    return { state, events };
  }

  ctx.emit(announceVis, {
    type: 'actionAnnounced',
    playerId: player.id,
    playerName: player.name,
    action: action.type,
    ...('direction' in action ? { direction: action.direction } : {}),
  });

  // The current sweeps anyone starting their turn in a river — once per
  // turn, before the first thing they do.
  if (!state.turnStartResolved) {
    state.turnStartResolved = true;
    driftAtTurnStart(ctx, player);
  }

  // A turn is [at most one action] + [a move, which ends it]. Blocked moves
  // are free information; actions keep the turn open until the move.
  let turnEnds = false;
  if (!player.exited) {
    switch (action.type) {
      case 'move':
        turnEnds = resolveMove(ctx, player, action.direction);
        break;
      case 'shoot':
        resolveShoot(ctx, player, action.direction as PlanarDirection);
        state.actedThisTurn = true;
        break;
      case 'grenade':
        resolveGrenade(ctx, player, action.direction as PlanarDirection);
        state.actedThisTurn = true;
        break;
      case 'placeMine':
        player.inventory.mines--;
        state.placedMines.push({ ...player.pos });
        ctx.emit(priv, { type: 'minePlaced' });
        state.actedThisTurn = true;
        break;
      case 'pickup':
        state.treasure.carriedBy = player.id;
        player.hasTreasure = true;
        ctx.emit(priv, { type: 'treasurePickedUp' });
        state.actedThisTurn = true;
        // Lifting the treasure wakes its guardians, once and for all.
        if (!state.monstersAwake && state.monsters.some((m) => m.alive)) {
          state.monstersAwake = true;
          ctx.emit({ kind: 'public' }, { type: 'monstersStir' });
        }
        break;
      case 'leave':
        resolveLeave(ctx, player, action.direction);
        turnEnds = true;
        break;
      case 'endTurn':
        turnEnds = true;
        break;
    }
  } else {
    turnEnds = true;
  }

  if (turnEnds) {
    // The world only stirs when a turn truly ends.
    moveMonsters(ctx);
    driftTreasure(state);
    if (player.exited && player.hasTreasure && state.phase === 'inProgress') {
      state.phase = 'finished';
      state.winnerId = player.id;
      ctx.emit({ kind: 'public' }, { type: 'gameWon', playerId: player.id, playerName: player.name });
    } else if (state.phase === 'inProgress' && state.players.every((p) => p.exited)) {
      // Everyone walked out without the treasure: the labyrinth keeps it.
      // Must resolve before advanceTurn, which needs a non-exited player.
      state.phase = 'finished';
      ctx.emit({ kind: 'public' }, { type: 'gameEndedNoWinner' });
    }
    if (state.phase === 'inProgress') advanceTurn(state);
  }
  return { state, events };
}

/**
 * Walk out through an adjacent exit without the treasure: the extraction
 * move of the cosmetics layer. Forfeits the race (the game goes on for the
 * others) but banks the rare loot the player carries. Leaving WITH the
 * treasure is just winning — the regular win check picks it up.
 */
function resolveLeave(ctx: EngineCtx, player: PlayerState, direction: PlanarDirection): void {
  const priv: Visibility = { kind: 'private', playerId: player.id };
  player.exited = true;
  bankCarriedRares(ctx, player);
  if (player.hasTreasure) {
    ctx.emit(priv, { type: 'exitedLabyrinth' });
    return;
  }
  ctx.emit(priv, { type: 'leftLabyrinth' });
  ctx.emit({ kind: 'public' }, { type: 'playerLeft', playerId: player.id, playerName: player.name });
}

function validate(state: GameState, action: PlayerAction): void {
  if (state.phase !== 'inProgress') {
    throw new InvalidActionError('GAME_FINISHED', 'the game is over');
  }
  const player = activePlayer(state);
  if (player.exited) throw new InvalidActionError('ALREADY_EXITED', 'you already left the labyrinth');
  if (player.paralysis > 0) return; // any action is accepted and becomes the skip

  const requireAction = (): void => {
    if (state.actedThisTurn) {
      throw new InvalidActionError('ALREADY_ACTED', 'one action per turn — now move or end the turn');
    }
  };

  switch (action.type) {
    case 'skip':
      if (state.config.turnTimerSeconds <= 0) {
        throw new InvalidActionError('NOT_PARALYZED', 'you can only skip while paralyzed');
      }
      break;
    case 'endTurn':
      break;
    case 'shoot':
      requireAction();
      if (player.inventory.bullets <= 0) throw new InvalidActionError('NO_AMMO', 'no bullets left');
      break;
    case 'grenade': {
      requireAction();
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
      requireAction();
      if (player.inventory.mines <= 0) throw new InvalidActionError('NO_MINES', 'no mines left');
      break;
    case 'pickup':
      requireAction();
      if (state.treasure.carriedBy !== null || !posEq(state.treasure.pos, player.pos)) {
        throw new InvalidActionError('NOTHING_TO_PICK_UP', 'there is no treasure here to pick up');
      }
      break;
    case 'leave': {
      if (!state.config.allowLeave) {
        throw new InvalidActionError('LEAVING_DISABLED', 'walking out early is disabled in this game');
      }
      const edges = state.edges[player.pos.level]!;
      if (getEdge(edges, player.pos, action.direction) !== 'exit') {
        throw new InvalidActionError('NO_EXIT_THERE', 'there is no exit in that direction');
      }
      break;
    }
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
  ctx.emit(
    { kind: 'private', playerId: player.id },
    { type: 'riverDrift', ...(ctx.state.config.hardRivers ? {} : { direction }) },
  );
  runEntryPipeline(ctx, player, { driftBudget: 0 });
}

/** @returns true when the player actually relocated (or left) — that ends
 * the turn. Bumps and a locked exit are free notes: the turn stays open. */
function resolveMove(ctx: EngineCtx, player: PlayerState, direction: Direction): boolean {
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
    return true;
  }

  const edges = state.edges[player.pos.level]!;
  const edge = getEdge(edges, player.pos, direction);
  switch (edge) {
    case 'wall':
    case 'reinforced':
      // Bumping cannot tell a reinforced wall from a plain one.
      ctx.emit(priv, { type: 'bumpedWall', direction });
      return false;
    case 'grate':
      ctx.emit(priv, { type: 'bumpedGrate', direction });
      return false;
    case 'exit':
      if (player.hasTreasure) {
        player.exited = true;
        bankCarriedRares(ctx, player); // the winner extracts their rares too
        ctx.emit(priv, { type: 'exitedLabyrinth' });
        return true;
      }
      ctx.emit(priv, { type: 'foundExit', direction });
      return false;
    case 'open': {
      const next = step(player.pos, direction);
      player.pos = { ...player.pos, ...next };
      ctx.emit(priv, { type: 'moved', direction });
      runEntryPipeline(ctx, player, { driftBudget: 1 });
      return true;
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
        dropCarriedRares(ctx, victim);
        if (state.config.dropAllOnShot) {
          const inv = victim.inventory;
          if (inv.grenades + inv.bullets + inv.mines > 0) {
            const existing = state.floorItems.find((f) => posEq(f.pos, victim.pos));
            if (existing) {
              existing.items.grenades += inv.grenades;
              existing.items.bullets += inv.bullets;
              existing.items.mines += inv.mines;
            } else {
              state.floorItems.push({ pos: { ...victim.pos }, items: { ...inv } });
            }
            victim.inventory = { grenades: 0, bullets: 0, mines: 0 };
          }
        }
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
  state.actedThisTurn = false;
  state.turnStartResolved = false;
}
