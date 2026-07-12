import {
  isPlanar,
  PLANAR_DIRECTIONS,
  posKey,
  step,
  type Coord,
  type PlanarDirection,
  type Pos,
} from '../geometry.js';
import type { GameEvent } from '../engine/events.js';
import type { PlayerAction } from '../engine/actions.js';
import type { Inventory } from '../engine/state.js';
import type { ActiveRules } from '../protocol/server.js';
import { edgeId, WorldBelief, type CellKnow } from './beliefs.js';
import { FrameBelief, type FrameKind } from './frames.js';
import { OpponentTracker } from './opponents.js';

export type BrainTier = 'hard' | 'expert';

export interface BrainConfig {
  tier: BrainTier;
  selfId: string;
  levelSizes: { width: number; height: number }[];
  entrance: Pos;
  exitSides: PlanarDirection[];
  inventory: Inventory;
  rules: ActiveRules;
  playerIds: string[];
  /** injectable randomness for deterministic tests */
  rng?: () => number;
}

/** self-imposed probing budget so turns stay brisk */
const MAX_PROBES = 3;
const MAX_BUMPS = 6;
const MAX_LIVE_FRAMES = 8;

/** Where the bot believes it stands: absolute when frame is null. */
interface Loc {
  frame: FrameBelief | null;
  level: number; // meaningful only when frame is null
  x: number;
  y: number;
}

/**
 * The hard/expert bot's mind. It plays the way a strong human plays the
 * pencil-and-paper game:
 *
 *  - keeps an ABSOLUTE main map plus one auxiliary sheet per disorientation
 *    (teleport / trapdoor / stairs), each with a Bayesian posterior over
 *    every placement of that sheet on the real grid;
 *  - spends free bumps on PROBES chosen to split its live hypotheses;
 *  - MERGES an aux sheet into the main map the moment the posterior
 *    collapses — pattern-matching the newly charted region onto what it
 *    already knows;
 *  - runs for a known exit once it carries the treasure, blasting a wall
 *    when that provably shortens the path;
 *  - (expert) dead-reckons every opponent from the public table-talk and
 *    times its shots at the probable treasure carrier.
 *
 * It consumes ONLY the events a human player would receive. No peeking.
 */
export class BayesianBrain {
  readonly world: WorldBelief;
  private frames: FrameBelief[] = [];
  private frameSeq = 0;
  private loc: Loc;
  private inventory: Inventory;
  private hasTreasure = false;
  private treasureUnderfoot = false;
  /** where the loot lies, if we believe we know (frame-relative aware) */
  private treasureAt: { frame: FrameBelief | null; level: number; x: number; y: number } | null = null;
  private ownMines = new Set<string>();
  /** absolute cells with a recent monster encounter -> turn it happened */
  private monsterSeen = new Map<string, number>();
  private tracker: OpponentTracker | null;
  private rng: () => number;
  private cfg: BrainConfig;

  // ---- per-turn bookkeeping ----
  private turnNumber = -1;
  private bumpsThisTurn = 0;
  private probedDirs = new Set<PlanarDirection>();
  // ---- cell-entry finalization (see finalizeEntry) ----
  private entryVia: 'start' | 'move' | 'drift' | 'teleport' | 'fall' | 'stairs' | null = null;
  private entrySawRiver = false;
  private entrySawStairs: ('U' | 'D')[] | null = null;
  // ---- futility escape: same spot, same plan, nothing learned ----
  private recentDecisions: string[] = [];
  /** each ride makes the same flight less appealing — kills stair ping-pong */
  private stairsUses = new Map<string, number>();
  /** committed exploration goal — chased until reached or worthless */
  private exploreTarget: Pos | null = null;
  /** committed escape goal while carrying the loot — two equidistant exits
   * must not take turns pulling us back and forth */
  private goalTarget: (Pos & { stairsDir?: 'U' | 'D' }) | null = null;
  private exploreTargetSince = 0;
  private exploreTargetBestDist = Infinity;
  /** targets we provably make no progress toward (rivers lie) -> banned turn */
  private unreachableUntil = new Map<string, number>();
  /** turn numbers of recent monster encounters (a shadowing guardian) */
  private recentEncounters: number[] = [];
  /** last successful walking direction — corridors pin coordinates fast */
  private lastMoveDir: PlanarDirection | null = null;
  /** last turn an explosion was heard anywhere (walls may have changed) */
  private lastExplosionTurn = -1;
  /**
   * A merge of the CURRENT frame is a testable hypothesis, not gospel. While
   * the guard is up, every world write is journaled and every observation
   * that is IMPOSSIBLE under the merged map counts as a surprise; too many
   * surprises and the whole merge is rolled back, the anchor banned, and the
   * bot resumes charting its aux sheet — hypothesis rejected.
   */
  private mergeGuard: {
    frame: FrameBelief;
    anchor: Pos;
    sinceTurn: number;
    surprises: number;
    /** observations matching knowledge that PREDATES the merge */
    confirms: number;
    /** merged on probability ratio, not proof — held to a higher standard */
    ratioBased: boolean;
    sawTreasureRel: Coord | null;
  } | null = null;

  constructor(cfg: BrainConfig) {
    this.cfg = cfg;
    this.rng = cfg.rng ?? Math.random;
    this.world = new WorldBelief(cfg.levelSizes);
    this.inventory = { ...cfg.inventory };
    for (const d of cfg.exitSides) {
      this.world.setEdgeObs(cfg.entrance.level, cfg.entrance, d, 'exit');
    }
    this.world.mergeCell(cfg.entrance.level, cfg.entrance, { visited: true });
    this.loc = { frame: null, level: cfg.entrance.level, x: cfg.entrance.x, y: cfg.entrance.y };
    this.entryVia = 'start';
    this.tracker =
      cfg.tier === 'expert' && cfg.rules.openInformation
        ? new OpponentTracker(cfg.levelSizes, cfg.entrance, cfg.playerIds, cfg.selfId)
        : null;
  }

  /** Is the bot confident about its absolute position? */
  isLocalized(): boolean {
    return this.loc.frame === null;
  }

  /** The absolute position the bot believes it stands on (null while lost). */
  believedPosition(): Pos | null {
    return this.loc.frame === null ? { level: this.loc.level, x: this.loc.x, y: this.loc.y } : null;
  }

  /** Localized AND the placement has survived its probation window. */
  isConfident(): boolean {
    return this.loc.frame === null && this.mergeGuard === null;
  }

  /** Live auxiliary sheets still awaiting a confident placement. */
  liveFrameCount(): number {
    return this.frames.length;
  }

  /**
   * The engine refused our action (it throws instead of emitting events).
   * At the table this is the game master saying "you can't do that" — free
   * information, and sometimes the very contradiction that unmasks a wrong
   * placement (climbing stairs that turn out not to be there).
   */
  noteRejected(action: PlayerAction, code: string): void {
    switch (code) {
      case 'NO_STAIRS_HERE':
        if (action.type === 'move' && !isPlanar(action.direction)) {
          this.observeCellHere({ stairs: [] });
        }
        break;
      case 'NO_AMMO':
        this.inventory.bullets = 0;
        break;
      case 'NO_GRENADES':
        this.inventory.grenades = 0;
        break;
      case 'NO_MINES':
        this.inventory.mines = 0;
        break;
      case 'NOTHING_TO_PICK_UP':
        this.treasureUnderfoot = false;
        break;
      default:
        break;
    }
  }

  noteTurn(turnNumber: number): void {
    if (turnNumber !== this.turnNumber) {
      this.turnNumber = turnNumber;
      this.bumpsThisTurn = 0;
      this.probedDirs.clear();
    }
  }

