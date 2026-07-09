import type { Pos } from '../geometry.js';
import { PLANAR_DIRECTIONS, posEq, posKey } from '../geometry.js';
import type { MapDocument, MapFeature } from '../map/document.js';
import { featuresAt, levelOf, riverNext } from '../map/document.js';
import { getEdge, inBounds, isBorderEdge } from '../map/grid.js';

export interface MapIssue {
  code:
    | 'ENTRANCE_INVALID'
    | 'FEATURE_OUT_OF_BOUNDS'
    | 'UNMIRRORED_STAIRS'
    | 'UNMIRRORED_TELEPORT'
    | 'TRAPDOOR_NOT_DOWN'
    | 'EXIT_NOT_ON_ENTRANCE_LEVEL'
    | 'TREASURE_UNREACHABLE'
    | 'EXIT_UNREACHABLE_FROM_TREASURE'
    | 'TRAP_REGION'
    | 'SPAWN_ON_HAZARD'
    | 'LOOT_ON_HAZARD';
  message: string;
  positions: Pos[];
}

export interface ValidationResult {
  ok: boolean;
  issues: MapIssue[];
}

/**
 * Where a player finally comes to rest after landing on `start` — resolves
 * teleport/trapdoor chains plus at most one river drift, in the exact order
 * of the engine's entry pipeline. Pure; used by generator, editor endpoint,
 * and treasure placement.
 */
export function resolveLanding(map: MapDocument, start: Pos): Pos {
  let pos = start;
  const visited = new Set<string>();
  let driftBudget = 1;
  for (let guard = 0; guard < 64; guard++) {
    const level = levelOf(map, pos.level);
    const feats = featuresAt(level, pos);
    const here = posKey(pos);

    const teleport = feats.find((f): f is Extract<MapFeature, { type: 'teleport' }> => f.type === 'teleport');
    if (teleport && !visited.has(here)) {
      visited.add(here);
      visited.add(posKey(teleport.target));
      pos = { ...teleport.target };
      continue;
    }
    const trapdoor = feats.find((f): f is Extract<MapFeature, { type: 'trapdoor' }> => f.type === 'trapdoor');
    if (trapdoor && !visited.has(here)) {
      visited.add(here);
      pos = { ...trapdoor.to };
      continue;
    }
    const river = feats.find((f): f is Extract<MapFeature, { type: 'river' }> => f.type === 'river');
    if (river && driftBudget > 0) {
      const next = riverNext(river, pos);
      if (next) {
        driftBudget--;
        pos = { ...pos, ...next };
        continue;
      }
    }
    return pos;
  }
  return pos; // relocation loop: structural checks will flag the cause
}

/**
 * The player-movement digraph, with every transition resolved through
 * resolveLanding. Grates and reinforced walls count as walls — pessimistic,
 * so every generated map is solvable WITHOUT spending a single grenade.
 */
export function movementNeighbors(map: MapDocument, pos: Pos): Pos[] {
  const level = levelOf(map, pos.level);
  const out: Pos[] = [];
  for (const d of PLANAR_DIRECTIONS) {
    if (getEdge(level.edges, pos, d) !== 'open') continue;
    const dx = d === 'E' ? 1 : d === 'W' ? -1 : 0;
    const dy = d === 'S' ? 1 : d === 'N' ? -1 : 0;
    const next = { level: pos.level, x: pos.x + dx, y: pos.y + dy };
    if (!inBounds(level.edges, next)) continue;
    out.push(resolveLanding(map, next));
  }
  for (const f of featuresAt(level, pos)) {
    if (f.type === 'stairs') out.push(resolveLanding(map, f.to));
  }
  return out;
}

/** BFS distances from a start position over the movement digraph. */
export function distancesFrom(map: MapDocument, from: Pos): Map<string, number> {
  const dist = new Map<string, number>();
  const start = resolveLanding(map, from);
  dist.set(posKey(start), 0);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(posKey(cur))!;
    for (const n of movementNeighbors(map, cur)) {
      const key = posKey(n);
      if (!dist.has(key)) {
        dist.set(key, d + 1);
        queue.push(n);
      }
    }
  }
  return dist;
}

