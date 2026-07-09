import { step, type Coord, type PlanarDirection, type Pos } from '../geometry.js';
import type { EventPayload } from '../engine/events.js';
import type { WorldBelief } from './beliefs.js';

/** chance an unknown cell hosts a stairway / river, for motion weighting */
const P_STAIRS = 0.04;
const P_RIVER = 0.12;
/** per-turn uniform leak absorbing what we cannot observe (rivers, chains) */
const LEAK = 0.02;

/**
 * Where is everybody? Under the classic open-information table rules every
 * player's private observations are spoken aloud ("Bob bumped a wall going
 * north"), so a sharp listener can dead-reckon the others without ever seeing
 * the map. This tracker keeps one grid posterior per opponent, moved by their
 * announced observations through OUR current beliefs about the walls: mass
 * flows where we believe an edge is open, stays where we believe it's a wall,
 * and splits by the wall prior everywhere else.
 */
export class OpponentTracker {
  private dist = new Map<string, Float64Array[]>();
  private exited = new Set<string>();
  /** who is carrying the loot, as far as the table knows */
  carrierId: string | null = null;

  constructor(
    private sizes: { width: number; height: number }[],
    private entrance: Pos,
    playerIds: string[],
    private selfId: string,
  ) {
    for (const id of playerIds) {
      if (id === selfId) continue;
      const grids = sizes.map((s) => new Float64Array(s.width * s.height));
      grids[entrance.level]![entrance.y * sizes[entrance.level]!.width + entrance.x] = 1;
      this.dist.set(id, grids);
    }
  }

  players(): string[] {
    return [...this.dist.keys()].filter((id) => !this.exited.has(id));
  }

  /** Feed one of the opponent's announced observations through the model. */
  handleEvent(playerId: string, p: EventPayload, world: WorldBelief): void {
    const grids = this.dist.get(playerId);
    if (!grids || this.exited.has(playerId)) return;
    switch (p.type) {
      case 'moved':
        this.shift(grids, world, p.direction, 'open');
        break;
      case 'riverDrift':
        if (p.direction !== undefined) this.shift(grids, world, p.direction, 'river');
        // hard rivers hide the direction: the opponent slid one cell some
        // way downstream — spread their mass to the neighbourhood
        else this.diffuse(grids);
        break;
      case 'bumpedWall':
      case 'bumpedGrate':
      case 'foundExit':
        this.reweightStay(grids, world, p.direction, p.type);
        break;
      case 'teleported':
        // gone anywhere; labels could narrow it, but stay conservative
        this.uniform(grids);
        break;
      case 'fellThroughTrapdoor':
        this.changeLevel(grids, +1);
        break;
      case 'tookStairs':
        this.changeLevel(grids, p.direction === 'D' ? +1 : -1, world);
        break;
      case 'treasurePickedUp':
        this.carrierId = playerId;
        break;
      case 'treasureDropped':
        if (this.carrierId === playerId) this.carrierId = null;
        break;
      case 'exitedLabyrinth':
        this.exited.add(playerId);
        break;
      default:
        break;
    }
    this.leak(grids);
  }

  noteSelfPickup(): void {
    this.carrierId = this.selfId;
  }

  noteSelfDrop(): void {
    if (this.carrierId === this.selfId) this.carrierId = null;
  }

  /** Posterior mass of a player over specific cells of one level. */
  massAt(playerId: string, level: number, cells: Coord[]): number {
    const grids = this.dist.get(playerId);
    if (!grids || this.exited.has(playerId)) return 0;
    const width = this.sizes[level]?.width ?? 0;
    let m = 0;
    let total = 0;
    for (const g of grids) for (const w of g) total += w;
    if (total <= 0) return 0;
    for (const c of cells) m += grids[level]?.[c.y * width + c.x] ?? 0;
    return m / total;
  }

