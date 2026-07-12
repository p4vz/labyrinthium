import type { Coord, PlanarDirection, Pos } from '../geometry.js';

/**
 * What a blind player can KNOW about an edge. 'blocked' means wall-or-
 * reinforced: bumping cannot tell them apart; only a wasted grenade
 * ('grenadeNoEffect' with reason 'reinforced') refines it.
 */
export type EdgeKnown = 'open' | 'blocked' | 'grate' | 'reinforced' | 'exit';

/** The distinguishable observation classes at an edge. */
export type EdgeObs = 'open' | 'bumpedWall' | 'bumpedGrate' | 'exit' | 'reinforced';

/**
 * Knowledge about one cell. Every field is tri-state: `undefined` = never
 * observed; otherwise it is exact. Entering a cell reveals its features
 * (stairsFound / riverHere / teleported / fellThroughTrapdoor fire, or their
 * absence proves absence) — EXCEPT a teleport landing pad, which never
 * re-fires on arrival, so a cell first entered as a teleport destination
 * keeps `pad`/`trapdoor` undefined.
 */
export interface CellKnow {
  visited?: boolean;
  /** exact stairway directions on the cell; [] = known none */
  stairs?: ('U' | 'D')[];
  /** teleport pad: known label, `{}` for an unlabeled pad, or 'none' */
  pad?: { label?: number } | 'none';
  trapdoor?: boolean;
  /** river through this cell; dir = downstream flow when we drifted */
  river?: { dir?: PlanarDirection } | 'none';
}

/** Canonical edge id within one level: every edge is the N or W side of a cell. */
export function edgeId(c: Coord, d: PlanarDirection): string {
  switch (d) {
    case 'N':
      return `h:${c.x},${c.y}`;
    case 'S':
      return `h:${c.x},${c.y + 1}`;
    case 'W':
      return `v:${c.x},${c.y}`;
    case 'E':
      return `v:${c.x + 1},${c.y}`;
  }
}

export function cellId(c: Coord): string {
  return `${c.x},${c.y}`;
}

function obsToKnown(obs: EdgeObs): EdgeKnown {
  switch (obs) {
    case 'open':
      return 'open';
    case 'bumpedWall':
      return 'blocked';
    case 'bumpedGrate':
      return 'grate';
    case 'exit':
      return 'exit';
    case 'reinforced':
      return 'reinforced';
  }
}

/** Could this observation occur at an edge known to be in this state? */
export function obsCompatible(obs: EdgeObs, known: EdgeKnown): boolean {
  switch (obs) {
    case 'open':
      return known === 'open';
    case 'bumpedWall':
      return known === 'blocked' || known === 'reinforced';
    case 'bumpedGrate':
      return known === 'grate';
    case 'exit':
      return known === 'exit';
    case 'reinforced':
      return known === 'reinforced' || known === 'blocked';
  }
}

/** chance that an unknown level-0 border edge is an exit gate (they are rare) */
const P_EXIT = 0.06;
/** chance that an unknown interior edge is a grate */
const P_GRATE = 0.05;
/** feature priors for unknown cells — small; they mostly cancel across anchors */
const P_STAIRS = 0.04;
const P_PAD = 0.03;
const P_TRAPDOOR = 0.02;
const P_RIVER = 0.12;

/**
 * First-touch undo log for a span of WorldBelief writes. Lets the brain
 * treat a frame merge as a REVERTIBLE hypothesis: accept it, keep playing,
 * and roll the whole map back if reality starts contradicting it.
 */
export interface WorldJournal {
  edges: Map<string, { level: number; key: string; prev: EdgeKnown | undefined }>;
  cells: Map<string, { level: number; key: string; prev: CellKnow | undefined }>;
  exitsLen: number;
  padDest: Map<string, Pos | undefined>;
  padsByLabel: Map<number, Pos[] | undefined>;
  stairsDest: Map<string, Pos | undefined>;
  nBlocked: number;
  nSeen: number;
}

