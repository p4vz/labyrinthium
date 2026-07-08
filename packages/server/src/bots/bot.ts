import type {
  BotDifficulty,
  EventPayload,
  Inventory,
  PlayerAction,
  ServerMessage,
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
 *  - hard:   medium + grenades through repeatedly-bumped walls and takes
 *            the occasional pot shot down the corridor.
 */
export class BotController {
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

  handle(msg: ServerMessage): void {
    if (this.stopped) return;
    switch (msg.type) {
      case 'game.started':
        this.pos = { frame: 0, x: 0, y: 0 };
        this.inventory = { ...msg.inventory };
        this.markVisit(this.pos);
        break;
      case 'game.events':
        for (const e of msg.events) {
          if (e.visibility.kind === 'private' && e.visibility.playerId === this.playerId) {
            this.observe(e.payload);
          }
        }
        break;
      case 'game.turn':
        if (msg.turnNumber !== this.lastTurnNumber) {
          this.lastTurnNumber = msg.turnNumber;
          this.bumpsThisTurn = 0;
        }
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
        if (this.pos && isPlanarDir(p.direction)) {
          this.knownExits.push({ pos: { ...this.pos }, direction: p.direction });
        }
        break;
      case 'teleported':
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
};
