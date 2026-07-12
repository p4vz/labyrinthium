/** Planar directions plus stair transit. U/D are only legal on stairway cells. */
export type Direction = 'N' | 'E' | 'S' | 'W' | 'U' | 'D';
export type PlanarDirection = 'N' | 'E' | 'S' | 'W';

export const PLANAR_DIRECTIONS: readonly PlanarDirection[] = ['N', 'E', 'S', 'W'];

/** 0-based cell coordinate within one level; y grows south (down). */
export interface Coord {
  x: number;
  y: number;
}

/** A position in the labyrinth: level index + cell coordinate. */
export interface Pos extends Coord {
  level: number;
}

export function coordEq(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

export function posEq(a: Pos, b: Pos): boolean {
  return a.level === b.level && a.x === b.x && a.y === b.y;
}

export function posKey(p: Pos): string {
  return `${p.level}:${p.x},${p.y}`;
}

export function coordKey(c: Coord): string {
  return `${c.x},${c.y}`;
}

const DELTAS: Record<PlanarDirection, Coord> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

export function isPlanar(d: Direction): d is PlanarDirection {
  return d === 'N' || d === 'E' || d === 'S' || d === 'W';
}

export function step(c: Coord, d: PlanarDirection): Coord {
  const delta = DELTAS[d];
  return { x: c.x + delta.x, y: c.y + delta.y };
}

export function opposite(d: PlanarDirection): PlanarDirection {
  switch (d) {
    case 'N':
      return 'S';
    case 'S':
      return 'N';
    case 'E':
      return 'W';
    case 'W':
      return 'E';
  }
}

/** Direction from a to b when they are orthogonally adjacent, else null. */
export function directionBetween(a: Coord, b: Coord): PlanarDirection | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 1 && dy === 0) return 'E';
  if (dx === -1 && dy === 0) return 'W';
  if (dx === 0 && dy === 1) return 'S';
  if (dx === 0 && dy === -1) return 'N';
  return null;
}