  handleEvent(e: GameEvent): void {
    const p = e.payload;
    if (p.type === 'explosionHeard') {
      // someone's grenade or a mine — walls may have changed somewhere
      this.lastExplosionTurn = this.turnNumber;
    }
    if (p.type === 'actionAnnounced') {
      // announcements carry their speaker; under open information they are
      // public, otherwise only our own reach us
      if (p.playerId === this.cfg.selfId) this.observeSelfAnnounce(p);
      else if (p.action === 'pickup') {
        // someone else lifted the loot — even off the very square we stand on
        this.treasureAt = null;
        this.treasureUnderfoot = false;
      }
      return;
    }
    const mine = e.visibility.kind === 'private' && e.visibility.playerId === this.cfg.selfId;
    if (mine) {
      this.observeSelf(p);
      return;
    }
    if (this.tracker && e.visibility.kind === 'private') {
      this.tracker.handleEvent(e.visibility.playerId, p, this.world);
    }
  }

  private observeSelfAnnounce(p: Extract<GameEvent['payload'], { type: 'actionAnnounced' }>): void {
    // our own declared action — the reliable place to spend inventory
    this.finalizeEntry();
    if (p.action === 'shoot') this.inventory.bullets--;
    else if (p.action === 'grenade') this.inventory.grenades--;
    else if (p.action === 'placeMine') {
      this.inventory.mines--;
      if (this.loc.frame === null) {
        this.ownMines.add(posKey({ level: this.loc.level, x: this.loc.x, y: this.loc.y }));
      }
    } else if (p.action === 'pickup') this.tracker?.noteSelfPickup();
  }