/**
 * Everything the bot believes about the labyrinth in ABSOLUTE coordinates:
 * exact knowledge where observed, calibrated priors everywhere else. This is
 * the map a careful human would keep on their main sheet.
 */
export class WorldBelief {
  readonly sizes: { width: number; height: number }[];
  private edges: Map<string, EdgeKnown>[];
  private cells: Map<string, CellKnow>[];
  /** confirmed ways out (edge of `pos` toward `direction`) */
  exits: { pos: Pos; direction: PlanarDirection }[] = [];
  /** resolved teleports: pad posKey -> landing cell */
  padDest = new Map<string, Pos>();
  /** every pad position we've identified, by its visible rune */
  padsByLabel = new Map<number, Pos[]>();
  /** resolved stairways: cell posKey -> landing cell on the other level */
  stairsDest = new Map<string, Pos>();
  /** empirical wall-density counters (interior edges only) */
  private nBlocked = 0;
  private nSeen = 0;
  private journal: WorldJournal | null = null;

  constructor(sizes: { width: number; height: number }[]) {
    this.sizes = sizes;
    this.edges = sizes.map(() => new Map());
    this.cells = sizes.map(() => new Map());
  }

  /** Start recording first-touch previous values of every write. */
  beginJournal(): void {
    this.journal = {
      edges: new Map(),
      cells: new Map(),
      exitsLen: this.exits.length,
      padDest: new Map(),
      padsByLabel: new Map(),
      stairsDest: new Map(),
      nBlocked: this.nBlocked,
      nSeen: this.nSeen,
    };
  }

  /** Stop recording and hand back the log (null if none was active). */
  endJournal(): WorldJournal | null {
    const j = this.journal;
    this.journal = null;
    return j;
  }

  /** Undo every write captured by the journal — the hypothesis was wrong. */
  revert(j: WorldJournal | null): void {
    if (!j) return;
    for (const e of j.edges.values()) {
      if (e.prev === undefined) this.edges[e.level]!.delete(e.key);
      else this.edges[e.level]!.set(e.key, e.prev);
    }
    for (const c of j.cells.values()) {
      if (c.prev === undefined) this.cells[c.level]!.delete(c.key);
      else this.cells[c.level]!.set(c.key, c.prev);
    }
    this.exits.length = Math.min(this.exits.length, j.exitsLen);
    for (const [key, prev] of j.padDest) {
      if (prev === undefined) this.padDest.delete(key);
      else this.padDest.set(key, prev);
    }
    for (const [label, prev] of j.padsByLabel) {
      if (prev === undefined) this.padsByLabel.delete(label);
      else this.padsByLabel.set(label, prev);
    }
    for (const [key, prev] of j.stairsDest) {
      if (prev === undefined) this.stairsDest.delete(key);
      else this.stairsDest.set(key, prev);
    }
    this.nBlocked = j.nBlocked;
    this.nSeen = j.nSeen;
  }

  /** Was this edge already charted BEFORE the active journal span began? */
  edgeKnownPreJournal(level: number, c: Coord, d: PlanarDirection): boolean {
    const key = edgeId(c, d);
    const j = this.journal;
    if (j) {
      const rec = j.edges.get(`${level}:${key}`);
      if (rec) return rec.prev !== undefined;
    }
    return this.edges[level]?.get(key) !== undefined;
  }

  private noteEdgeWrite(level: number, key: string): void {
    const j = this.journal;
    if (!j) return;
    const jk = `${level}:${key}`;
    if (!j.edges.has(jk)) j.edges.set(jk, { level, key, prev: this.edges[level]!.get(key) });
  }

  private noteCellWrite(level: number, key: string): void {
    const j = this.journal;
    if (!j) return;
    const jk = `${level}:${key}`;
    if (!j.cells.has(jk)) {
      const prev = this.cells[level]!.get(key);
      j.cells.set(jk, { level, key, prev: prev ? { ...prev } : undefined });
    }
  }

