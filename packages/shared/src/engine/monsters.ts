import type { Coord, PlanarDirection } from '../geometry.js';
import { PLANAR_DIRECTIONS, coordKey, directionBetween, posEq, step } from '../geometry.js';
import type { EdgeGrid } from '../map/grid.js';
import { getEdge, inBounds } from '../map/grid.js';
import { rngNext } from '../rng.js';
import { dropTreasure, type EngineCtx } from './entry.js';
import type { MonsterState } from './state.js';

/** Monsters walk only through fully open edges — never exits, grates, walls. */
function openDirections(edges: EdgeGrid, c: Coord): PlanarDirection[] {
  return PLANAR_DIRECTIONS.filter((d) => {
    if (getEdge(edges, c, d) !== 'open') return false;
    return inBounds(edges, step(c, d));
  });
}

function rngInt(ctx: EngineCtx, n: number): number {
  const { state, value } = rngNext(ctx.state.rngState);
  ctx.state.rngState = state;
  return Math.floor(value * n);
}

/** BFS first-step toward the nearest target cell within maxDist, else null. */
function huntStep(
  edges: EdgeGrid,
  from: Coord,
  targets: Coord[],
  maxDist: number,
): PlanarDirection | null {
  if (targets.length === 0) return null;
  const targetKeys = new Set(targets.map(coordKey));
  if (targetKeys.has(coordKey(from))) return null; // already on top of a target
  const seen = new Map<string, { cell: Coord; firstStep: PlanarDirection; dist: number }>();
  const queue: { cell: Coord; firstStep: PlanarDirection; dist: number }[] = [];
  for (const d of openDirections(edges, from)) {
    const cell = step(from, d);
    const entry = { cell, firstStep: d, dist: 1 };
    seen.set(coordKey(cell), entry);
    queue.push(entry);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (targetKeys.has(coordKey(cur.cell))) return cur.firstStep;
    if (cur.dist >= maxDist) continue;
    for (const d of openDirections(edges, cur.cell)) {
      const cell = step(cur.cell, d);
      const key = coordKey(cell);
      if (!seen.has(key)) {
        const entry = { cell, firstStep: cur.firstStep, dist: cur.dist + 1 };
        seen.set(key, entry);
        queue.push(entry);
      }
    }
  }
  return null;
}

function pickMove(ctx: EngineCtx, monster: MonsterState): PlanarDirection | null {
  const edges = ctx.state.edges[monster.pos.level];
  if (!edges) return null;

  // Awake guardians have one job: the treasure. Hunt whoever carries it
  // (same level — monsters never climb), or squat on it where it lies.
  const treasure = ctx.state.treasure;
  const carrier = treasure.carriedBy
    ? ctx.state.players.find((p) => p.id === treasure.carriedBy && !p.exited)
    : undefined;
  const guardTarget =
    carrier && carrier.pos.level === monster.pos.level
      ? { x: carrier.pos.x, y: carrier.pos.y }
      : !carrier && treasure.pos.level === monster.pos.level
        ? { x: treasure.pos.x, y: treasure.pos.y }
        : null;
  if (guardTarget) {
    const d = huntStep(edges, monster.pos, [guardTarget], edges.width * edges.height);
    if (d) return d;
    if (monster.pos.x === guardTarget.x && monster.pos.y === guardTarget.y) return null; // on station
    // no path (sealed off): fall through to the monster's own habits
  }

  if (monster.ai === 'patroller' && monster.route && monster.route.length > 1) {
    const idx = monster.routeIdx ?? 0;
    const nextIdx = (idx + 1) % monster.route.length;
    const next = monster.route[nextIdx]!;
    const d = directionBetween(monster.pos, next);
    if (d && getEdge(edges, monster.pos, d) === 'open') {
      monster.routeIdx = nextIdx;
      return d;
    }
    return null; // route blocked or corrupted: hold position
  }

  if (monster.ai === 'hunter') {
    const radius = monster.scentRadius ?? 5;
    const prey = ctx.state.players
      .filter((p) => !p.exited && p.pos.level === monster.pos.level)
      .map((p) => ({ x: p.pos.x, y: p.pos.y }));
    const d = huntStep(edges, monster.pos, prey, radius);
    if (d) return d;
    // out of scent range: fall through to wandering
  }

  const open = openDirections(edges, monster.pos);
  if (open.length === 0) return null;
  return open[rngInt(ctx, open.length)]!;
}

/**
 * World phase: each living monster takes one step. Monsters never change
 * level, never ride rivers or teleports, and never trigger mines or traps —
 * they are "something moving" a player can learn to map around.
 *
 * Guardians SLEEP until the treasure is first lifted; once woken they
 * prioritize protecting it — hunting the carrier or camping where it lies.
 * (A sleeping monster still mauls anyone who stumbles onto it.)
 */
export function moveMonsters(ctx: EngineCtx): void {
  if (!ctx.state.monstersAwake) return;
  for (const monster of ctx.state.monsters) {
    if (!monster.alive) continue;
    const d = pickMove(ctx, monster);
    if (!d) continue;
    const next = step(monster.pos, d);
    monster.pos = { ...monster.pos, ...next };
    // Only ENTERING a cell attacks; a monster idling on a paralyzed player
    // does not re-paralyze them (no lock-out).
    for (const player of ctx.state.players) {
      if (player.exited || player.paralysis > 0) continue;
      if (!posEq(player.pos, monster.pos)) continue;
      player.paralysis = ctx.state.config.monsterParalysis;
      dropTreasure(ctx, player);
      ctx.emit(
        { kind: 'private', playerId: player.id },
        { type: 'monsterEncounter', paralysis: ctx.state.config.monsterParalysis },
      );
    }
  }
}
