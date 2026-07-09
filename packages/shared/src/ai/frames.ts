import type { Coord, PlanarDirection, Pos } from '../geometry.js';
import { cellId, edgeId, WorldBelief, type CellKnow, type EdgeObs } from './beliefs.js';

export type FrameKind = 'teleport' | 'trapdoor' | 'stairs';

export interface FrameEdge {
  x: number;
  y: number;
  d: PlanarDirection;
  obs: EdgeObs;
}

export interface FrameCell {
  x: number;
  y: number;
  know: CellKnow;
}

export interface AnchorEstimate {
  /** absolute position of the frame's origin cell (0,0) */
  anchor: Pos;
  p: number;
  entropy: number;
  /** count of anchors with non-zero mass */
  support: number;
}

/**
 * One disoriented region — the machine equivalent of a human's auxiliary map
 * sheet. Observations are recorded in RELATIVE coordinates (origin = where we
 * landed); the class maintains a Bayesian posterior over every possible
 * absolute placement of that origin. Observations are truthful, so any
 * contradiction eliminates an anchor outright; unknown territory scores
 * against the learned wall/feature priors. When the posterior collapses, the
 * whole sheet merges into the main map.
 */
export class FrameBelief {
  readonly id: number;
  readonly kind: FrameKind;
  readonly label: number | undefined;
  /** absolute cell we departed from, when we were localized at the time */
  readonly fromAbs: Pos | undefined;
  /** prior weight per level for the origin cell */
  readonly levelPrior: number[];
  /** extra prior mass on specific anchors (teleport-label hints), by posKey */
  readonly seeds = new Map<string, number>();
  /** anchors REJECTED by experience: merged there once and reality objected */
  readonly banned = new Set<string>();
  /** score exactly even after apparent contradiction? then flip to soft */
  private soft = false;

  edges = new Map<string, FrameEdge>();
  cells = new Map<string, FrameCell>();
  exits: { x: number; y: number; d: PlanarDirection }[] = [];
  /** times each relative cell was stood on — steers exploration outward */
  visits = new Map<string, number>();
  /** relative cells with a recent monster encounter -> turn it happened */
  hazards = new Map<string, number>();

  /** turn the disorientation began — long-lived sheets earn bolder guesses */
  openedTurn = 0;

  constructor(opts: {
    id: number;
    kind: FrameKind;
    levelPrior: number[];
    label?: number;
    fromAbs?: Pos;
    openedTurn?: number;
  }) {
    this.id = opts.id;
    this.kind = opts.kind;
    this.levelPrior = opts.levelPrior;
    this.label = opts.label;
    this.fromAbs = opts.fromAbs;
    this.openedTurn = opts.openedTurn ?? 0;
  }

  observeEdge(c: Coord, d: PlanarDirection, obs: EdgeObs): void {
    const prev = this.edges.get(edgeId(c, d));
    // never let a bump overwrite better knowledge (reinforced), nor stale
    // knowledge overwrite a fresh grenade result
    if (prev && prev.obs === 'reinforced' && obs === 'bumpedWall') return;
    this.edges.set(edgeId(c, d), { x: c.x, y: c.y, d, obs });
    if (obs === 'exit' && !this.exits.some((e) => e.x === c.x && e.y === c.y && e.d === d)) {
      this.exits.push({ x: c.x, y: c.y, d });
    }
  }

  observeCell(c: Coord, know: CellKnow): void {
    const key = cellId(c);
    const prev = this.cells.get(key);
    if (!prev) {
      this.cells.set(key, { x: c.x, y: c.y, know: { ...know } });
      return;
    }
    const merged = prev.know;
    if (know.visited) merged.visited = true;
    if (know.stairs !== undefined) merged.stairs = know.stairs;
    if (know.pad !== undefined && merged.pad === undefined) merged.pad = know.pad;
    if (know.pad !== undefined && typeof know.pad === 'object' && know.pad.label !== undefined) {
      merged.pad = know.pad;
    }
    if (know.trapdoor !== undefined) merged.trapdoor = know.trapdoor;
    if (know.river !== undefined) {
      const keepDir = typeof merged.river === 'object' && merged.river.dir !== undefined;
      if (!keepDir || know.river === 'none' || (typeof know.river === 'object' && know.river.dir !== undefined)) {
        merged.river = know.river;
      }
    }
  }

  /**
   * Full posterior re-score against current world knowledge. O(anchors ×
   * observations) with anchors ≤ 15·15·levels — trivially cheap, and a full
   * rescore every time sidesteps all staleness bugs as the world map grows.
   */
  score(world: WorldBelief): { weights: Float64Array[]; total: number } {
    const exact = this.scorePass(world, false);
    if (exact.total > 0) return exact;
    // Every anchor contradicted. Bans are hypotheses too — if ruling them
    // out rules out EVERYTHING, one of them was wrongly convicted (our map
    // held polluted data at rejection time). Pardon them and retry.
    if (this.banned.size > 0) {
      this.banned.clear();
      const retried = this.scorePass(world, false);
      if (retried.total > 0) return retried;
    }
    // Still nothing (a wall was grenaded since we mapped it, or an editor
    // map breaks a generator convention). Degrade mismatches to merely-
    // unlikely instead of impossible so the bot keeps functioning.
    this.soft = true;
    return this.scorePass(world, true);
  }