  /** Empirical interior wall probability, Beta(5,6)-smoothed toward 0.45. */
  pWall(): number {
    return (this.nBlocked + 5) / (this.nSeen + 11);
  }

  inBounds(level: number, c: Coord): boolean {
    const s = this.sizes[level];
    return !!s && c.x >= 0 && c.y >= 0 && c.x < s.width && c.y < s.height;
  }

  /** Is the edge of cell `c` toward `d` on the outer border ring? */
  isBorder(level: number, c: Coord, d: PlanarDirection): boolean {
    const s = this.sizes[level]!;
    return (
      (d === 'N' && c.y === 0) ||
      (d === 'S' && c.y === s.height - 1) ||
      (d === 'W' && c.x === 0) ||
      (d === 'E' && c.x === s.width - 1)
    );
  }

  edge(level: number, c: Coord, d: PlanarDirection): EdgeKnown | undefined {
    return this.edges[level]?.get(edgeId(c, d));
  }

  setEdgeObs(level: number, c: Coord, d: PlanarDirection, obs: EdgeObs): void {
    const map = this.edges[level];
    if (!map || !this.inBounds(level, c)) return;
    const key = edgeId(c, d);
    this.noteEdgeWrite(level, key);
    const prev = map.get(key);
    let next = obsToKnown(obs);
    // A bump never downgrades knowledge that the wall is reinforced.
    if (prev === 'reinforced' && next === 'blocked') next = 'reinforced';
    map.set(key, next);
    if (prev === undefined && !this.isBorder(level, c, d)) {
      // first sighting of an interior edge feeds the wall-density estimate
      if (next === 'open') this.nSeen++;
      else if (next === 'blocked' || next === 'reinforced') {
        this.nSeen++;
        this.nBlocked++;
      }
    }
    if (next === 'exit') {
      const pos = { level, x: c.x, y: c.y };
      if (!this.exits.some((e) => e.pos.level === level && e.pos.x === c.x && e.pos.y === c.y && e.direction === d)) {
        this.exits.push({ pos, direction: d });
      }
    }
  }

  cell(level: number, c: Coord): CellKnow | undefined {
    return this.cells[level]?.get(cellId(c));
  }

  /** Merge freshly-learned cell knowledge; defined fields win over unknown. */
  mergeCell(level: number, c: Coord, know: CellKnow): void {
    const map = this.cells[level];
    if (!map || !this.inBounds(level, c)) return;
    const key = cellId(c);
    this.noteCellWrite(level, key);
    const prev = map.get(key) ?? {};
    const next: CellKnow = { ...prev };
    if (know.visited) next.visited = true;
    if (know.stairs !== undefined) next.stairs = know.stairs;
    if (know.pad !== undefined) {
      // never lose a learned label to a later 'none'/unlabeled sighting
      const prevPad = prev.pad;
      const keepLabel = typeof prevPad === 'object' && prevPad.label !== undefined;
      if (!keepLabel) next.pad = know.pad;
    }
    if (know.trapdoor !== undefined) next.trapdoor = know.trapdoor;
    if (know.river !== undefined) {
      const prevRiver = prev.river;
      const keepDir = typeof prevRiver === 'object' && prevRiver.dir !== undefined;
      if (!keepDir || know.river === 'none' || (typeof know.river === 'object' && know.river.dir !== undefined)) {
        next.river = know.river;
      }
    }
    map.set(key, next);
    if (know.pad !== undefined && know.pad !== 'none' && know.pad.label !== undefined) {
      this.recordPad(know.pad.label, { level, x: c.x, y: c.y });
    }
  }

  recordPad(label: number, pos: Pos): void {
    const list = this.padsByLabel.get(label) ?? [];
    if (!list.some((p) => p.level === pos.level && p.x === pos.x && p.y === pos.y)) {
      if (this.journal && !this.journal.padsByLabel.has(label)) {
        this.journal.padsByLabel.set(label, this.padsByLabel.get(label)?.slice());
      }
      this.padsByLabel.set(label, [...list, pos]);
    }
  }