  private observeSelf(p: GameEvent['payload']): void {
    switch (p.type) {
      case 'moved':
        this.observeEdgeHere(p.direction, 'open');
        this.lastMoveDir = p.direction;
        this.relocate(step(this.loc, p.direction), 'move');
        break;
      case 'bumpedWall':
        this.bumpsThisTurn++;
        this.observeEdgeHere(p.direction, 'bumpedWall');
        break;
      case 'bumpedGrate':
        this.bumpsThisTurn++;
        this.observeEdgeHere(p.direction, 'bumpedGrate');
        break;
      case 'foundExit':
        this.bumpsThisTurn++;
        this.observeEdgeHere(p.direction, 'exit');
        break;
      case 'riverHere':
        this.entrySawRiver = true;
        this.observeCellHere({ river: {} });
        break;
      case 'riverDrift':
        if (p.direction !== undefined) {
          // the flow direction belongs to the cell we drift FROM
          this.observeCellHere({ river: { dir: p.direction } });
          this.relocate(step(this.loc, p.direction), 'drift');
        } else {
          // hard rivers: the GM hides which way the current dragged us. We
          // know only that we slid one cell downstream on this level — a
          // small disorientation. If we were localized, the landing is one
          // of our neighbors, so a fresh frame seeded with them re-localizes
          // almost at once.
          this.observeCellHere({ river: {} });
          this.openFrame('river');
        }
        break;
      case 'teleported': {
        this.observeCellHere({ pad: p.label !== undefined ? { label: p.label } : {} });
        this.resolveGuardOnDeparture();
        const from = this.loc;
        if (from.frame === null) {
          const dest = this.world.padDest.get(posKey({ level: from.level, x: from.x, y: from.y }));
          if (dest) {
            // we've ridden this pad before — no disorientation at all
            this.relocate({ frame: null, ...dest }, 'teleport');
            break;
          }
        } else if (
          p.label !== undefined &&
          from.frame.kind === 'teleport' &&
          from.frame.label === p.label
        ) {
          // The same rune that brought us into this frame. Labels are unique
          // per teleport set, so this pad belongs to the set we arrived by:
          // riding it again lands us back at a spot we have already charted —
          // no fresh sheet needed, and the loop-trap is defused.
          if (from.x !== 0 || from.y !== 0) {
            // stepped on the pad that originally sent us here -> its
            // destination is this frame's origin
            this.relocate({ frame: from.frame, level: 0, x: 0, y: 0 }, 'teleport');
            break;
          }
          // re-entered our own origin pad (two-way twin): we land on the
          // set's other pad — if we've charted it, we know exactly where
          const twin = [...from.frame.cells.values()].find(
            (c) =>
              (c.x !== 0 || c.y !== 0) &&
              typeof c.know.pad === 'object' &&
              c.know.pad?.label === p.label,
          );
          if (twin) {
            this.relocate({ frame: from.frame, level: 0, x: twin.x, y: twin.y }, 'teleport');
            break;
          }
        }
        this.openFrame('teleport', p.label);
        break;
      }
      case 'fellThroughTrapdoor': {
        this.observeCellHere({ trapdoor: true });
        this.resolveGuardOnDeparture();
        if (this.loc.frame === null) {
          const dest = this.world.padDest.get(posKey({ level: this.loc.level, x: this.loc.x, y: this.loc.y }));
          if (dest) {
            // we've dropped through this one before — known landing
            this.relocate({ frame: null, ...dest }, 'fall');
            break;
          }
        }
        this.openFrame('trapdoor');
        break;
      }
      case 'tookStairs': {
        this.resolveGuardOnDeparture();
        if (this.loc.frame === null) {
          const key = posKey({ level: this.loc.level, x: this.loc.x, y: this.loc.y });
          this.stairsUses.set(key, (this.stairsUses.get(key) ?? 0) + 1);
          const dest = this.world.stairsDest.get(
            posKey({ level: this.loc.level, x: this.loc.x, y: this.loc.y }),
          );
          if (dest) {
            // a flight we've climbed before — we know exactly where it lands
            this.relocate({ frame: null, ...dest }, 'stairs');
            break;
          }
        }
        this.openFrame('stairs', undefined, p.direction);
        break;
      }
      case 'stairsFound':
        this.entrySawStairs = [...p.directions];
        this.observeCellHere({ stairs: [...p.directions] });
        break;
      case 'treasureHere':
        this.treasureUnderfoot = true;
        this.treasureAt = { frame: this.loc.frame, level: this.loc.level, x: this.loc.x, y: this.loc.y };
        if (this.mergeGuard && this.loc.frame === null) {
          this.mergeGuard.sawTreasureRel = {
            x: this.loc.x - this.mergeGuard.anchor.x,
            y: this.loc.y - this.mergeGuard.anchor.y,
          };
        }
        break;
      case 'treasurePickedUp':
        this.hasTreasure = true;
        this.treasureUnderfoot = false;
        this.treasureAt = null;
        break;
      case 'treasureDropped':
        this.hasTreasure = false;
        // it fell at our feet — stand up (or wake up) and lift it again
        this.treasureUnderfoot = true;
        this.treasureAt = { frame: this.loc.frame, level: this.loc.level, x: this.loc.x, y: this.loc.y };
        this.tracker?.noteSelfDrop();
        break;
      case 'monsterEncounter':
        if (this.loc.frame === null) {
          this.monsterSeen.set(posKey({ level: this.loc.level, x: this.loc.x, y: this.loc.y }), this.turnNumber);
        } else {
          this.loc.frame.hazards.set(`${this.loc.x},${this.loc.y}`, this.turnNumber);
        }
        this.recentEncounters.push(this.turnNumber);
        if (this.recentEncounters.length > 8) this.recentEncounters.shift();
        break;
      case 'mineTriggered':
        // the mine is consumed — if it was ours, the cell is safe again
        if (this.loc.frame === null) {
          this.ownMines.delete(posKey({ level: this.loc.level, x: this.loc.x, y: this.loc.y }));
        }
        break;
      case 'wallDestroyed':
        this.observeEdgeHere(p.direction, 'open');
        break;
      case 'grenadeNoEffect':
        if (p.reason === 'reinforced') this.observeEdgeHere(p.direction, 'reinforced');
        break;
      case 'itemsFound':
        this.inventory.grenades += p.grenades;
        this.inventory.bullets += p.bullets;
        this.inventory.mines += p.mines;
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------
  // location & knowledge bookkeeping
  // ------------------------------------------------------------------

  private observeEdgeHere(d: PlanarDirection, obs: Parameters<WorldBelief['setEdgeObs']>[3]): void {
    if (this.loc.frame) {
      this.loc.frame.observeEdge(this.loc, d, obs);
      return;
    }
    const g = this.mergeGuard;
    if (g) {
      const like = this.world.edgeObsLikelihood(this.loc.level, this.loc, d, obs);
      if (like === 0) g.surprises++;
      else if (like === 1 && this.world.edgeKnownPreJournal(this.loc.level, this.loc, d)) {
        g.confirms++; // matched something we knew before the merge
      }
      // mirror into the guarded frame so a rollback loses nothing
      g.frame.observeEdge({ x: this.loc.x - g.anchor.x, y: this.loc.y - g.anchor.y }, d, obs);
    }
    this.world.setEdgeObs(this.loc.level, this.loc, d, obs);
  }

  private observeCellHere(know: CellKnow): void {
    if (this.loc.frame) {
      this.loc.frame.observeCell(this.loc, know);
      return;
    }
    const g = this.mergeGuard;
    if (g) {
      if (this.world.cellObsLikelihood(this.loc.level, this.loc, know) === 0) g.surprises++;
      g.frame.observeCell({ x: this.loc.x - g.anchor.x, y: this.loc.y - g.anchor.y }, know);
    }
    this.world.mergeCell(this.loc.level, this.loc, know);
  }

  private relocate(to: Coord | Loc, via: 'move' | 'drift' | 'teleport' | 'fall' | 'stairs'): void {
    this.finalizeEntry();
    this.treasureUnderfoot = false;
    if ('frame' in to) this.loc = { ...to };
    else this.loc = { ...this.loc, x: to.x, y: to.y };
    const f = this.loc.frame;
    if (f) {
      const key = `${this.loc.x},${this.loc.y}`;
      f.visits.set(key, (f.visits.get(key) ?? 0) + 1);
    }
    this.entryVia = via;
    this.entrySawRiver = false;
    this.entrySawStairs = null;
    // moving again means the probe map for this turn is stale
    this.probedDirs.clear();
  }

  /**
   * The entry pipeline for a cell has settled once our next action is
   * announced (or our turn comes up). Only then can silence be read as
   * absence: no riverHere = no river, no stairsFound = no stairs, and — for
   * every arrival mode except a teleport landing, which never re-fires —
   * no teleported/fell = no pad/trapdoor. That negative knowledge is what
   * makes the pattern-matching sharp.
   */
  private finalizeEntry(): void {
    const via = this.entryVia;
    if (via === null) return;
    this.entryVia = null;
    const know: CellKnow = {
      visited: true,
      stairs: this.entrySawStairs ?? [],
      river: this.entrySawRiver ? {} : 'none',
    };
    if (via !== 'teleport' && via !== 'start') {
      know.pad = 'none';
      know.trapdoor = false;
    }
    this.observeCellHere(know);
    // stale treasure note: we stand on the spot and the GM said nothing
    const t = this.treasureAt;
    if (
      t &&
      !this.treasureUnderfoot &&
      t.frame === this.loc.frame &&
      t.x === this.loc.x &&
      t.y === this.loc.y &&
      (t.frame !== null || t.level === this.loc.level)
    ) {
      this.treasureAt = null;
    }
  }

  private openFrame(kind: FrameKind, label?: number, stairsDir?: 'U' | 'D'): void {
    this.finalizeEntry();
    // a fresh disorientation ends the probation of the previous merge
    this.resolveGuardOnDeparture();
    // Relocations are deterministic per source cell: falling through the
    // same trapdoor (or riding the same pad, or taking the same stairs)
    // lands where it always lands. If we still hold the aux sheet from a
    // previous trip, RESUME it — its charted region, visit counts, and
    // rejected anchors all still apply.
    if (this.loc.frame === null) {
      const fromKey = posKey({ level: this.loc.level, x: this.loc.x, y: this.loc.y });
      const existing = this.frames.find(
        (f) => f.kind === kind && f.fromAbs !== undefined && posKey(f.fromAbs) === fromKey,
      );
      if (existing) {
        this.loc = { frame: existing, level: 0, x: 0, y: 0 };
        const key = '0,0';
        existing.visits.set(key, (existing.visits.get(key) ?? 0) + 1);
        this.entryVia =
          kind === 'teleport' ? 'teleport' : kind === 'trapdoor' ? 'fall' : kind === 'river' ? 'drift' : 'stairs';
        this.entrySawRiver = false;
        this.entrySawStairs = null;
        this.probedDirs.clear();
        return;
      }
    }
    const levels = this.cfg.levelSizes.length;
    const marginal = this.levelMarginal();
    const levelPrior = new Array<number>(levels).fill(0);
    if (kind === 'teleport') levelPrior.fill(1);
    else if (kind === 'river') {
      // rivers never cross levels — the drift keeps us where we were
      for (let l = 0; l < levels; l++) levelPrior[l] = marginal[l] ?? 0;
    } else {
      const delta = kind === 'trapdoor' || stairsDir === 'D' ? 1 : -1;
      for (let l = 0; l < levels; l++) {
        const from = l - delta;
        if (from >= 0 && from < levels) levelPrior[l] = marginal[from] ?? 0;
      }
    }
    const fromAbs =
      this.loc.frame === null ? { level: this.loc.level, x: this.loc.x, y: this.loc.y } : undefined;
    const frame = new FrameBelief({
      id: ++this.frameSeq,
      kind,
      levelPrior,
      label,
      fromAbs,
      openedTurn: this.turnNumber,
    });
    if (kind === 'stairs' && fromAbs) {
      // stairways whose landing we've already resolved lead elsewhere —
      // this flight cannot land on them
      for (const [cellKey, dest] of this.world.stairsDest) {
        if (posKey(dest) !== posKey(fromAbs)) frame.banned.add(cellKey);
      }
    }
    if (kind === 'teleport' && label !== undefined) {
      // a rune we've seen before is a huge hint: two-way pads share labels,
      // and a pad's destination never changes
      for (const pad of this.world.padsByLabel.get(label) ?? []) {
        if (fromAbs && posKey(pad) === posKey(fromAbs)) continue;
        frame.seeds.set(posKey(pad), 25);
        const dest = this.world.padDest.get(posKey(pad));
        if (dest) frame.seeds.set(posKey(dest), Math.max(frame.seeds.get(posKey(dest)) ?? 1, 25));
      }
    }
    if (kind === 'river' && fromAbs) {
      // a blind drift lands exactly one cell downstream — pile the prior on
      // the four neighbors of where we stood
      for (const d of PLANAR_DIRECTIONS) {
        const n = step(fromAbs, d);
        if (this.world.inBounds(fromAbs.level, n)) {
          frame.seeds.set(posKey({ level: fromAbs.level, ...n }), 40);
        }
      }
    }
    this.frames.push(frame);
    if (this.frames.length > MAX_LIVE_FRAMES) {
      const idx = this.frames.findIndex((f) => f !== frame);
      if (idx >= 0) this.frames.splice(idx, 1);
    }
    this.loc = { frame, level: 0, x: 0, y: 0 };
    this.entryVia =
          kind === 'teleport' ? 'teleport' : kind === 'trapdoor' ? 'fall' : kind === 'river' ? 'drift' : 'stairs';
    this.entrySawRiver = false;
    this.entrySawStairs = null;
    this.probedDirs.clear();
  }

  /** posterior over which level we stand on (degenerate when localized) */
  private levelMarginal(): number[] {
    const levels = this.cfg.levelSizes.length;
    const out = new Array<number>(levels).fill(0);
    if (this.loc.frame === null) {
      out[this.loc.level] = 1;
      return out;
    }
    const { weights, total } = this.loc.frame.score(this.world);
    if (total <= 0) return out.fill(1 / levels);
    for (let l = 0; l < levels; l++) {
      let m = 0;
      for (const w of weights[l]!) m += w;
      out[l] = m / total;
    }
    return out;
  }

  /** Merge every frame whose placement hypothesis has collapsed. */
  private sweepMerges(): void {
    let merged = true;
    while (merged && this.mergeGuard === null) {
      merged = false;
      for (const frame of [...this.frames]) {
        const est = frame.estimate(this.world);
        if (!est) continue;
        const isCurrent = this.loc.frame === frame;
        // PROOF (a single surviving placement) merges anything. A lopsided
        // probability ratio is what perceptual aliasing exploits, so it is
        // only accepted for the sheet we stand on — where the merge guard
        // can watch it, demand corroboration, and roll it back. And when a
        // sheet has resisted collapse for ages, act on the best guess like
        // a human would: commit, test, and revise on contradiction.
        const age = this.turnNumber - frame.openedTurn;
        // Guarded merges are revertible and wrong anchors get banned, so a
        // long-lived sheet degenerates into sequential hypothesis testing:
        // commit to the current best, let reality veto it, try the next.
        const desperate = isCurrent && ((age > 25 && est.p >= 0.5) || age > 50);
        if (est.support > 1 && !(isCurrent && est.p >= 0.98) && !desperate) continue;
        if (isCurrent) {
          // merging the sheet we STAND ON moves us — treat it as a live
          // hypothesis: journal everything until reality has had a chance
          // to object
          this.world.beginJournal();
        }
        frame.merge(this.world, est.anchor);
        this.registerLinks(frame, est.anchor);
        this.frames = this.frames.filter((f) => f !== frame);
        let treasureRel: Coord | null = null;
        if (this.treasureAt?.frame === frame) {
          treasureRel = { x: this.treasureAt.x, y: this.treasureAt.y };
          this.treasureAt = {
            frame: null,
            level: est.anchor.level,
            x: est.anchor.x + this.treasureAt.x,
            y: est.anchor.y + this.treasureAt.y,
          };
        }
        if (isCurrent) {
          this.loc = {
            frame: null,
            level: est.anchor.level,
            x: est.anchor.x + this.loc.x,
            y: est.anchor.y + this.loc.y,
          };
          this.mergeGuard = {
            frame,
            anchor: est.anchor,
            sinceTurn: this.turnNumber,
            surprises: 0,
            confirms: 0,
            ratioBased: est.support > 1,
            sawTreasureRel: treasureRel,
          };
          return; // no further merges while the hypothesis is on probation
        }
        merged = true;
      }
    }
  }

  /** The merged placement survived contact with reality: make it permanent. */
  private commitGuard(): void {
    if (!this.mergeGuard) return;
    this.mergeGuard = null;
    this.world.endJournal();
  }

  /**
   * We are about to leave the merged region (stairs, pad, trapdoor). A
   * proof-based or corroborated merge is committed; an uncorroborated
   * ratio-based one is quietly rolled back instead — the guarded frame kept
   * a mirror of everything, so no knowledge is lost, and no speculative map
   * data outlives its probation.
   */
  private resolveGuardOnDeparture(): void {
    const g = this.mergeGuard;
    if (!g) return;
    if (g.ratioBased && g.confirms < 2) {
      this.mergeGuard = null;
      this.world.revert(this.world.endJournal());
      this.frames.push(g.frame);
      if (this.loc.frame === null) {
        this.loc = { frame: g.frame, level: 0, x: this.loc.x - g.anchor.x, y: this.loc.y - g.anchor.y };
      }
      if (g.sawTreasureRel) {
        this.treasureAt = { frame: g.frame, level: 0, x: g.sawTreasureRel.x, y: g.sawTreasureRel.y };
      }
      return;
    }
    this.commitGuard();
  }

  /**
   * Reality contradicted the merge: roll the map back, ban the anchor, and
   * pick the aux sheet back up — with everything observed since folded in,
   * so the next placement hypothesis is sharper.
   */
  private rejectMerge(): void {
    const g = this.mergeGuard!;
    this.mergeGuard = null;
    this.world.revert(this.world.endJournal());
    g.frame.banned.add(posKey(g.anchor));
    this.frames.push(g.frame);
    this.loc = {
      frame: g.frame,
      level: 0,
      x: this.loc.x - g.anchor.x,
      y: this.loc.y - g.anchor.y,
    };
    if (g.sawTreasureRel) {
      this.treasureAt = { frame: g.frame, level: 0, x: g.sawTreasureRel.x, y: g.sawTreasureRel.y };
    }
  }

  /** A resolved frame teaches us permanent shortcuts (pads, stairways). */
  private registerLinks(frame: FrameBelief, anchor: Pos): void {
    if (!frame.fromAbs) return;
    const origin = { level: anchor.level, x: anchor.x, y: anchor.y };
    if (frame.kind === 'teleport' || frame.kind === 'trapdoor') {
      // padDest doubles as "known relocation destination of this cell"
      this.world.setPadDest(posKey(frame.fromAbs), origin);
      if (frame.kind === 'teleport' && frame.label !== undefined) {
        this.world.recordPad(frame.label, frame.fromAbs);
      }
    } else if (frame.kind === 'stairs') {
      this.world.setStairsDest(posKey(frame.fromAbs), origin);
      this.world.setStairsDest(posKey(origin), frame.fromAbs);
    }
  }

  // ------------------------------------------------------------------
  // decision making: probe -> update -> test/exploit
  // ------------------------------------------------------------------

  decide(canAct: boolean): PlayerAction {
    this.finalizeEntry();
    const g = this.mergeGuard;
    if (g) {
      // walls only ever change through explosions, and explosions are always
      // heard: with none since the merge, a single contradiction is proof
      const quiet = this.lastExplosionTurn < g.sinceTurn;
      if (g.surprises >= (quiet ? 1 : 2)) this.rejectMerge();
      // corroboration against pre-merge knowledge earns permanence; time
      // alone only suffices for proof-based merges (virgin territory can
      // never contradict a wrong ratio-based one)
      else if (g.confirms >= 2) this.commitGuard();
      else if (!g.ratioBased && this.turnNumber - g.sinceTurn > 40) this.commitGuard();
    }
    this.sweepMerges();

    if (this.treasureUnderfoot && !this.hasTreasure && canAct) return { type: 'pickup' };
    if (this.bumpsThisTurn > MAX_BUMPS) return this.forceMoveOrEnd();

    // A guardian keeps intercepting us in deterministic lockstep (its patrol
    // phase matches our approach): waiting a random beat breaks the rhythm,
    // like a player letting the patrol pass before crossing.
    const justHit = this.recentEncounters.filter((t) => this.turnNumber - t <= 2).length;
    const hitOften = this.recentEncounters.filter((t) => this.turnNumber - t < 10).length >= 3;
    if (justHit > 0 && hitOften && this.rng() < 0.4) return { type: 'endTurn' };

    const action = this.loc.frame
      ? this.decideDisoriented(this.loc.frame, canAct)
      : this.decideWorld(canAct);
    return this.antiFutility(this.coverFire(action, canAct));
  }

  /**
   * A guardian keeps catching us: before walking on, put a bullet down the
   * corridor we're about to take. Monsters die to bullets, silently — the
   * classic counter to a shadowing monster.
   */
  private coverFire(action: PlayerAction, canAct: boolean): PlayerAction {
    if (action.type !== 'move' || !isPlanar(action.direction)) return action;
    if (!canAct || this.inventory.bullets <= 0) return action;
    const recent = this.recentEncounters.filter((t) => this.turnNumber - t < 8);
    if (recent.length < 2) return action;
    const open = this.loc.frame
      ? this.loc.frame.edges.get(edgeId(this.loc, action.direction))?.obs === 'open'
      : this.world.edge(this.loc.level, this.loc, action.direction) === 'open';
    if (!open) return action;
    this.recentEncounters.length = 0; // one shot per scare
    return { type: 'shoot', direction: action.direction };
  }

  /**
   * Circuit breaker for plans the model cannot see failing (an unmapped
   * current bouncing us back, two stairways scoring each other's level as
   * greener grass, an editor map breaking an assumption): the same decision
   * from the same believed spot four times in a recent window — including
   * period-2/3 cycles — means we're rowing upstream. Try anything else.
   */
  private antiFutility(action: PlayerAction): PlayerAction {
    const sig = `${this.loc.frame?.id ?? 'w'}:${this.loc.level},${this.loc.x},${this.loc.y}|${JSON.stringify(action)}`;
    this.recentDecisions.push(sig);
    if (this.recentDecisions.length > 16) this.recentDecisions.shift();
    const repeats = this.recentDecisions.filter((s) => s === sig).length;
    if (repeats < 4 || action.type !== 'move') return action;
    const alternatives = PLANAR_DIRECTIONS.filter((d) => {
      if (d === action.direction) return false;
      if (this.loc.frame) return !this.frameBlocked(this.loc.frame, d);
      const e = this.world.edge(this.loc.level, this.loc, d);
      return e === 'open' || e === undefined;
    });
    // no alternative at all: the repeated move is still better than freezing
    if (alternatives.length === 0) return action;
    return { type: 'move', direction: alternatives[Math.floor(this.rng() * alternatives.length)]! };
  }

  /**
   * Lost after a teleport/fall/stairs: chart the region and probe walls that
   * best split the surviving placements until the posterior collapses.
   */
  private decideDisoriented(frame: FrameBelief, canAct: boolean): PlayerAction {
    void canAct;
    // an exit charted on this very sheet + the loot = just leave
    if (this.hasTreasure && frame.exits.length > 0) {
      const here = frame.exits.find((e) => e.x === this.loc.x && e.y === this.loc.y);
      if (here) return { type: 'move', direction: here.d };
      const stepDir = this.frameStepToward(frame, frame.exits.map((e) => ({ x: e.x, y: e.y })));
      if (stepDir) return { type: 'move', direction: stepDir };
    }

    const candidates = PLANAR_DIRECTIONS.filter((d) => !this.frameBlocked(frame, d));
    if (candidates.length === 0) return { type: 'endTurn' };

    let bestProbe: PlanarDirection | null = null;
    let bestProbeGain = 0;
    let bestMove: PlanarDirection = candidates[0]!;
    let bestMoveScore = -Infinity;
    for (const d of shuffle(candidates, this.rng)) {
      const { gain, pOpen } = frame.probeGain(this.world, this.loc, d);
      const targetKey = `${this.loc.x + delta(d).x},${this.loc.y + delta(d).y}`;
      const fresh = !frame.cells.has(targetKey);
      const visits = frame.visits.get(targetKey) ?? 0;
      // a charted pad would scramble us again — steer well clear of it
      const targetPad = frame.cells.get(targetKey)?.know.pad;
      const padPenalty = targetPad !== undefined && targetPad !== 'none' ? 5 : 0;
      const hazardTurn = frame.hazards.get(targetKey);
      const hazardPenalty = hazardTurn !== undefined && this.turnNumber - hazardTurn < 8 ? 3 : 0;
      // straight corridor runs hit borders fastest — the strongest anchor
      const runBonus = d === this.lastMoveDir ? 0.25 : 0;
      // moving explores AND informs; probing suspected walls is free info
      const moveScore =
        2 * gain + (fresh ? 0.5 : -0.4) + 0.2 * pOpen + runBonus - 0.4 * visits - padPenalty - hazardPenalty;
      if (moveScore > bestMoveScore) {
        bestMoveScore = moveScore;
        bestMove = d;
      }
      if (!this.probedDirs.has(d) && pOpen < 0.5 && gain > bestProbeGain) {
        bestProbeGain = gain;
        bestProbe = d;
      }
    }
    // hypothesis-splitting bump first, as long as the turn budget allows
    if (bestProbe && bestProbeGain >= 0.08 && this.probedDirs.size < MAX_PROBES) {
      this.probedDirs.add(bestProbe);
      return { type: 'move', direction: bestProbe };
    }
    // Everything adjacent is charted and uninformative: walk the sheet's
    // corridors to its nearest uncharted edge instead of dithering (and
    // leave any monster sharing this pocket behind while we're at it).
    if (bestMoveScore <= 0.15) {
      const frontier = this.frameFrontier(frame);
      const stepDir = frontier.length > 0 ? this.frameStepToward(frame, frontier) : null;
      if (stepDir) return { type: 'move', direction: stepDir };
      // No walkable path to anything uncharted: this pocket's way out must
      // be vertical (stairs) or magical (a pad). Losing this sheet beats
      // pacing it forever.
      const stairsHere = frame.cells.get(`${this.loc.x},${this.loc.y}`)?.know.stairs;
      if (stairsHere && stairsHere.length > 0) {
        return { type: 'move', direction: stairsHere[Math.floor(this.rng() * stairsHere.length)]! };
      }
      const escapes = [...frame.cells.values()].filter(
        (c) =>
          (c.know.stairs !== undefined && c.know.stairs.length > 0) ||
          (c.know.pad !== undefined && c.know.pad !== 'none'),
      );
      if (escapes.length > 0) {
        const toEscape = this.frameStepToward(frame, escapes.map((c) => ({ x: c.x, y: c.y })));
        if (toEscape) return { type: 'move', direction: toEscape };
      }
      // last resort: keep sweeping toward the least-trodden neighbor
      let least: PlanarDirection | null = null;
      let leastVisits = Infinity;
      for (const d of shuffle(candidates, this.rng)) {
        const v = frame.visits.get(`${this.loc.x + delta(d).x},${this.loc.y + delta(d).y}`) ?? 0;
        if (v < leastVisits) {
          leastVisits = v;
          least = d;
        }
      }
      if (least) return { type: 'move', direction: least };
    }
    return { type: 'move', direction: bestMove };
  }

  /** Relative cells of this sheet that still have an uncharted edge. */
  private frameFrontier(frame: FrameBelief): Coord[] {
    const out: Coord[] = [];
    for (const cell of frame.cells.values()) {
      if (cell.x === this.loc.x && cell.y === this.loc.y) continue;
      const pad = cell.know.pad;
      if (pad !== undefined && pad !== 'none') continue; // pads scramble us
      for (const d of PLANAR_DIRECTIONS) {
        if (!frame.edges.has(edgeId(cell, d))) {
          out.push({ x: cell.x, y: cell.y });
          break;
        }
      }
    }
    return out;
  }

  private frameBlocked(frame: FrameBelief, d: PlanarDirection): boolean {
    const e = frame.edges.get(edgeId(this.loc, d));
    if (!e) return false;
    if (e.obs === 'exit') return !this.hasTreasure;
    return e.obs !== 'open';
  }

  /** BFS over this sheet's believed-open edges toward any target cell. */
  private frameStepToward(frame: FrameBelief, targets: Coord[]): PlanarDirection | null {
    const targetKeys = new Set(targets.map((t) => `${t.x},${t.y}`));
    const start = `${this.loc.x},${this.loc.y}`;
    const seen = new Set([start]);
    const queue: { x: number; y: number; first: PlanarDirection | null }[] = [
      { x: this.loc.x, y: this.loc.y, first: null },
    ];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (targetKeys.has(`${cur.x},${cur.y}`) && cur.first) return cur.first;
      for (const d of PLANAR_DIRECTIONS) {
        const e = frame.edges.get(edgeId(cur, d));
        if (!e || e.obs !== 'open') continue;
        const nx = cur.x + delta(d).x;
        const ny = cur.y + delta(d).y;
        const key = `${nx},${ny}`;
        if (!seen.has(key)) {
          seen.add(key);
          queue.push({ x: nx, y: ny, first: cur.first ?? d });
        }
      }
    }
    return null;
  }

  /** Fully oriented: exploit the map — or extend it where it pays most. */
  private decideWorld(canAct: boolean): PlayerAction {
    const level = this.loc.level;
    const here: Coord = { x: this.loc.x, y: this.loc.y };

    if (canAct && this.tracker) {
      const shot = this.considerShot(level, here);
      if (shot) return shot;
      const mine = this.considerMine();
      if (mine) return mine;
    }

    // standing at a known way out with the loot: step through and win
    if (this.hasTreasure) {
      const exitHere = this.world.exits.find(
        (e) => e.pos.level === level && e.pos.x === here.x && e.pos.y === here.y,
      );
      if (exitHere) return { type: 'move', direction: exitHere.direction };
    }

    const { dist, firstStep } = this.dijkstra(level, here);

    if (canAct && this.hasTreasure && this.inventory.grenades > 0) {
      const g = this.considerGrenade(level, here, dist);
      if (g) return g;
    }

    const target = this.pickTarget(level, here, dist);
    if (target) {
      if (target.x === here.x && target.y === here.y) {
        if (target.stairsDir) return { type: 'move', direction: target.stairsDir };
        // the frontier is right here: test an unknown edge (free if it bumps;
        // level-0 border probes can reveal an exit gate)
        const unknown = shuffle(
          PLANAR_DIRECTIONS.filter(
            (d) =>
              this.world.edge(level, here, d) === undefined &&
              (!this.world.isBorder(level, here, d) || level === 0) &&
              !this.probedDirs.has(d),
          ),
          this.rng,
        );
        if (unknown.length > 0) {
          this.probedDirs.add(unknown[0]!);
          return { type: 'move', direction: unknown[0]! };
        }
      }
      const d = firstStep.get(cellKeyOf(target));
      if (d) return { type: 'move', direction: d };
    }
    // Nothing informative left to walk to: a region must be sealed behind a
    // known wall. Breach it — that's the only hypothesis left to test.
    if (this.inventory.grenades > 0) {
      const breach = this.pickBreach(level, here, dist);
      if (breach) {
        if (breach.x === here.x && breach.y === here.y) {
          // out of action budget? hold position; the grenade opens next turn
          return canAct ? { type: 'grenade', direction: breach.d } : { type: 'endTurn' };
        } else {
          const d = firstStep.get(cellKeyOf(breach));
          if (d) return { type: 'move', direction: d };
        }
      }
    }
    return this.forceMoveOrEnd();
  }

  private pickTarget(
    level: number,
    here: Coord,
    dist: Map<string, number>,
  ): (Coord & { stairsDir?: 'U' | 'D' }) | null {
    const size = this.world.sizes[level]!;
    // 1) carrying the loot: nearest reachable exit, or stairs toward level 0.
    // Commit to ONE goal — flip-flopping between equidistant exits walks in
    // place forever.
    if (this.hasTreasure) {
      const g = this.goalTarget;
      if (g && g.level === level && dist.get(cellKeyOf(g)) !== undefined) {
        return { x: g.x, y: g.y, ...(g.stairsDir ? { stairsDir: g.stairsDir } : {}) };
      }
      this.goalTarget = null;
      let best: (Coord & { stairsDir?: 'U' | 'D' }) | null = null;
      let bestCost = Infinity;
      for (const e of this.world.exits) {
        if (e.pos.level !== level) continue;
        const c = dist.get(cellKeyOf(e.pos)) ?? Infinity;
        if (c < bestCost) {
          bestCost = c;
          best = { x: e.pos.x, y: e.pos.y };
        }
      }
      if (!best && level !== 0) best = this.findStairs(level, dist, 'U');
      if (best) {
        this.goalTarget = { level, ...best };
        return best;
      }
    } else if (this.goalTarget) {
      this.goalTarget = null;
    }
    // 2) we know where the loot lies: go get it
    const t = this.treasureAt;
    if (t && t.frame === null && !this.hasTreasure) {
      if (t.level === level) return { x: t.x, y: t.y };
      const dir = t.level > level ? 'D' : 'U';
      const stairs = this.findStairs(level, dist, dir);
      if (stairs) return stairs;
    }
    // 3) explore: highest information-per-step frontier. The chosen target
    // is COMMITTED to until reached or exhausted — re-picking every turn
    // lets two equal frontiers volley the bot between them forever.
    const et = this.exploreTarget;
    if (et && et.level === level) {
      const cur = dist.get(cellKeyOf(et));
      if ((et.x === here.x && et.y === here.y) || this.exploreValue(level, et) <= 0) {
        this.exploreTarget = null;
      } else if (cur !== undefined) {
        if (cur < this.exploreTargetBestDist - 1e-9) {
          this.exploreTargetBestDist = cur;
          this.exploreTargetSince = this.turnNumber;
        } else if (this.turnNumber - this.exploreTargetSince > 8) {
          // chased for 8 turns without getting closer: the route model lies
          // (a current keeps sweeping us off) — shelve it for a while
          this.unreachableUntil.set(posKey(et), this.turnNumber + 60);
          this.exploreTarget = null;
        }
        if (this.exploreTarget) return { x: et.x, y: et.y };
      }
    } else if (et) {
      this.exploreTarget = null;
    }
    let best: (Coord & { stairsDir?: 'U' | 'D' }) | null = null;
    let bestScore = 0;
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const c = { x, y };
        const cost = dist.get(cellKeyOf(c));
        if (cost === undefined) continue;
        const value = this.exploreValue(level, c);
        if (value <= 0) continue;
        const score = value / (cost + 2);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    // a barely-charted neighbor level can beat a picked-over one
    const stairsCandidate = this.stairsToUnexplored(level, dist);
    if (stairsCandidate && (best === null || stairsCandidate.score > bestScore)) {
      this.exploreTarget = null;
      return stairsCandidate.target;
    }
    this.exploreTarget = best ? { level, x: best.x, y: best.y } : null;
    this.exploreTargetBestDist = Infinity;
    this.exploreTargetSince = this.turnNumber;
    return best;
  }

  /** Information still to be had by standing on this cell. */
  private exploreValue(level: number, c: Coord): number {
    const shelved = this.unreachableUntil.get(posKey({ level, ...c }));
    if (shelved !== undefined && this.turnNumber < shelved) return 0;
    // rivers sweep you off and pads teleport you away — neither can be
    // dwelt upon; only a river mouth we have provably STOOD on can
    const know = this.world.cell(level, c);
    if (know?.river !== undefined && know.river !== 'none' && !know.visited) return 0;
    if (know?.pad !== undefined && know.pad !== 'none') return 0;
    let value = 0;
    for (const d of PLANAR_DIRECTIONS) {
      if (this.world.edge(level, c, d) !== undefined) continue;
      if (!this.world.isBorder(level, c, d)) value += 1;
      // an unprobed stretch of the ground-level border might hide an exit
      // gate — worth a free bump, dearly so once we carry the loot
      else if (level === 0) value += this.hasTreasure ? 1 : 0.3;
    }
    if (!know?.visited) value += 0.5;
    if (value <= 0) return 0;
    // the treasure hides far from the entrance — bias the sweep outward
    if (!this.hasTreasure && level === this.cfg.entrance.level) {
      value += 0.12 * (Math.abs(c.x - this.cfg.entrance.x) + Math.abs(c.y - this.cfg.entrance.y));
    }
    return value;
  }

  private findStairs(
    level: number,
    dist: Map<string, number>,
    dir: 'U' | 'D',
  ): (Coord & { stairsDir: 'U' | 'D' }) | null {
    const size = this.world.sizes[level]!;
    let best: (Coord & { stairsDir: 'U' | 'D' }) | null = null;
    let bestCost = Infinity;
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const stairs = this.world.cell(level, { x, y })?.stairs;
        if (!stairs || !stairs.includes(dir)) continue;
        const c = dist.get(cellKeyOf({ x, y })) ?? Infinity;
        if (c < bestCost) {
          bestCost = c;
          best = { x, y, stairsDir: dir };
        }
      }
    }
    return best;
  }

  private stairsToUnexplored(
    level: number,
    dist: Map<string, number>,
  ): { target: Coord & { stairsDir: 'U' | 'D' }; score: number } | null {
    let best: { target: Coord & { stairsDir: 'U' | 'D' }; score: number } | null = null;
    const size = this.world.sizes[level]!;
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const stairs = this.world.cell(level, { x, y })?.stairs;
        if (!stairs || stairs.length === 0) continue;
        const cost = dist.get(cellKeyOf({ x, y }));
        if (cost === undefined) continue;
        for (const dir of stairs) {
          const other = level + (dir === 'D' ? 1 : -1);
          const frac = this.unexploredFraction(other);
          if (frac === null) continue;
          // every past ride discounts this flight, so two stairways can't
          // volley the bot between levels forever
          const uses = this.stairsUses.get(posKey({ level, x, y })) ?? 0;
          const score = (6 * frac) / ((cost + 3) * (1 + uses));
          if (!best || score > best.score) best = { target: { x, y, stairsDir: dir }, score };
        }
      }
    }
    return best;
  }

  private unexploredFraction(level: number): number | null {
    const size = this.world.sizes[level];
    if (!size) return null;
    let unvisited = 0;
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        if (!this.world.cell(level, { x, y })?.visited) unvisited++;
      }
    }
    return unvisited / (size.width * size.height);
  }

  /**
   * Shortest believed paths from here. Unknown edges are pass-able but taxed
   * by the wall prior — walking one doubles as a live hypothesis test: if it
   * bumps, the answer was free and we re-plan within the same turn.
   */
  private dijkstra(
    level: number,
    start: Coord,
    forcedOpen?: { c: Coord; d: PlanarDirection },
  ): { dist: Map<string, number>; firstStep: Map<string, PlanarDirection> } {
    const size = this.world.sizes[level]!;
    const dist = new Map<string, number>([[cellKeyOf(start), 0]]);
    const firstStep = new Map<string, PlanarDirection>();
    const pq: { c: Coord; cost: number; first: PlanarDirection | null }[] = [
      { c: start, cost: 0, first: null },
    ];
    const pWall = this.world.pWall();
    const forcedId = forcedOpen ? edgeId(forcedOpen.c, forcedOpen.d) : null;
    while (pq.length > 0) {
      pq.sort((a, b) => a.cost - b.cost);
      const cur = pq.shift()!;
      const curKey = cellKeyOf(cur.c);
      if ((dist.get(curKey) ?? Infinity) < cur.cost) continue;
      for (const d of PLANAR_DIRECTIONS) {
        const to = step(cur.c, d);
        if (to.x < 0 || to.y < 0 || to.x >= size.width || to.y >= size.height) continue;
        const edge = forcedId !== null && edgeId(cur.c, d) === forcedId ? 'open' : this.world.edge(level, cur.c, d);
        let edgeCost: number;
        if (edge === 'open') edgeCost = 1;
        else if (edge === undefined) edgeCost = 1 + 3 * pWall;
        else continue; // blocked / grate / reinforced / exit
        // A known river sweeps you downstream the moment you step in — and
        // keeps sweeping one cell per turn while you linger, so plan as if
        // the whole charted stretch carries you to its end.
        let landing = to;
        let toKnow = this.world.cell(level, to);
        let river = toKnow?.river;
        if (river !== undefined && river !== 'none' && typeof river === 'object' && river.dir === undefined) {
          edgeCost += 0.5; // current unknown: passable but unpredictable
        } else {
          let swept = 0;
          while (
            river !== undefined &&
            river !== 'none' &&
            typeof river === 'object' &&
            river.dir !== undefined &&
            swept < 12
          ) {
            landing = step(landing, river.dir);
            edgeCost += 1;
            swept++;
            if (landing.x < 0 || landing.y < 0 || landing.x >= size.width || landing.y >= size.height) break;
            toKnow = this.world.cell(level, landing);
            river = toKnow?.river;
          }
          if (landing.x === cur.c.x && landing.y === cur.c.y) continue; // swept straight back
          if (landing.x < 0 || landing.y < 0 || landing.x >= size.width || landing.y >= size.height) continue;
        }
        // A known pad relocates you: a resolved same-level pad is a portal,
        // anything else is a disorientation trap to walk around.
        const pad = this.world.cell(level, to)?.pad;
        if (pad !== undefined && pad !== 'none') {
          const dest = this.world.padDest.get(posKey({ level, ...to }));
          if (dest && dest.level === level) {
            landing = { x: dest.x, y: dest.y };
            edgeCost += 1;
          } else if (dest) {
            continue; // rides to another level: useless for this level's paths
          } else {
            edgeCost += 12; // destination unknown — losing the map is expensive
          }
        }
        const key = cellKeyOf(landing);
        if (this.ownMines.has(posKey({ level, ...landing }))) continue;
        const seenMonster = this.monsterSeen.get(posKey({ level, ...landing }));
        if (seenMonster !== undefined && this.turnNumber - seenMonster < 8) edgeCost += 6;
        const cost = cur.cost + edgeCost;
        if (cost < (dist.get(key) ?? Infinity)) {
          dist.set(key, cost);
          const first = cur.first ?? d;
          firstStep.set(key, first);
          pq.push({ c: landing, cost, first });
        }
      }
    }
    return { dist, firstStep };
  }

  /** Nearest reachable cell with a destructible wall onto unreached space. */
  private pickBreach(
    level: number,
    here: Coord,
    dist: Map<string, number>,
  ): (Coord & { d: PlanarDirection }) | null {
    void here;
    const size = this.world.sizes[level]!;
    let best: (Coord & { d: PlanarDirection }) | null = null;
    let bestCost = Infinity;
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const c = { x, y };
        const cost = dist.get(cellKeyOf(c));
        if (cost === undefined || cost >= bestCost) continue;
        for (const d of PLANAR_DIRECTIONS) {
          const edge = this.world.edge(level, c, d);
          if (edge !== 'blocked' && edge !== 'grate') continue;
          if (this.world.isBorder(level, c, d)) continue;
          const beyond = step(c, d);
          if (!this.world.inBounds(level, beyond)) continue;
          if (dist.get(cellKeyOf(beyond)) !== undefined) continue; // not sealed
          bestCost = cost;
          best = { x, y, d };
          break;
        }
      }
    }
    return best;
  }

  /** Blast a wall when it provably shortens the treasure run. */
  private considerGrenade(level: number, here: Coord, dist: Map<string, number>): PlayerAction | null {
    // "the goal" on the treasure run: an exit on this level, else stairs up
    const goals: Coord[] = this.world.exits.filter((e) => e.pos.level === level).map((e) => e.pos);
    if (goals.length === 0 && level !== 0) {
      const stairs = this.findStairs(level, dist, 'U');
      if (stairs) goals.push(stairs);
    }
    if (goals.length === 0) return null;
    const goalCost = (m: Map<string, number>): number =>
      Math.min(...goals.map((g) => m.get(cellKeyOf(g)) ?? Infinity));
    const before = goalCost(dist);
    for (const d of PLANAR_DIRECTIONS) {
      const edge = this.world.edge(level, here, d);
      if (edge !== 'blocked' && edge !== 'grate') continue;
      if (this.world.isBorder(level, here, d)) continue;
      const opened = this.dijkstra(level, here, { c: here, d });
      const after = goalCost(opened.dist);
      if (before - after >= 3 || (before === Infinity && after < Infinity)) {
        return { type: 'grenade', direction: d };
      }
    }
    return null;
  }

  /** Expert: a shot down a believed-open corridor at the probable carrier. */
  private considerShot(level: number, here: Coord): PlayerAction | null {
    if (!this.tracker || this.inventory.bullets <= 0) return null;
    const carrier = this.tracker.carrierId;
    for (const d of shuffle([...PLANAR_DIRECTIONS], this.rng)) {
      const corridor = this.corridor(level, here, d);
      if (corridor.length === 0) continue;
      if (carrier && carrier !== this.cfg.selfId) {
        if (this.tracker.massAt(carrier, level, corridor) >= 0.3) return { type: 'shoot', direction: d };
      } else if (this.hasTreasure) {
        for (const op of this.tracker.players()) {
          if (this.tracker.massAt(op, level, corridor) >= 0.5) return { type: 'shoot', direction: d };
        }
      }
    }
    return null;
  }

  /** Expert: drop a mine behind us when a pursuer is breathing down our neck. */
  private considerMine(): PlayerAction | null {
    if (!this.tracker || !this.hasTreasure || this.inventory.mines <= 0) return null;
    const pos = { level: this.loc.level, x: this.loc.x, y: this.loc.y };
    if (this.ownMines.has(posKey(pos))) return null;
    for (const op of this.tracker.players()) {
      if (this.tracker.proximity(op, pos, 3) >= 0.5) return { type: 'placeMine' };
    }
    return null;
  }

  /** Cells swept by a bullet fired from `from` toward `d`, per our map. */
  private corridor(level: number, from: Coord, d: PlanarDirection): Coord[] {
    const out: Coord[] = [];
    let c = { ...from };
    for (let i = 0; i < 15; i++) {
      if (this.world.edge(level, c, d) !== 'open') break;
      c = step(c, d);
      out.push({ ...c });
    }
    return out;
  }

  private forceMoveOrEnd(): PlayerAction {
    const open = PLANAR_DIRECTIONS.filter((d) => {
      if (this.loc.frame) {
        return this.loc.frame.edges.get(edgeId(this.loc, d))?.obs === 'open';
      }
      return this.world.edge(this.loc.level, this.loc, d) === 'open';
    });
    if (open.length > 0) {
      return { type: 'move', direction: open[Math.floor(this.rng() * open.length)]! };
    }
    return { type: 'endTurn' };
  }

  // ------------------------------------------------------------------
  // spectator rendering — same grid shapes the web client draws
  // ------------------------------------------------------------------

  exportBeliefMaps(): unknown {
    const grids = this.world.sizes.map((size, level) => this.exportWorldGrid(level, size));
    const maps: unknown[] = [{ id: 'main', name: 'Main map', grids }];
    for (const frame of this.frames) {
      const grid = this.exportFrameGrid(frame);
      if (grid) maps.push({ id: `aux-${frame.id}`, name: `Aux ${frame.id}`, grids: [grid] });
    }
    return maps;
  }

  private exportWorldGrid(level: number, size: { width: number; height: number }): unknown {
    const grid = {
      width: size.width,
      height: size.height,
      h: new Array<string>((size.height + 1) * size.width).fill('unknown'),
      v: new Array<string>(size.height * (size.width + 1)).fill('unknown'),
      cells: new Array<Record<string, unknown> | null>(size.width * size.height).fill(null),
    };
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        const c = { x, y };
        const north = this.world.edge(level, c, 'N');
        if (north) grid.h[y * size.width + x] = edgeMark(north);
        const west = this.world.edge(level, c, 'W');
        if (west) grid.v[y * (size.width + 1) + x] = edgeMark(west);
        if (y === size.height - 1) {
          const south = this.world.edge(level, c, 'S');
          if (south) grid.h[(y + 1) * size.width + x] = edgeMark(south);
        }
        if (x === size.width - 1) {
          const east = this.world.edge(level, c, 'E');
          if (east) grid.v[y * (size.width + 1) + x + 1] = edgeMark(east);
        }
        const cell = this.exportCell(level, c);
        if (cell) grid.cells[y * size.width + x] = cell;
      }
    }
    return grid;
  }

  private exportCell(level: number, c: Coord): Record<string, unknown> | null {
    const know = this.world.cell(level, c);
    const stamps: string[] = [];
    const extra: Record<string, unknown> = {};
    if (know) {
      if (know.pad !== undefined && know.pad !== 'none') {
        stamps.push('teleport');
        if (know.pad.label !== undefined) extra.tpLabel = know.pad.label;
      }
      if (know.stairs && know.stairs.length > 0) stamps.push('stairs');
      if (know.trapdoor === true) stamps.push('trapdoor');
      if (know.river !== undefined && know.river !== 'none') {
        stamps.push('river');
        if (typeof know.river === 'object' && know.river.dir) extra.riverDir = know.river.dir;
      }
    }
    if (this.ownMines.has(posKey({ level, ...c }))) stamps.push('mine');
    const t = this.treasureAt;
    if (t && t.frame === null && t.level === level && t.x === c.x && t.y === c.y) stamps.push('treasure');
    if (this.loc.frame === null && this.loc.level === level && this.loc.x === c.x && this.loc.y === c.y) {
      stamps.push('you');
      if (this.treasureUnderfoot && !this.hasTreasure && !stamps.includes('treasure')) stamps.push('treasure');
    }
    if (stamps.length === 0) return null;
    return { stamps, ...extra };
  }

  /** One live aux sheet, windowed the way a human centers a fresh page. */
  private exportFrameGrid(frame: FrameBelief): unknown | null {
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    let any = false;
    const consider = (x: number, y: number): void => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      any = true;
    };
    for (const e of frame.edges.values()) consider(e.x, e.y);
    for (const c of frame.cells.values()) consider(c.x, c.y);
    if (!any) return null;
    const margin = 1;
    const ox = margin - minX;
    const oy = margin - minY;
    const width = Math.min(maxX - minX + 1 + margin * 2, 15);
    const height = Math.min(maxY - minY + 1 + margin * 2, 15);
    const grid = {
      width,
      height,
      h: new Array<string>((height + 1) * width).fill('unknown'),
      v: new Array<string>(height * (width + 1)).fill('unknown'),
      cells: new Array<Record<string, unknown> | null>(width * height).fill(null),
    };
    for (const e of frame.edges.values()) {
      const mark =
        e.obs === 'open' ? 'open' : e.obs === 'bumpedGrate' ? 'grate' : e.obs === 'exit' ? 'exit' : 'wall';
      const x = e.x + ox;
      const y = e.y + oy;
      if (e.d === 'N' && x >= 0 && x < width && y >= 0 && y <= height) grid.h[y * width + x] = mark;
      else if (e.d === 'S' && x >= 0 && x < width && y + 1 >= 0 && y + 1 <= height) grid.h[(y + 1) * width + x] = mark;
      else if (e.d === 'W' && x >= 0 && x <= width && y >= 0 && y < height) grid.v[y * (width + 1) + x] = mark;
      else if (e.d === 'E' && x + 1 >= 0 && x + 1 <= width && y >= 0 && y < height) grid.v[y * (width + 1) + x + 1] = mark;
    }
    for (const c of frame.cells.values()) {
      const x = c.x + ox;
      const y = c.y + oy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const stamps: string[] = [];
      const extra: Record<string, unknown> = {};
      if (c.know.pad !== undefined && c.know.pad !== 'none') {
        stamps.push('teleport');
        if (typeof c.know.pad === 'object' && c.know.pad.label !== undefined) extra.tpLabel = c.know.pad.label;
      }
      if (c.know.stairs && c.know.stairs.length > 0) stamps.push('stairs');
      if (c.know.river !== undefined && c.know.river !== 'none') stamps.push('river');
      if (this.loc.frame === frame && this.loc.x === c.x && this.loc.y === c.y) {
        stamps.push('you');
        if (this.treasureUnderfoot && !this.hasTreasure) stamps.push('treasure');
      }
      if (stamps.length > 0) grid.cells[y * width + x] = { stamps, ...extra };
    }
    return grid;
  }
}

function cellKeyOf(c: Coord): string {
  return `${c.x},${c.y}`;
}

/** EdgeKnown -> the mark vocabulary the web client's grids use. */
function edgeMark(known: 'open' | 'blocked' | 'grate' | 'reinforced' | 'exit'): string {
  switch (known) {
    case 'open':
      return 'open';
    case 'grate':
      return 'grate';
    case 'exit':
      return 'exit';
    case 'blocked':
    case 'reinforced':
      return 'wall';
  }
}

function delta(d: PlanarDirection): Coord {
  switch (d) {
    case 'N':
      return { x: 0, y: -1 };
    case 'E':
      return { x: 1, y: 0 };
    case 'S':
      return { x: 0, y: 1 };
    case 'W':
      return { x: -1, y: 0 };
  }
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}
