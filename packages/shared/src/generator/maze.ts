import type { Coord } from '../geometry.js';
import { PLANAR_DIRECTIONS, coordKey, step } from '../geometry.js';
import type { EdgeGrid } from '../map/grid.js';
import { getEdge, inBounds, setEdge, solidGrid } from '../map/grid.js';
import type { Rng } from '../rng.js';

/**
 * Recursive backtracker (iterative form). Produces a perfect maze — exactly
 * one path between any two cells. Chosen over Kruskal/Prim for its long-
 * corridor bias, which suits trial-and-error mapping.
 */
export function carveMaze(width: number, height: number, rng: Rng): EdgeGrid {
  const edges = solidGrid(width, height);
  const visited = new Set<string>();
  const start: Coord = { x: rng.int(width), y: rng.int(height) };
  const stack: Coord[] = [start];
  visited.add(coordKey(start));

  while (stack.length > 0) {
    const cur = stack[stack.length - 1]!;
    const candidates = PLANAR_DIRECTIONS.filter((d) => {
      const n = step(cur, d);
      return inBounds(edges, n) && !visited.has(coordKey(n));
    });
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const d = rng.pick(candidates);
    const next = step(cur, d);
    setEdge(edges, cur, d, 'open');
    visited.add(coordKey(next));
    stack.push(next);
  }
  return edges;
}

/**
 * Braiding: knock down one extra wall at `factor` of dead ends, creating
 * loops. Loops make a map ambiguous to map by hand — i.e. harder — and give
 * players escape routes.
 */
export function braid(edges: EdgeGrid, factor: number, rng: Rng): void {
  const deadEnds: Coord[] = [];
  for (let y = 0; y < edges.height; y++) {
    for (let x = 0; x < edges.width; x++) {
      const c = { x, y };
      const open = PLANAR_DIRECTIONS.filter((d) => getEdge(edges, c, d) === 'open').length;
      if (open === 1) deadEnds.push(c);
    }
  }
  rng.shuffle(deadEnds);
  const toFix = Math.round(deadEnds.length * factor);
  for (let i = 0; i < toFix; i++) {
    const c = deadEnds[i]!;
    const candidates = PLANAR_DIRECTIONS.filter((d) => {
      const n = step(c, d);
      return inBounds(edges, n) && getEdge(edges, c, d) === 'wall';
    });
    if (candidates.length > 0) setEdge(edges, c, rng.pick(candidates), 'open');
  }
}

/**
 * Harden: promote a share of the remaining interior walls to reinforced
 * (grenade-proof). Solvability is untouched — these were walls already.
 */
export function harden(edges: EdgeGrid, share: number, rng: Rng): void {
  if (share <= 0) return;
  for (let y = 0; y < edges.height; y++) {
    for (let x = 0; x < edges.width; x++) {
      const c = { x, y };
      for (const d of ['E', 'S'] as const) {
        const n = step(c, d);
        if (!inBounds(edges, n)) continue; // interior edges only
        if (getEdge(edges, c, d) === 'wall' && rng.next() < share) {
          setEdge(edges, c, d, 'reinforced');
        }
      }
    }
  }
}
