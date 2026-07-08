import type { Coord, Pos } from '../geometry.js';
import { coordKey, posKey } from '../geometry.js';
import { PLANAR_DIRECTIONS, step } from '../geometry.js';
import type { LevelDocument, MapDocument, MonsterSpawn } from '../map/document.js';
import { borderCells, getEdge, inBounds, setEdge } from '../map/grid.js';
import type { Rng } from '../rng.js';
import { distancesFrom, distancesToExit, resolveLanding } from './validate.js';

/** Per-level record of cells already claimed by something. */
export type Occupied = Set<string>[];

export function claim(occ: Occupied, p: Pos): void {
  occ[p.level]!.add(coordKey(p));
}

export function isFree(occ: Occupied, p: Pos): boolean {
  return !occ[p.level]!.has(coordKey(p));
}

function freeCells(level: LevelDocument, levelIdx: number, occ: Occupied): Pos[] {
  const out: Pos[] = [];
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const p = { level: levelIdx, x, y };
      if (isFree(occ, p)) out.push(p);
    }
  }
  return out;
}

/**
 * The way in IS the way out: the entrance is a gate in the outer wall, and
 * leaving with the treasure means returning to it. Everyone knows where it
 * is from the first turn.
 */
export function placeEntrance(map: MapDocument, rng: Rng, occ: Occupied): void {
  const level0 = map.levels[0]!;
  const candidates = rng.shuffle(borderCells(level0.edges)).filter((c) =>
    isFree(occ, { level: 0, ...c }),
  );
  const cell = candidates[0] ?? borderCells(level0.edges)[0]!;
  map.entrance = { level: 0, ...cell };
  claim(occ, map.entrance);
  const borderDirs = PLANAR_DIRECTIONS.filter(
    (d) => !inBounds(level0.edges, step(cell, d)) && getEdge(level0.edges, cell, d) === 'wall',
  );
  if (borderDirs.length > 0) setEdge(level0.edges, cell, rng.pick(borderDirs), 'exit');
}

/** Every teleport SET carries a visible rune (label 1, 2, …) on its pads,
 * so players can tell pads apart and match departure to arrival. */
export function placeTeleports(
  map: MapDocument,
  rng: Rng,
  oneWay: number,
  twoWayPairs: number,
  occ: Occupied,
): void {
  let label = 1;
  for (let i = 0; i < oneWay; i++) {
    const ats = map.levels.flatMap((l, li) => freeCells(l, li, occ));
    if (ats.length < 2) return;
    const at = rng.pick(ats);
    claim(occ, at);
    const targets = map.levels.flatMap((l, li) => freeCells(l, li, occ));
    if (targets.length === 0) return;
    const target = rng.pick(targets);
    claim(occ, target); // landing pads stay clear of other features
    map.levels[at.level]!.features.push({
      type: 'teleport',
      at: { x: at.x, y: at.y },
      target,
      mode: 'oneWay',
      label: label++,
    });
  }
  for (let i = 0; i < twoWayPairs; i++) {
    const cells = map.levels.flatMap((l, li) => freeCells(l, li, occ));
    if (cells.length < 2) return;
    const a = rng.pick(cells);
    claim(occ, a);
    const rest = map.levels.flatMap((l, li) => freeCells(l, li, occ));
    if (rest.length === 0) return;
    const b = rng.pick(rest);
    claim(occ, b);
    map.levels[a.level]!.features.push({ type: 'teleport', at: { x: a.x, y: a.y }, target: b, mode: 'twoWay', label });
    map.levels[b.level]!.features.push({ type: 'teleport', at: { x: b.x, y: b.y }, target: a, mode: 'twoWay', label });
    label++;
  }
}

/**
 * Treasure goes in the top quartile of dist(entrance, c) + dist(c, nearest
 * exit) over the cross-layer movement digraph — far from both, so the trek
 * out is as blind as the trek in.
 */