/** Cells on the entrance level bearing at least one exit edge. */
export function exitCells(map: MapDocument): Pos[] {
  const out: Pos[] = [];
  const level = levelOf(map, 0);
  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const c = { x, y };
      if (PLANAR_DIRECTIONS.some((d) => getEdge(level.edges, c, d) === 'exit')) {
        out.push({ level: 0, x, y });
      }
    }
  }
  return out;
}

/** distance-to-exit for every position, via reverse BFS over the digraph. */
export function distancesToExit(map: MapDocument): Map<string, number> {
  // Build the reverse adjacency over all positions.
  const reverse = new Map<string, Pos[]>();
  const all: Pos[] = [];
  map.levels.forEach((level, li) => {
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) all.push({ level: li, x, y });
    }
  });
  for (const pos of all) {
    for (const n of movementNeighbors(map, pos)) {
      const key = posKey(n);
      if (!reverse.has(key)) reverse.set(key, []);
      reverse.get(key)!.push(pos);
    }
  }
  const dist = new Map<string, number>();
  const queue: Pos[] = [];
  for (const e of exitCells(map)) {
    dist.set(posKey(e), 0);
    queue.push(e);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = dist.get(posKey(cur))!;
    for (const p of reverse.get(posKey(cur)) ?? []) {
      const key = posKey(p);
      if (!dist.has(key)) {
        dist.set(key, d + 1);
        queue.push(p);
      }
    }
  }
  return dist;
}

export function validateMap(map: MapDocument): ValidationResult {
  const issues: MapIssue[] = [];
  const structural = structuralIssues(map);
  issues.push(...structural);
  // Reachability analysis is meaningless on a structurally broken map.
  if (structural.length > 0) return { ok: false, issues };

  const fromEntrance = distancesFrom(map, map.entrance);
  const treasure = map.spawns.treasure;
  const treasureLanding = resolveLanding(map, treasure);

  if (!fromEntrance.has(posKey(treasure))) {
    issues.push({
      code: 'TREASURE_UNREACHABLE',
      message: 'the treasure cannot be reached from the entrance',
      positions: [treasure],
    });
  }

  const toExit = distancesToExit(map);
  if (!toExit.has(posKey(treasureLanding))) {
    issues.push({
      code: 'EXIT_UNREACHABLE_FROM_TREASURE',
      message: 'no exit is reachable from the treasure',
      positions: [treasureLanding],
    });
  }

  // No trap regions: everywhere you can get, you can still get out.
  const stuck: Pos[] = [];
  for (const key of fromEntrance.keys()) {
    if (!toExit.has(key)) {
      const [levelStr, xy] = key.split(':') as [string, string];
      const [xStr, yStr] = xy.split(',') as [string, string];
      stuck.push({ level: Number(levelStr), x: Number(xStr), y: Number(yStr) });
    }
  }
  if (stuck.length > 0) {
    issues.push({
      code: 'TRAP_REGION',
      message: `${stuck.length} reachable position(s) cannot reach any exit`,
      positions: stuck.slice(0, 20),
    });
  }

  return { ok: issues.length === 0, issues };
}

