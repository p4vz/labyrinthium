import {
  BayesianBrain,
  type BotDifficulty,
  type EventPayload,
  type Inventory,
  type PlayerAction,
  type ServerMessage,
} from '@labyrinthium/shared';

type Dir = 'N' | 'E' | 'S' | 'W';
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const DELTA: Record<Dir, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

/** Relative coordinate inside the bot's current reference frame. */
interface RelPos {
  frame: number;
  x: number;
  y: number;
}

/**
 * A server-side player: it perceives the game EXACTLY like a human — only
 * through its own private events — and keeps a belief map, so it cheats at
 * nothing. Teleports/trapdoors/stairs throw away its frame of reference
 * (just like they disorient a human), starting a fresh relative map.
 *
 * Difficulties:
 *  - easy:   drunkard's walk.
 *  - medium: belief-map explorer — avoids known walls, prefers unvisited
 *            cells, runs for a known exit once it carries the treasure.
 *  - hard:   Bayesian hypothesis tester (shared/src/ai): probes walls for
 *            information, keeps a posterior over where every disoriented
 *            region fits the map, and merges it back once it pattern-matches.
 *  - expert: hard + dead-reckons opponents from the open-information
 *            table-talk, shooting the probable treasure carrier and mining
 *            its own trail when pursued.
 */
export class BotController {
  /** the Bayesian mind driving hard/expert; easy/medium use the legacy code */
  private brain: BayesianBrain | null = null;
  private pos: RelPos | null = null;
  private frame = 0;
  private edges = new Map<string, 'open' | 'blocked' | 'reinforced'>();
  private visits = new Map<string, number>();
  private bumps = new Map<string, number>();
  private knownExits: { pos: RelPos; direction: Dir }[] = [];
  private hasTreasure = false;
  private inventory: Inventory = { grenades: 0, bullets: 0, mines: 0 };
  private pendingDirection: Dir | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** turn-budget bookkeeping (turn = one action + a move) */
  private canAct = true;
  private treasureUnderfoot = false;
  private bumpsThisTurn = 0;
  private lastTurnNumber = -1;

  constructor(
    readonly playerId: string,
    readonly difficulty: BotDifficulty,
    private act: (action: PlayerAction) => void,
  ) {}

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** The room refused an action — the Bayesian brain learns from the "no". */
  noteRejected(action: PlayerAction, code: string): void {
    this.brain?.noteRejected(action, code);
  }

  private levelSizes: { width: number; height: number }[] = [];
  private entrance: { level: number; x: number; y: number } | null = null;
  /** labeled teleport pads seen while still oriented (frame-0 coords) */
  private knownTeleports: { x: number; y: number; label: number }[] = [];

  handle(msg: ServerMessage): void {
    if (this.stopped) return;
    switch (msg.type) {
      case 'game.started':
        if (this.difficulty === 'hard' || this.difficulty === 'expert') {
          this.brain = new BayesianBrain({
            tier: this.difficulty,
            selfId: this.playerId,
            levelSizes: msg.levelSizes,
            entrance: msg.entrance,
            exitSides: msg.exitSides,
            inventory: msg.inventory,
            rules: msg.rules,
            playerIds: msg.turnOrder.map((p) => p.id),
          });
          break;
        }
        this.pos = { frame: 0, x: 0, y: 0 };
        this.inventory = { ...msg.inventory };
        this.levelSizes = msg.levelSizes;
        this.entrance = msg.entrance;
        // The entrance gate IS the exit and everyone knows it from turn one.
        for (const side of msg.exitSides) {
          this.knownExits.push({ pos: { frame: 0, x: 0, y: 0 }, direction: side });
        }
        this.markVisit(this.pos);
        break;
      case 'game.events':
        for (const e of msg.events) {
          if (this.brain) {
            // the brain hears everything a player at the table would
            this.brain.handleEvent(e);
          } else if (e.visibility.kind === 'private' && e.visibility.playerId === this.playerId) {
            this.observe(e.payload);
          }
        }
        break;
      case 'game.turn':
        if (msg.turnNumber !== this.lastTurnNumber) {
          this.lastTurnNumber = msg.turnNumber;
          this.bumpsThisTurn = 0;
        }
        this.brain?.noteTurn(msg.turnNumber);
        this.canAct = msg.canAct;
        if (msg.activePlayerId === this.playerId) {
          // A human-ish pause keeps the game readable (and lets event
          // fan-out settle before the next action arrives). Tests dial it
          // down via BOT_DELAY_MS.
          const base = Number(process.env.BOT_DELAY_MS ?? 250);
          this.timer = setTimeout(() => {
            if (this.stopped) return;
            try {
              this.act(this.decide());
            } catch {
              // Whatever went wrong (rare race), a legal fallback keeps the game alive.
              try {
                this.act({ type: 'move', direction: DIRS[Math.floor(Math.random() * 4)]! });
              } catch {
                /* room will re-announce the turn; give up quietly */
              }
            }
          }, base + Math.floor(Math.random() * base));
        }
        break;
      default:
        break;
    }
  }