export function placeTreasure(map: MapDocument, rng: Rng, occ: Occupied): void {
  const fromEntrance = distancesFrom(map, map.entrance);
  const toExit = distancesToExit(map);
  const candidates: { pos: Pos; score: number }[] = [];
  map.levels.forEach((level, li) => {
    for (const pos of freeCells(level, li, occ)) {
      const settled = resolveLanding(map, pos);
      if (posKey(settled) !== posKey(pos)) continue; // must be a resting cell
      const dIn = fromEntrance.get(posKey(pos));
      const dOut = toExit.get(posKey(pos));
      if (dIn === undefined || dOut === undefined) continue;
      candidates.push({ pos, score: dIn + dOut });
    }
  });
  if (candidates.length === 0) {
    // Degenerate map; drop the treasure next to the entrance and let the
    // validator veto the attempt.
    map.spawns.treasure = { ...map.entrance };
    return;
  }
  candidates.sort((a, b) => b.score - a.score);
  const quartile = candidates.slice(0, Math.max(1, Math.ceil(candidates.length / 4)));
  const chosen = rng.pick(quartile);
  map.spawns.treasure = chosen.pos;
  claim(occ, chosen.pos);
}

export function placeMinesAndTraps(
  map: MapDocument,
  rng: Rng,
  mines: number,
  traps: number,
  occ: Occupied,
): void {
  const fromEntrance = distancesFrom(map, map.entrance);
  const eligible = (): Pos[] =>
    map.levels
      .flatMap((l, li) => freeCells(l, li, occ))
      .filter((p) => {
        const settled = resolveLanding(map, p);
        if (posKey(settled) !== posKey(p)) return false;
        const d = fromEntrance.get(posKey(p));
        return d !== undefined && d >= 2;
      });
  for (let i = 0; i < mines; i++) {
    const cells = eligible();
    if (cells.length === 0) return;
    const at = rng.pick(cells);
    claim(occ, at);
    map.levels[at.level]!.features.push({ type: 'mine', at: { x: at.x, y: at.y } });
  }
  for (let i = 0; i < traps; i++) {
    const cells = eligible();
    if (cells.length === 0) return;
    const at = rng.pick(cells);
    claim(occ, at);
    map.levels[at.level]!.features.push({ type: 'trap', at: { x: at.x, y: at.y }, paralysis: 2 });
  }
}

export function placeMonsters(
  map: MapDocument,
  rng: Rng,
  count: number,
  ais: readonly ('wanderer' | 'patroller' | 'hunter')[],
  occ: Occupied,
): void {
  const fromEntrance = distancesFrom(map, map.entrance);
  const spawns: MonsterSpawn[] = [];
  for (let i = 0; i < count; i++) {
    const cells = map.levels
      .flatMap((l, li) => freeCells(l, li, occ))
      .filter((p) => {
        const settled = resolveLanding(map, p);
        if (posKey(settled) !== posKey(p)) return false;
        const d = fromEntrance.get(posKey(p));
        return d !== undefined && d >= 3;
      });
    if (cells.length === 0) break;
    const at = rng.pick(cells);
    claim(occ, at);
    const ai = rng.pick(ais);
    const spawn: MonsterSpawn = { at, ai };
    if (ai === 'patroller') {
      const route = buildPatrolRoute(map.levels[at.level]!, at, rng);
      if (route.length >= 2) spawn.route = route;
      else spawn.ai = 'wanderer';
    }
    if (ai === 'hunter') spawn.scentRadius = 4;
    spawns.push(spawn);
  }
  map.spawns.monsters = spawns;
}

/** Short out-and-back corridor loop: [c0, c1, ..., ck, ..., c1] cycles. */
function buildPatrolRoute(level: LevelDocument, at: Pos, rng: Rng): Coord[] {
  const path: Coord[] = [{ x: at.x, y: at.y }];
  const seen = new Set<string>([coordKey(at)]);
  for (let i = 0; i < 3; i++) {
    const cur = path[path.length - 1]!;
    const options = PLANAR_DIRECTIONS.filter((d) => {
      if (getEdge(level.edges, cur, d) !== 'open') return false;
      const n = step(cur, d);
      return inBounds(level.edges, n) && !seen.has(coordKey(n));
    });
    if (options.length === 0) break;
    const next = step(cur, rng.pick(options));
    path.push(next);
    seen.add(coordKey(next));
  }
  if (path.length < 2) return [];
  const back = path.slice(1, -1).reverse();
  return [...path, ...back];
}
