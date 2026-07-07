/**
 * The player's hand-drawn map — pure data + pure operations, so undo/redo,
 * clipboard, and merge are trivially testable. This is a map of BELIEFS:
 * nothing here comes from the server; the player draws what the game master
 * (the computer) told them, exactly like pencil on graph paper.
 */

export type EdgeMark = 'unknown' | 'open' | 'wall' | 'grate';

export type Stamp =
  | 'you'
  | 'entrance'
  | 'empty' // "checked — nothing here"
  | 'river'
  | 'teleport'
  | 'stairs'
  | 'trapdoor'
  | 'mine'
  | 'trap'
  | 'monster'
  | 'treasure'
  | 'exit'
  | 'flag'
  // one tracking piece per player, colored by turn order
  | 'piece1'
  | 'piece2'
  | 'piece3'
  | 'piece4'
  | 'piece5'
  | 'piece6'
  | 'piece7'
  | 'piece8';

export const PIECE_STAMPS = [
  'piece1',
  'piece2',
  'piece3',
  'piece4',
  'piece5',
  'piece6',
  'piece7',
  'piece8',
] as const;

/** Piece stamps are unique per grid, like 'you' — placing one moves it. */
export function isUniqueStamp(s: Stamp): boolean {
  return s === 'you' || s.startsWith('piece');
}

export interface CellAnno {
  stamps: Stamp[];
  /** believed river flow, for the arrow */
  riverDir?: 'N' | 'E' | 'S' | 'W';
  note?: string;
}

export interface PlayerGrid {
  width: number;
  height: number;
  /** horizontal edges: (height+1) rows × width — same layout as EdgeGrid */
  h: EdgeMark[];
  /** vertical edges: height rows × (width+1) */
  v: EdgeMark[];
  cells: (CellAnno | null)[];
}

export interface PlayerMap {
  id: string;
  name: string;
  /** the main map has one grid per level; aux maps have exactly one */
  grids: PlayerGrid[];
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Fragment {
  width: number;
  height: number;
  h: EdgeMark[];
  v: EdgeMark[];
  cells: (CellAnno | null)[];
}

export function createGrid(width: number, height: number): PlayerGrid {
  return {
    width,
    height,
    h: new Array<EdgeMark>((height + 1) * width).fill('unknown'),
    v: new Array<EdgeMark>(height * (width + 1)).fill('unknown'),
    cells: new Array<CellAnno | null>(width * height).fill(null),
  };
}

export function cloneGrid(g: PlayerGrid): PlayerGrid {
  return JSON.parse(JSON.stringify(g)) as PlayerGrid;
}

export function cellIndex(g: { width: number }, x: number, y: number): number {
  return y * g.width + x;
}

const EDGE_CYCLE: EdgeMark[] = ['unknown', 'wall', 'open', 'grate'];

export function cycleEdge(g: PlayerGrid, x: number, y: number, side: 'N' | 'W'): PlayerGrid {
  const next = cloneGrid(g);
  if (side === 'N') {
    const i = y * g.width + x;
    next.h[i] = EDGE_CYCLE[(EDGE_CYCLE.indexOf(next.h[i]!) + 1) % EDGE_CYCLE.length]!;
  } else {
    const i = y * (g.width + 1) + x;
    next.v[i] = EDGE_CYCLE[(EDGE_CYCLE.indexOf(next.v[i]!) + 1) % EDGE_CYCLE.length]!;
  }
  return next;
}

/** Toggle a stamp on a cell; 'you' and pieces are unique per grid (they move). */
export function toggleStamp(g: PlayerGrid, x: number, y: number, stamp: Stamp, riverDir?: 'N' | 'E' | 'S' | 'W'): PlayerGrid {
  const next = cloneGrid(g);
  if (isUniqueStamp(stamp)) {
    for (const c of next.cells) {
      if (c) c.stamps = c.stamps.filter((s) => s !== stamp);
    }
  }
  const i = cellIndex(g, x, y);
  const cell = next.cells[i] ?? { stamps: [] };
  if (cell.stamps.includes(stamp) && stamp !== 'river') {
    cell.stamps = cell.stamps.filter((s) => s !== stamp);
  } else if (stamp === 'river' && cell.stamps.includes('river') && cell.riverDir === riverDir) {
    cell.stamps = cell.stamps.filter((s) => s !== 'river');
    delete cell.riverDir;
  } else {
    if (!cell.stamps.includes(stamp)) cell.stamps.push(stamp);
    if (stamp === 'river' && riverDir) cell.riverDir = riverDir;
  }
  next.cells[i] = cell.stamps.length === 0 && !cell.note ? null : cell;
  return next;
}

export function setNote(g: PlayerGrid, x: number, y: number, note: string): PlayerGrid {
  const next = cloneGrid(g);
  const i = cellIndex(g, x, y);
  const cell = next.cells[i] ?? { stamps: [] };
  if (note) cell.note = note;
  else delete cell.note;
  next.cells[i] = cell.stamps.length === 0 && !cell.note ? null : cell;
  return next;
}

export function clearCell(g: PlayerGrid, x: number, y: number): PlayerGrid {
  const next = cloneGrid(g);
  next.cells[cellIndex(g, x, y)] = null;
  // also reset the four surrounding edges to unknown
  next.h[y * g.width + x] = 'unknown';
  next.h[(y + 1) * g.width + x] = 'unknown';
  next.v[y * (g.width + 1) + x] = 'unknown';
  next.v[y * (g.width + 1) + x + 1] = 'unknown';
  return next;
}

export function normalizeRect(r: Rect): Rect {
  return {
    x0: Math.min(r.x0, r.x1),
    y0: Math.min(r.y0, r.y1),
    x1: Math.max(r.x0, r.x1),
    y1: Math.max(r.y0, r.y1),
  };
}

/** Copy a rectangle of cells + ALL edges touching them (inclusive borders). */
export function extract(g: PlayerGrid, rect: Rect): Fragment {
  const r = normalizeRect(rect);
  const width = r.x1 - r.x0 + 1;
  const height = r.y1 - r.y0 + 1;
  const frag: Fragment = {
    width,
    height,
    h: new Array<EdgeMark>((height + 1) * width).fill('unknown'),
    v: new Array<EdgeMark>(height * (width + 1)).fill('unknown'),
    cells: new Array<CellAnno | null>(width * height).fill(null),
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = g.cells[cellIndex(g, r.x0 + x, r.y0 + y)];
      frag.cells[y * width + x] = src ? (JSON.parse(JSON.stringify(src)) as CellAnno) : null;
    }
  }
  for (let row = 0; row <= height; row++) {
    for (let x = 0; x < width; x++) {
      frag.h[row * width + x] = g.h[(r.y0 + row) * g.width + (r.x0 + x)]!;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let col = 0; col <= width; col++) {
      frag.v[y * (width + 1) + col] = g.v[(r.y0 + y) * (g.width + 1) + (r.x0 + col)]!;
    }
  }
  return frag;
}