function structuralIssues(map: MapDocument): MapIssue[] {
  const issues: MapIssue[] = [];
  const inLevel = (p: Pos): boolean => {
    const level = map.levels[p.level];
    return !!level && p.x >= 0 && p.x < level.width && p.y >= 0 && p.y < level.height;
  };

  if (!inLevel(map.entrance) || map.entrance.level !== 0) {
    issues.push({ code: 'ENTRANCE_INVALID', message: 'entrance must be on level 0 and in bounds', positions: [map.entrance] });
  } else {
    const level = levelOf(map, 0);
    const onBorder =
      map.entrance.x === 0 ||
      map.entrance.y === 0 ||
      map.entrance.x === level.width - 1 ||
      map.entrance.y === level.height - 1;
    if (!onBorder) {
      issues.push({ code: 'ENTRANCE_INVALID', message: 'entrance must be on the border ring', positions: [map.entrance] });
    }
  }

  map.levels.forEach((level, li) => {
    // Exit edges belong on the entrance level's outer border only.
    for (let y = 0; y < level.height; y++) {
      for (let x = 0; x < level.width; x++) {
        for (const d of PLANAR_DIRECTIONS) {
          if (getEdge(level.edges, { x, y }, d) !== 'exit') continue;
          if (li !== 0 || !isBorderEdge(level.edges, { x, y }, d)) {
            issues.push({
              code: 'EXIT_NOT_ON_ENTRANCE_LEVEL',
              message: 'exit edges must sit on the outer border of level 0',
              positions: [{ level: li, x, y }],
            });
          }
        }
      }
    }

    for (const f of level.features) {
      const cells = f.type === 'river' ? f.cells : [f.at];
      for (const c of cells) {
        if (c.x < 0 || c.x >= level.width || c.y < 0 || c.y >= level.height) {
          issues.push({
            code: 'FEATURE_OUT_OF_BOUNDS',
            message: `${f.type} cell out of bounds`,
            positions: [{ level: li, ...c }],
          });
        }
      }
      if (f.type === 'stairs') {
        if (!inLevel(f.to)) {
          issues.push({ code: 'FEATURE_OUT_OF_BOUNDS', message: 'stairs target out of bounds', positions: [f.to] });
        } else {
          const twin = levelOf(map, f.to.level).features.some(
            (g) => g.type === 'stairs' && g.at.x === f.to.x && g.at.y === f.to.y && posEq(g.to, { level: li, ...f.at }),
          );
          if (!twin) {
            issues.push({
              code: 'UNMIRRORED_STAIRS',
              message: 'stairway has no mirrored twin on the target level',
              positions: [{ level: li, ...f.at }],
            });
          }
        }
      }
      if (f.type === 'teleport') {
        if (!inLevel(f.target)) {
          issues.push({ code: 'FEATURE_OUT_OF_BOUNDS', message: 'teleport target out of bounds', positions: [f.target] });
        } else if (f.mode === 'twoWay') {
          const twin = levelOf(map, f.target.level).features.some(
            (g) =>
              g.type === 'teleport' &&
              g.mode === 'twoWay' &&
              g.at.x === f.target.x &&
              g.at.y === f.target.y &&
              posEq(g.target, { level: li, ...f.at }),
          );
          if (!twin) {
            issues.push({
              code: 'UNMIRRORED_TELEPORT',
              message: 'two-way teleport has no mirrored twin',
              positions: [{ level: li, ...f.at }],
            });
          }
        }
      }
      // Loot must sit on a plain resting cell so the scoop actually fires
      // where the item is drawn (generator guarantees it; editors might not).
      if (f.type === 'coins') {
        const others = featuresAt(level, f.at).filter((g) => g !== f);
        if (others.some((g) => g.type === 'teleport' || g.type === 'trapdoor' || g.type === 'river' || g.type === 'mine' || g.type === 'trap')) {
          issues.push({
            code: 'LOOT_ON_HAZARD',
            message: `${f.type} must sit on a plain cell`,
            positions: [{ level: li, ...f.at }],
          });
        }
      }
      if (f.type === 'trapdoor') {
        if (!inLevel(f.to) || f.to.level !== li + 1) {
          issues.push({
            code: 'TRAPDOOR_NOT_DOWN',
            message: 'trapdoor must drop exactly one level down',
            positions: [{ level: li, ...f.at }],
          });
        }
      }
    }
  });

  // Treasure must not spawn where it can never be picked up or never rests.
  const treasure = map.spawns.treasure;
  if (!inLevel(treasure)) {
    issues.push({ code: 'FEATURE_OUT_OF_BOUNDS', message: 'treasure out of bounds', positions: [treasure] });
  } else {
    const feats = featuresAt(levelOf(map, treasure.level), treasure);
    if (feats.some((f) => f.type === 'teleport' || f.type === 'trapdoor' || f.type === 'river' || f.type === 'mine' || f.type === 'trap')) {
      issues.push({ code: 'SPAWN_ON_HAZARD', message: 'treasure must spawn on a plain cell', positions: [treasure] });
    }
  }
  for (const m of map.spawns.monsters) {
    if (!inLevel(m.at)) {
      issues.push({ code: 'FEATURE_OUT_OF_BOUNDS', message: 'monster out of bounds', positions: [m.at] });
    }
  }

  return issues;
}