  private scorePass(world: WorldBelief, soft: boolean): { weights: Float64Array[]; total: number } {
    const weights = world.sizes.map((s) => new Float64Array(s.width * s.height));
    let total = 0;
    const floor = soft ? 0.03 : 0;
    for (let level = 0; level < world.sizes.length; level++) {
      const prior = this.levelPrior[level] ?? 0;
      if (prior <= 0) continue;
      const { width, height } = world.sizes[level]!;
      const arr = weights[level]!;
      for (let ay = 0; ay < height; ay++) {
        for (let ax = 0; ax < width; ax++) {
          if (this.banned.has(`${level}:${ax},${ay}`)) {
            weights[level]![ay * width + ax] = 0;
            continue;
          }
          let w = prior * (this.seeds.get(`${level}:${ax},${ay}`) ?? 1);
          if (this.kind === 'teleport') {
            // where can a teleport LAND? A two-way drops you on the twin pad
            // (same rune); a one-way's target is a plain feature-free cell.
            const originPad = world.cell(level, { x: ax, y: ay })?.pad;
            if (originPad === 'none') w *= 0.5; // one-way landing only
            else if (originPad !== undefined && typeof originPad === 'object' && originPad.label !== undefined) {
              if (this.label !== undefined) w *= originPad.label === this.label ? 30 : 0.05;
            }
          }
          for (const cell of this.cells.values()) {
            const abs = { x: ax + cell.x, y: ay + cell.y };
            if (!world.inBounds(level, abs)) {
              w = 0;
              break;
            }
            let know = cell.know;
            // A stairway transit GUARANTEES stairs at the landing cell, so
            // "origin has stairs" carries no information against cells whose
            // stairs status is unknown — only known-no-stairs cells veto.
            // Without this, the posterior piles onto the few stairs cells the
            // bot happens to know and merges there overconfidently.
            if (this.kind === 'stairs' && cell.x === 0 && cell.y === 0 && know.stairs !== undefined) {
              if (world.cell(level, abs)?.stairs === undefined) {
                know = { ...know };
                delete know.stairs;
              }
            }
            w *= Math.max(world.cellObsLikelihood(level, abs, know), floor);
            if (w === 0) break;
          }
          if (w > 0) {
            for (const edge of this.edges.values()) {
              const abs = { x: ax + edge.x, y: ay + edge.y };
              w *= Math.max(world.edgeObsLikelihood(level, abs, edge.d, edge.obs), floor);
              if (w === 0) break;
            }
          }
          arr[ay * width + ax] = w;
          total += w;
        }
      }
    }
    return { weights, total };
  }

  estimate(world: WorldBelief): AnchorEstimate | null {
    const { weights, total } = this.score(world);
    if (total <= 0) return null;
    let best = 0;
    let bestAnchor: Pos = { level: 0, x: 0, y: 0 };
    let entropy = 0;
    let support = 0;
    for (let level = 0; level < weights.length; level++) {
      const { width } = world.sizes[level]!;
      const arr = weights[level]!;
      for (let i = 0; i < arr.length; i++) {
        const p = arr[i]! / total;
        if (p <= 0) continue;
        support++;
        entropy -= p * Math.log(p);
        if (p > best) {
          best = p;
          bestAnchor = { level, x: i % width, y: Math.floor(i / width) };
        }
      }
    }
    return { anchor: bestAnchor, p: best, entropy, support };
  }

  /**
   * Expected information gain (nats) of probing direction `d` from relative
   * cell `from`, plus the chance the probe turns out open (which would move
   * us and end the turn — the planner prices that in).
   */
  probeGain(
    world: WorldBelief,
    from: Coord,
    d: PlanarDirection,
  ): { gain: number; pOpen: number } {
    const { weights, total } = this.score(world);
    if (total <= 0) return { gain: 0, pOpen: 0.5 };
    const outcomes: EdgeObs[] = ['open', 'bumpedWall', 'bumpedGrate', 'exit'];
    // per-outcome aggregate mass and per-outcome posterior entropy
    const mass = [0, 0, 0, 0];
    const ent = [0, 0, 0, 0];
    const like = new Float64Array(4);
    let h0 = 0;
    for (let level = 0; level < weights.length; level++) {
      const { width } = world.sizes[level]!;
      const arr = weights[level]!;
      for (let i = 0; i < arr.length; i++) {
        const w = arr[i]! / total;
        if (w <= 0) continue;
        h0 -= w * Math.log(w);
        const abs = { x: (i % width) + from.x, y: Math.floor(i / width) + from.y };
        let norm = 0;
        for (let o = 0; o < outcomes.length; o++) {
          like[o] = world.inBounds(level, abs)
            ? world.edgeObsLikelihood(level, abs, d, outcomes[o]!)
            : 0;
          norm += like[o]!;
        }
        if (norm <= 0) continue;
        for (let o = 0; o < outcomes.length; o++) {
          const m = (w * like[o]!) / norm;
          if (m > 0) {
            mass[o]! += m;
            ent[o]! -= m * Math.log(m);
          }
        }
      }
    }
    let hAfter = 0;
    for (let o = 0; o < outcomes.length; o++) {
      const m = mass[o]!;
      if (m <= 0) continue;
      // entropy of the normalized outcome-posterior, weighted by P(outcome)
      hAfter += m * (ent[o]! / m + Math.log(m));
    }
    return { gain: Math.max(0, h0 - hAfter), pOpen: mass[0]! };
  }

  /** Fold every observation into the main map at the resolved anchor. */
  merge(world: WorldBelief, anchor: Pos): void {
    for (const cell of this.cells.values()) {
      world.mergeCell(anchor.level, { x: anchor.x + cell.x, y: anchor.y + cell.y }, cell.know);
    }
    for (const edge of this.edges.values()) {
      world.setEdgeObs(anchor.level, { x: anchor.x + edge.x, y: anchor.y + edge.y }, edge.d, edge.obs);
    }
  }
}