  private observe(p: EventPayload): void {
    switch (p.type) {
      case 'moved':
        this.treasureUnderfoot = false;
        if (this.pos && isPlanarDir(p.direction)) {
          this.setEdge(this.pos, p.direction, 'open');
          this.pos = stepRel(this.pos, p.direction);
          this.markVisit(this.pos);
        }
        break;
      case 'riverDrift':
        if (this.pos && isPlanarDir(p.direction)) {
          this.pos = stepRel(this.pos, p.direction);
          this.markVisit(this.pos);
        }
        break;
      case 'bumpedWall':
      case 'bumpedGrate':
        this.bumpsThisTurn++;
        if (this.pos && isPlanarDir(p.direction)) {
          const key = edgeKey(this.pos, p.direction);
          this.edges.set(key, 'blocked');
          this.bumps.set(key, (this.bumps.get(key) ?? 0) + 1);
        }
        break;
      case 'treasureHere':
        this.treasureUnderfoot = true;
        break;
      case 'wallDestroyed':
        if (this.pos && isPlanarDir(p.direction)) {
          this.edges.set(edgeKey(this.pos, p.direction), 'open');
        }
        break;
      case 'grenadeNoEffect':
        if (this.pos && p.reason === 'reinforced' && isPlanarDir(p.direction)) {
          this.edges.set(edgeKey(this.pos, p.direction), 'reinforced');
        }
        break;
      case 'foundExit':
        // A locked exit is a free probe too — without the treasure it's a
        // wall for exploration purposes (the hasTreasure path in decide()
        // uses knownExits directly, so escaping still works).
        this.bumpsThisTurn++;
        if (this.pos && isPlanarDir(p.direction)) {
          this.knownExits.push({ pos: { ...this.pos }, direction: p.direction });
          this.edges.set(edgeKey(this.pos, p.direction), 'blocked');
        }
        break;
      case 'teleported':
        // Remember the labeled pad we stepped on (while we still knew where
        // we were), THEN lose our bearings.
        if (this.pos && this.pos.frame === 0 && p.label !== undefined) {
          this.knownTeleports.push({ x: this.pos.x, y: this.pos.y, label: p.label });
        }
        this.frame += 1;
        this.pos = { frame: this.frame, x: 0, y: 0 };
        this.knownExits = this.knownExits.filter((e) => e.pos.frame === this.frame);
        this.markVisit(this.pos);
        break;
      case 'fellThroughTrapdoor':
      case 'tookStairs':
        // Disoriented: new reference frame, old coordinates are meaningless.
        this.frame += 1;
        this.pos = { frame: this.frame, x: 0, y: 0 };
        this.knownExits = this.knownExits.filter((e) => e.pos.frame === this.frame);
        this.markVisit(this.pos);
        break;
      case 'treasurePickedUp':
        this.hasTreasure = true;
        this.treasureUnderfoot = false;
        break;
      case 'treasureDropped':
        this.hasTreasure = false;
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

  decide(): PlayerAction {
    if (this.brain) return this.brain.decide(this.canAct);
    const randomMove = (): PlayerAction => ({
      type: 'move',
      direction: DIRS[Math.floor(Math.random() * 4)]!,
    });
    // Standing on the loot: lifting it costs the action — always worth it.
    if (this.treasureUnderfoot && !this.hasTreasure && this.canAct) {
      return { type: 'pickup' };
    }
    // A turn only ends on a successful move; don't probe walls forever.
    if (this.bumpsThisTurn > 6) return { type: 'endTurn' };
    if (this.difficulty === 'easy' || !this.pos) return randomMove();

    // Carrying the loot and knowing a way out: run for it.
    if (this.hasTreasure) {
      const exits = this.knownExits.filter((e) => e.pos.frame === this.pos!.frame);
      for (const exit of exits) {
        if (relEq(exit.pos, this.pos)) return { type: 'move', direction: exit.direction };
        const step = this.firstStepTowards(exit.pos);
        if (step) return { type: 'move', direction: step };
      }
    }

    if (this.difficulty === 'hard' && this.canAct) {
      // Blast through a wall we've bumped twice, if it leads somewhere new.
      if (this.inventory.grenades > 0) {
        for (const d of shuffled(DIRS)) {
          const key = edgeKey(this.pos, d);
          if (
            this.edges.get(key) === 'blocked' &&
            (this.bumps.get(key) ?? 0) >= 2 &&
            !this.visits.has(relKey(stepRel(this.pos, d)))
          ) {
            this.inventory.grenades--;
            return { type: 'grenade', direction: d };
          }
        }
      }
      // The occasional pot shot down a known-open corridor.
      if (this.inventory.bullets > 0 && Math.random() < 0.05) {
        const open = DIRS.filter((d) => this.edges.get(edgeKey(this.pos!, d)) === 'open');
        if (open.length > 0) {
          this.inventory.bullets--;
          return { type: 'shoot', direction: open[Math.floor(Math.random() * open.length)]! };
        }
      }
    }

    // Explore: never walk into a KNOWN wall; prefer the least-visited cell.
    const candidates = DIRS.filter((d) => {
      const state = this.edges.get(edgeKey(this.pos!, d));
      return state !== 'blocked' && state !== 'reinforced';
    });
    if (candidates.length === 0) return randomMove();
    let best = candidates[0]!;
    let bestScore = Infinity;
    for (const d of shuffled(candidates)) {
      const score = this.visits.get(relKey(stepRel(this.pos, d))) ?? -1; // unknown = best
      if (score < bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return { type: 'move', direction: best };
  }

  /** BFS through believed-open edges toward a target; first step or null. */
  private firstStepTowards(target: RelPos): Dir | null {
    if (!this.pos || target.frame !== this.pos.frame) return null;
    const start = relKey(this.pos);
    const seen = new Set<string>([start]);
    const queue: { pos: RelPos; first: Dir | null }[] = [{ pos: this.pos, first: null }];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (relEq(cur.pos, target)) return cur.first;
      for (const d of DIRS) {
        if (this.edges.get(edgeKey(cur.pos, d)) !== 'open') continue;
        const next = stepRel(cur.pos, d);
        const key = relKey(next);
        if (!seen.has(key)) {
          seen.add(key);
          queue.push({ pos: next, first: cur.first ?? d });
        }
      }
    }
    return null;
  }

  private markVisit(p: RelPos): void {
    const key = relKey(p);
    this.visits.set(key, (this.visits.get(key) ?? 0) + 1);
  }

  /**
   * Render this bot's beliefs in the same shape the web client draws, so
   * observers can watch the bot's map grow. Frame 0 is anchored at the
   * entrance (known to everyone), so its relative coordinates translate to
   * absolute ones; each post-teleport/post-fall frame is exported as an
   * auxiliary map — exactly what a disoriented human would chart.
   */
  exportBeliefMaps(): unknown {
    if (this.brain) return this.brain.exportBeliefMaps();
    if (!this.entrance || this.levelSizes.length === 0) return [];
    const e = this.entrance;
    const grids = this.levelSizes.map((size, li) => {
      const grid = {
        width: size.width,
        height: size.height,
        h: new Array<string>((size.height + 1) * size.width).fill('unknown'),
        v: new Array<string>(size.height * (size.width + 1)).fill('unknown'),
        cells: new Array<{ stamps: string[] } | null>(size.width * size.height).fill(null),
      };
      if (li !== e.level) return grid;
      // edges learned in frame 0, offset to absolute coordinates
      for (const [key, state] of this.edges) {
        const m = /^0:(h|v):(-?\d+),(-?\d+)$/.exec(key);
        if (!m) continue;
        const kind = m[1] as 'h' | 'v';
        const ax = e.x + Number(m[2]);
        const ay = e.y + Number(m[3]);
        const mark = state === 'open' ? 'open' : 'wall';
        if (kind === 'h' && ax >= 0 && ax < size.width && ay >= 0 && ay <= size.height) {
          grid.h[ay * size.width + ax] = mark;
        } else if (kind === 'v' && ax >= 0 && ax <= size.width && ay >= 0 && ay < size.height) {
          grid.v[ay * (size.width + 1) + ax] = mark;
        }
      }
      // exits the GM confirmed
      for (const exit of this.knownExits) {
        if (exit.pos.frame !== 0) continue;
        const ax = e.x + exit.pos.x;
        const ay = e.y + exit.pos.y;
        if (ax < 0 || ay < 0 || ax >= size.width || ay >= size.height) continue;
        if (exit.direction === 'N') grid.h[ay * size.width + ax] = 'exit';
        else if (exit.direction === 'S') grid.h[(ay + 1) * size.width + ax] = 'exit';
        else if (exit.direction === 'W') grid.v[ay * (size.width + 1) + ax] = 'exit';
        else grid.v[ay * (size.width + 1) + ax + 1] = 'exit';
      }
      // labeled teleport pads the bot has used
      for (const pad of this.knownTeleports) {
        const ax = e.x + pad.x;
        const ay = e.y + pad.y;
        if (ax < 0 || ay < 0 || ax >= size.width || ay >= size.height) continue;
        grid.cells[ay * size.width + ax] = { stamps: ['teleport'], tpLabel: pad.label } as never;
      }
      // the bot's pawn (only while it still knows where it is)
      if (this.pos && this.pos.frame === 0) {
        const ax = e.x + this.pos.x;
        const ay = e.y + this.pos.y;
        if (ax >= 0 && ay >= 0 && ax < size.width && ay < size.height) {
          const idx = ay * size.width + ax;
          const stamps = ['you'];
          if (this.treasureUnderfoot && !this.hasTreasure) stamps.push('treasure');
          grid.cells[idx] = { stamps };
        }
      }
      return grid;
    });
    const maps: unknown[] = [{ id: 'main', name: 'Main map', grids }];
    for (let f = 1; f <= this.frame; f++) {
      const aux = this.exportFrameGrid(f);
      if (aux) maps.push({ id: `aux-${f}`, name: `Aux ${f}`, grids: [aux] });
    }
    return maps;
  }

  /** One non-zero frame's knowledge as a standalone aux-map grid, offset so
   * the region fits the page — like a human charting an unknown region from
   * the middle of a fresh sheet. */
  private exportFrameGrid(f: number): unknown | null {
    const edgeRe = new RegExp(`^${f}:(h|v):(-?\\d+),(-?\\d+)$`);
    const visitRe = new RegExp(`^${f}:(-?\\d+),(-?\\d+)$`);
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
    for (const key of this.edges.keys()) {
      const m = edgeRe.exec(key);
      if (m) consider(Number(m[2]), Number(m[3]));
    }
    for (const key of this.visits.keys()) {
      const m = visitRe.exec(key);
      if (m) consider(Number(m[1]), Number(m[2]));
    }
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
      cells: new Array<{ stamps: string[] } | null>(width * height).fill(null),
    };
    for (const [key, state] of this.edges) {
      const m = edgeRe.exec(key);
      if (!m) continue;
      const kind = m[1] as 'h' | 'v';
      const ax = Number(m[2]) + ox;
      const ay = Number(m[3]) + oy;
      const mark = state === 'open' ? 'open' : 'wall';
      if (kind === 'h' && ax >= 0 && ax < width && ay >= 0 && ay <= height) {
        grid.h[ay * width + ax] = mark;
      } else if (kind === 'v' && ax >= 0 && ax <= width && ay >= 0 && ay < height) {
        grid.v[ay * (width + 1) + ax] = mark;
      }
    }
    for (const exit of this.knownExits) {
      if (exit.pos.frame !== f) continue;
      const ax = exit.pos.x + ox;
      const ay = exit.pos.y + oy;
      if (ax < 0 || ay < 0 || ax >= width || ay >= height) continue;
      if (exit.direction === 'N') grid.h[ay * width + ax] = 'exit';
      else if (exit.direction === 'S') grid.h[(ay + 1) * width + ax] = 'exit';
      else if (exit.direction === 'W') grid.v[ay * (width + 1) + ax] = 'exit';
      else grid.v[ay * (width + 1) + ax + 1] = 'exit';
    }
    if (this.pos && this.pos.frame === f) {
      const ax = this.pos.x + ox;
      const ay = this.pos.y + oy;
      if (ax >= 0 && ay >= 0 && ax < width && ay < height) {
        const stamps = ['you'];
        if (this.treasureUnderfoot && !this.hasTreasure) stamps.push('treasure');
        grid.cells[ay * width + ax] = { stamps };
      }
    }
    return grid;
  }

  private setEdge(p: RelPos, d: Dir, state: 'open' | 'blocked' | 'reinforced'): void {
    this.edges.set(edgeKey(p, d), state);
  }
}

function isPlanarDir(d: string): d is Dir {
  return d === 'N' || d === 'E' || d === 'S' || d === 'W';
}

function stepRel(p: RelPos, d: Dir): RelPos {
  return { frame: p.frame, x: p.x + DELTA[d].x, y: p.y + DELTA[d].y };
}

function relKey(p: RelPos): string {
  return `${p.frame}:${p.x},${p.y}`;
}

function relEq(a: RelPos, b: RelPos): boolean {
  return a.frame === b.frame && a.x === b.x && a.y === b.y;
}

/** Canonical edge id: every edge stored as the N or W side of a cell. */
function edgeKey(p: RelPos, d: Dir): string {
  switch (d) {
    case 'N':
      return `${p.frame}:h:${p.x},${p.y}`;
    case 'S':
      return `${p.frame}:h:${p.x},${p.y + 1}`;
    case 'W':
      return `${p.frame}:v:${p.x},${p.y}`;
    case 'E':
      return `${p.frame}:v:${p.x + 1},${p.y}`;
  }
}

function shuffled<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

export const BOT_NAMES: Record<BotDifficulty, string[]> = {
  easy: ['Dizzy Bot', 'Wobbly Bot', 'Lost Bot'],
  medium: ['Scout Bot', 'Mapper Bot', 'Tracker Bot'],
  hard: ['Minotaur Bot', 'Warden Bot', 'Stalker Bot'],
  expert: ['Bayes Bot', 'Oracle Bot', 'Theseus Bot'],
};
