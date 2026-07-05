import type { Coord } from '../geometry.js';
import { PLANAR_DIRECTIONS, coordKey, directionBetween, step } from '../geometry.js';
import type { EdgeGrid } from '../map/grid.js';
import { allCells, getEdge, inBounds, setEdge } from '../map/grid.js';
import type { MapFeature } from '../map/document.js';
import type { Rng } from '../rng.js';

/**
 * Carve one river: a non-self-intersecting random walk. Flow follows walk
 * order; edges along the flow are forced open (the water found a way), and
 * some open edges crossing the river laterally become destructible grates.
 * Returns null if no walk of the requested length fits.
 */
export function carveRiver(
  edges: EdgeGrid,
  rng: Rng,
  length: number,
  occupied: Set<string>,
  grateChance: number,
): Extract<MapFeature, { type: 'river' }> | null {
  const starts = rng.shuffle(allCells(edges).filter((c) => !occupied.has(coordKey(c))));
  for (let attempt = 0; attempt < Math.min(20, starts.length); attempt++) {
    const start = starts[attempt]!;
    const cells: Coord[] = [start];
    const used = new Set<string>([coordKey(start)]);

    while (cells.length < length) {
      const cur = cells[cells.length - 1]!;
      const candidates = PLANAR_DIRECTIONS.filter((d) => {
        const n = step(cur, d);
        return inBounds(edges, n) && !used.has(coordKey(n)) && !occupied.has(coordKey(n));
      });
      if (candidates.length === 0) break;
      const next = step(cur, rng.pick(candidates));
      cells.push(next);
      used.add(coordKey(next));
    }
    if (cells.length < Math.max(2, Math.min(length, 3))) continue; // too short, try elsewhere

    // Open the channel along the flow.
    for (let i = 0; i < cells.length - 1; i++) {
      const d = directionBetween(cells[i]!, cells[i + 1]!)!;
      setEdge(edges, cells[i]!, d, 'open');
    }
    // Grates on some lateral crossings (open edges into the river from aside).
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      const flowIn = i > 0 ? directionBetween(cells[i]!, cells[i - 1]!) : null;
      const flowOut = i < cells.length - 1 ? directionBetween(cells[i]!, cells[i + 1]!) : null;
      for (const d of PLANAR_DIRECTIONS) {
        if (d === flowIn || d === flowOut) continue;
        const n = step(c, d);
        if (!inBounds(edges, n)) continue;
        if (getEdge(edges, c, d) === 'open' && rng.next() < grateChance) {
          setEdge(edges, c, d, 'grate');
        }
      }
    }
    cells.forEach((c) => occupied.add(coordKey(c)));
    return { type: 'river', cells };
  }
  return null;
}
