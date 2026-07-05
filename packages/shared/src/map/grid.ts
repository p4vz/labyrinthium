import type { Coord, PlanarDirection } from '../geometry.js';

/**
 * Walls live on EDGES between cells, not in cells. An EdgeGrid stores every
 * edge of a w×h level in two dense arrays:
 *   h: horizontal edges (the N/S borders of cells) — (height+1) rows × width
 *   v: vertical edges   (the W/E borders of cells) — height rows × (width+1)
 * 'exit' is only meaningful on the outer border of the entrance level.
 */
export type EdgeState = 'open' | 'wall' | 'reinforced' | 'grate' | 'exit';

export interface EdgeGrid {
  width: number;
  height: number;
  h: EdgeState[];
  v: EdgeState[];
}

export function createEdgeGrid(width: number, height: number, fill: EdgeState): EdgeGrid {
  return {
    width,
    height,
    h: new Array<EdgeState>((height + 1) * width).fill(fill),
    v: new Array<EdgeState>(height * (width + 1)).fill(fill),
  };
}

/** Fully-walled grid (the maze generator's starting point). */
export function solidGrid(width: number, height: number): EdgeGrid {
  return createEdgeGrid(width, height, 'wall');
}

function hIndex(g: EdgeGrid, x: number, row: number): number {
  return row * g.width + x;
}

function vIndex(g: EdgeGrid, col: number, y: number): number {
  return y * (g.width + 1) + col;
}

/** State of the edge on `dir` side of cell (x, y). */
export function getEdge(g: EdgeGrid, c: Coord, dir: PlanarDirection): EdgeState {
  switch (dir) {
    case 'N':
      return g.h[hIndex(g, c.x, c.y)]!;
    case 'S':
      return g.h[hIndex(g, c.x, c.y + 1)]!;
    case 'W':
      return g.v[vIndex(g, c.x, c.y)]!;
    case 'E':
      return g.v[vIndex(g, c.x + 1, c.y)]!;
  }
}

export function setEdge(g: EdgeGrid, c: Coord, dir: PlanarDirection, state: EdgeState): void {
  switch (dir) {
    case 'N':
      g.h[hIndex(g, c.x, c.y)] = state;
      break;
    case 'S':
      g.h[hIndex(g, c.x, c.y + 1)] = state;
      break;
    case 'W':
      g.v[vIndex(g, c.x, c.y)] = state;
      break;
    case 'E':
      g.v[vIndex(g, c.x + 1, c.y)] = state;
      break;
  }
}

export function inBounds(g: { width: number; height: number }, c: Coord): boolean {
  return c.x >= 0 && c.x < g.width && c.y >= 0 && c.y < g.height;
}

/** Is the edge on `dir` side of cell `c` part of the outer border? */
export function isBorderEdge(g: EdgeGrid, c: Coord, dir: PlanarDirection): boolean {
  switch (dir) {
    case 'N':
      return c.y === 0;
    case 'S':
      return c.y === g.height - 1;
    case 'W':
      return c.x === 0;
    case 'E':
      return c.x === g.width - 1;
  }
}

/** Edges a bullet cannot pass and a player cannot walk through. */
export function blocksMovement(e: EdgeState): boolean {
  return e === 'wall' || e === 'reinforced' || e === 'grate';
}

export function cloneEdgeGrid(g: EdgeGrid): EdgeGrid {
  return { width: g.width, height: g.height, h: [...g.h], v: [...g.v] };
}

export function allCells(g: { width: number; height: number }): Coord[] {
  const out: Coord[] = [];
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) out.push({ x, y });
  }
  return out;
}

export function borderCells(g: { width: number; height: number }): Coord[] {
  return allCells(g).filter(
    (c) => c.x === 0 || c.y === 0 || c.x === g.width - 1 || c.y === g.height - 1,
  );
}