  /** Expected Manhattan distance from `pos`, same level only (∞ mass elsewhere ignored). */
  proximity(playerId: string, pos: Pos, radius: number): number {
    const grids = this.dist.get(playerId);
    if (!grids || this.exited.has(playerId)) return 0;
    const size = this.sizes[pos.level];
    if (!size) return 0;
    let total = 0;
    for (const g of grids) for (const w of g) total += w;
    if (total <= 0) return 0;
    let near = 0;
    const g = grids[pos.level]!;
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        if (Math.abs(x - pos.x) + Math.abs(y - pos.y) <= radius) near += g[y * size.width + x]!;
      }
    }
    return near / total;
  }

  /** A successful move (or river drift): mass flows one cell along `d`. */
  private shift(grids: Float64Array[], world: WorldBelief, d: PlanarDirection, mode: 'open' | 'river'): void {
    for (let level = 0; level < grids.length; level++) {
      const { width, height } = this.sizes[level]!;
      const src = grids[level]!;
      const out = new Float64Array(src.length);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const w = src[y * width + x]!;
          if (w <= 0) continue;
          const to = step({ x, y }, d);
          if (!world.inBounds(level, to)) continue;
          let p: number;
          if (mode === 'river') {
            const know = world.cell(level, { x, y });
            const river = know?.river;
            p = river === 'none' ? 0 : typeof river === 'object' ? (river.dir === undefined || river.dir === d ? 1 : 0) : P_RIVER;
          } else {
            const edge = world.edge(level, { x, y }, d);
            p = edge === 'open' ? 1 : edge === undefined ? 1 - world.pWall() : 0;
          }
          out[to.y * width + to.x]! += w * p;
        }
      }
      grids[level] = out;
    }
    this.normalize(grids);
  }

  /** A blind, on-level nudge: bleed each cell's mass to its neighbours. */
  private diffuse(grids: Float64Array[]): void {
    for (let level = 0; level < grids.length; level++) {
      const { width, height } = this.sizes[level]!;
      const src = grids[level]!;
      const out = new Float64Array(src.length);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const w = src[y * width + x]!;
          if (w <= 0) continue;
          const dests: Coord[] = [];
          for (const d of ['N', 'E', 'S', 'W'] as const) {
            const to = step({ x, y }, d);
            if (to.x >= 0 && to.y >= 0 && to.x < width && to.y < height) dests.push(to);
          }
          if (dests.length === 0) {
            out[y * width + x]! += w;
            continue;
          }
          for (const to of dests) out[to.y * width + to.x]! += w / dests.length;
        }
      }
      grids[level] = out;
    }
    this.normalize(grids);
  }

  /** A bump: mass stays, reweighted by P(that edge blocks) under our map. */
  private reweightStay(
    grids: Float64Array[],
    world: WorldBelief,
    d: PlanarDirection,
    kind: 'bumpedWall' | 'bumpedGrate' | 'foundExit',
  ): void {
    for (let level = 0; level < grids.length; level++) {
      const { width, height } = this.sizes[level]!;
      const g = grids[level]!;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          if (g[i]! <= 0) continue;
          g[i]! *= world.edgeObsLikelihood(level, { x, y }, d, kind === 'foundExit' ? 'exit' : kind);
        }
      }
    }
    this.normalize(grids);
  }

  private changeLevel(grids: Float64Array[], delta: number, world?: WorldBelief): void {
    const out = this.sizes.map((s) => new Float64Array(s.width * s.height));
    for (let level = 0; level < grids.length; level++) {
      const target = level + delta;
      if (target < 0 || target >= this.sizes.length) continue;
      const { width, height } = this.sizes[level]!;
      let mass = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let w = grids[level]![y * width + x]!;
          if (w <= 0) continue;
          if (world) {
            // stairs transit: weight source cells by P(stairs here)
            const stairs = world.cell(level, { x, y })?.stairs;
            w *= stairs === undefined ? P_STAIRS : stairs.length > 0 ? 1 : 0;
          }
          mass += w;
        }
      }
      if (mass <= 0) continue;
      // landing cell is unknowable: spread over the target level
      const t = out[target]!;
      const per = mass / t.length;
      for (let i = 0; i < t.length; i++) t[i]! += per;
    }
    for (let level = 0; level < grids.length; level++) grids[level] = out[level]!;
    this.normalize(grids);
  }

  private uniform(grids: Float64Array[]): void {
    let cells = 0;
    for (const g of grids) cells += g.length;
    for (const g of grids) g.fill(1 / cells);
  }

  private leak(grids: Float64Array[]): void {
    let cells = 0;
    let total = 0;
    for (const g of grids) {
      cells += g.length;
      for (const w of g) total += w;
    }
    if (total <= 0) {
      this.uniform(grids);
      return;
    }
    for (const g of grids) {
      for (let i = 0; i < g.length; i++) {
        g[i] = (g[i]! / total) * (1 - LEAK) + LEAK / cells;
      }
    }
  }

  private normalize(grids: Float64Array[]): void {
    let total = 0;
    for (const g of grids) for (const w of g) total += w;
    if (total <= 0) {
      this.uniform(grids);
      return;
    }
    for (const g of grids) for (let i = 0; i < g.length; i++) g[i]! /= total;
  }
}