  setPadDest(padKey: string, dest: Pos): void {
    if (this.journal && !this.journal.padDest.has(padKey)) {
      this.journal.padDest.set(padKey, this.padDest.get(padKey));
    }
    this.padDest.set(padKey, dest);
  }

  setStairsDest(cellKey: string, dest: Pos): void {
    if (this.journal && !this.journal.stairsDest.has(cellKey)) {
      this.journal.stairsDest.set(cellKey, this.stairsDest.get(cellKey));
    }
    this.stairsDest.set(cellKey, dest);
  }

  /**
   * P(seeing `obs` at this edge) — the anchor-likelihood workhorse. Exact
   * knowledge gives 0/1 (observations are truthful); unknown edges score
   * against the learned wall prior; the border is the strongest signal of
   * all: nothing but wall (or, on level 0, an exit gate) lives there.
   */
  edgeObsLikelihood(level: number, c: Coord, d: PlanarDirection, obs: EdgeObs): number {
    const known = this.edge(level, c, d);
    if (known !== undefined) return obsCompatible(obs, known) ? 1 : 0;
    if (this.isBorder(level, c, d)) {
      const pExit = level === 0 ? P_EXIT : 0;
      if (obs === 'exit') return pExit;
      if (obs === 'bumpedWall') return 1 - pExit;
      return 0;
    }
    const p = this.pWall();
    switch (obs) {
      case 'open':
        return (1 - p) * (1 - P_GRATE);
      case 'bumpedWall':
        return p * (1 - P_GRATE);
      case 'bumpedGrate':
        return P_GRATE;
      case 'reinforced':
        return p * 0.25;
      case 'exit':
        return 0;
    }
  }

  /** P(observing this cell knowledge) against what we know of the cell. */
  cellObsLikelihood(level: number, c: Coord, know: CellKnow): number {
    if (!this.inBounds(level, c)) return 0;
    const w = this.cell(level, c) ?? {};
    let f = 1;
    if (know.stairs !== undefined) {
      if (w.stairs !== undefined) {
        f *= sameStairs(know.stairs, w.stairs) ? 1 : 0;
      } else {
        f *= know.stairs.length > 0 ? P_STAIRS : 1 - P_STAIRS;
      }
    }
    if (know.pad !== undefined) {
      if (w.pad !== undefined) f *= padsMatch(know.pad, w.pad) ? 1 : 0;
      else f *= know.pad !== 'none' ? P_PAD : 1 - P_PAD;
    }
    if (know.trapdoor !== undefined) {
      if (w.trapdoor !== undefined) f *= know.trapdoor === w.trapdoor ? 1 : 0;
      else f *= know.trapdoor ? P_TRAPDOOR : 1 - P_TRAPDOOR;
    }
    if (know.river !== undefined) {
      if (w.river !== undefined) f *= riversMatch(know.river, w.river) ? 1 : 0;
      else f *= know.river !== 'none' ? P_RIVER : 1 - P_RIVER;
    }
    return f;
  }
}

function sameStairs(a: ('U' | 'D')[], b: ('U' | 'D')[]): boolean {
  return a.length === b.length && a.every((d) => b.includes(d));
}

function padsMatch(a: NonNullable<CellKnow['pad']>, b: NonNullable<CellKnow['pad']>): boolean {
  if (a === 'none' || b === 'none') return a === b;
  if (a.label === undefined || b.label === undefined) return true; // unlabeled matches any pad
  return a.label === b.label;
}

function riversMatch(a: NonNullable<CellKnow['river']>, b: NonNullable<CellKnow['river']>): boolean {
  if (a === 'none' || b === 'none') return a === b;
  if (a.dir === undefined || b.dir === undefined) return true;
  return a.dir === b.dir;
}