/**
 * Stamp a fragment onto a grid at (x, y). 'unknown' entries in the fragment
 * never erase existing knowledge — merging an auxiliary map onto the main map
 * only ADDS information. Out-of-bounds parts are clipped.
 */
export function paste(g: PlayerGrid, frag: Fragment, x: number, y: number): PlayerGrid {
  const next = cloneGrid(g);
  for (let fy = 0; fy < frag.height; fy++) {
    for (let fx = 0; fx < frag.width; fx++) {
      const tx = x + fx;
      const ty = y + fy;
      if (tx < 0 || ty < 0 || tx >= g.width || ty >= g.height) continue;
      const src = frag.cells[fy * frag.width + fx];
      if (src) next.cells[cellIndex(g, tx, ty)] = JSON.parse(JSON.stringify(src)) as CellAnno;
    }
  }
  for (let row = 0; row <= frag.height; row++) {
    for (let fx = 0; fx < frag.width; fx++) {
      const mark = frag.h[row * frag.width + fx]!;
      if (mark === 'unknown') continue;
      const tx = x + fx;
      const ty = y + row;
      if (tx < 0 || tx >= g.width || ty < 0 || ty > g.height) continue;
      next.h[ty * g.width + tx] = mark;
    }
  }
  for (let fy = 0; fy < frag.height; fy++) {
    for (let col = 0; col <= frag.width; col++) {
      const mark = frag.v[fy * (frag.width + 1) + col]!;
      if (mark === 'unknown') continue;
      const tx = x + col;
      const ty = y + fy;
      if (tx < 0 || tx > g.width || ty < 0 || ty >= g.height) continue;
      next.v[ty * (g.width + 1) + tx] = mark;
    }
  }
  return next;
}

/** Blank out a rectangle (used by cut and by "clear selection"). */
export function clearRect(g: PlayerGrid, rect: Rect): PlayerGrid {
  const r = normalizeRect(rect);
  let next = cloneGrid(g);
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      next = clearCell(next, x, y);
    }
  }
  return next;
}

/** Whole-grid fragment, for merging an auxiliary map onto the main map. */
export function gridToFragment(g: PlayerGrid): Fragment {
  return extract(g, { x0: 0, y0: 0, x1: g.width - 1, y1: g.height - 1 });
}
