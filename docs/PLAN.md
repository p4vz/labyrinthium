# Labyrinthium — Full Game Plan & Backend Implementation

## Context

Labyrinthium is a web-app clone of the classic pencil-and-paper game "Labyrinth": a game master holds a secret grid map; players know only the dimensions and the entrance, and navigate blind by calling moves (up/down/left/right). The game master reports what each player encounters, and players hand-draw their own maps from those reports. Here the computer replaces the human game master: it holds the authoritative map (human-built in a map editor or auto-generated), resolves every move, and tells each player only what they legitimately observe.

The repo is empty — greenfield. **Scope now: build the backend (engine + generator + server). Spec the whole game (frontend mapping UI, editor UI) for later phases.**

## Decisions locked with the user

| Decision | Choice |
|---|---|
| Backend stack | Node.js + TypeScript |
| Multiplayer | Online real-time rooms (room code, own devices, WebSockets) |
| Shot rule | Shot player paralyzed N turns and drops the **treasure only** (keeps grenades/bullets/mines) |
| Win condition | First player to exit the labyrinth **while carrying the treasure** |
| Teleports | Both **one-way and two-way** supported |
| Complexity | Optional tiers: multi-layer maps (stairways/trap doors), indestructible walls, monster AI levels, mines, single-use traps; feature registry reserves room for future elements |

## Canonical game rules

- **Grid**: each layer 3×3 up to 15×15. Walls live on **edges** between cells and on the outer border; exits are gaps in the ground-level border. Border walls are indestructible.
- **Layers (optional complexity)**: a map is 1..L **levels** (basement, ground, upper…), each with its **own dimensions**. Connections between layers:
  - **Stairways** — bidirectional; a cell feature. Entering the cell reports "stairs up/down"; taking them is a move action with direction `U`/`D`. Players know which way they went.
  - **Trap doors** — one-way drop to a cell on the layer below; stepping on one reports "you fell through a trap door" (player knows they went down one level, but not where they landed).
- **Turn**: one action — move a direction (`N/E/S/W`, plus `U/D` on stairs), shoot a direction, grenade an adjacent wall/grate, place a mine on the current tile, or forced skip when paralyzed. Server resolves consequences, reports observations privately; some events are public ("a shot was heard").
- **Walls**: normal walls are grenade-destructible; **reinforced walls are indestructible** (player is told the grenade had no effect — that itself is mappable information). Border always indestructible.
- **Rivers**: ordered chains of cells with flow; a player in a river drifts 1 tile downstream per turn. Grates cross rivers and are grenade-destructible.
- **Teleports**: `one-way` (entering sends you to a hidden target) or `two-way` (a linked pair; entering either endpoint sends you to the other). The player is **never told where they landed** — they map the new region and cross-reference (this drives the auxiliary-maps UI).
- **Treasure**: carried item, auto-picked-up on entry; dropped on the carrier's tile when shot, mined, trapped, or hit by a monster.
- **Monsters**: hidden, move 1 tile per turn, with **sophistication tiers**: `wanderer` (uniform random legal step), `patroller` (walks a fixed loop route), `hunter` (BFS toward the nearest player within a scent radius, otherwise wanders). Encounter paralyzes the player 1 turn and drops treasure.
- **Bullets**: travel until hitting a blocking edge (wall/reinforced/grate/border) or a player/monster. Hit player: paralyzed `paralysisTurns` (default 3) + drops treasure. Hit monster dies silently.
- **Mines**: hidden on a tile until triggered; **pre-baked** by generator/editor and **player-placed** (inventory item; placing is a turn action). Any player entering (including the placer) triggers it: paralysis + treasure drop; mine is consumed. Public `explosionHeard`.
- **Single-use traps**: pre-baked cell feature; first player entering springs it (paralysis, default 2 turns), then it's inert forever. Private "you were trapped" event.
- **Extensibility**: elements and events are discriminated unions behind a **feature registry** — pits, fake treasures, bear traps, keys/doors etc. are explicitly reserved as future union variants; adding one never touches the core engine.

---

## 1. Monorepo layout

pnpm workspaces + TS project references (no Nx/Turborepo — 3 packages don't need it).

```
labyrinthium/
├── package.json / pnpm-workspace.yaml / tsconfig.base.json (strict)
├── .github/workflows/ci.yml          # lint + typecheck + test
├── docs/PLAN.md                      # this spec, committed
└── packages/
    ├── shared/        # @labyrinthium/shared — pure TS, only runtime dep: zod
    │   └── src/
    │       ├── geometry.ts           # Coord, Pos (level-aware), Direction, EdgeRef
    │       ├── rng.ts                # splitmix32 pure PRNG (state = one uint32)
    │       ├── map/{document,presets,grid}.ts
    │       ├── engine/{state,actions,events,apply}.ts
    │       ├── engine/resolve/{move,shoot,grenade,placeMine,worldPhase}.ts
    │       ├── engine/features/{registry,river,teleport,stairs,trapdoor,mine,trap,monster,treasure}.ts
    │       ├── generator/{index,maze,braid,rivers,layers,placement,validate,difficulty}.ts
    │       └── protocol/{client,server}.ts   # zod message schemas
    ├── server/        # @labyrinthium/server — Fastify + ws + better-sqlite3
    │   └── src/{index,app}.ts, ws/connection.ts, rooms/{roomManager,room}.ts,
    │        session.ts, persistence/db.ts, routes/maps.ts
    ├── cli/           # @labyrinthium/cli — phase 3 test harness / bots
    └── web/           # @labyrinthium/web — stub now, phase 4
```

Why `shared`: the engine and generator are pure, deterministic, framework-free functions over plain data (seeded RNG lives **inside** GameState). The same package runs server-side (authoritative), in tests, and later in the browser (replay viewer, editor validation).

## 2. Core domain model (sketch)

```ts
type Direction = 'N' | 'E' | 'S' | 'W' | 'U' | 'D';   // U/D valid only on stairways
interface Coord { x: number; y: number }               // 0-based, y grows south
interface Pos extends Coord { level: number }          // player/monster/treasure position
type EdgeState = 'open' | 'wall' | 'reinforced' | 'grate' | 'exit';
interface EdgeGrid { width; height; h: EdgeState[]; v: EdgeState[] }  // dense arrays

interface LevelDocument {          // one layer; sizes vary per layer
  width: number; height: number;   // 3..15 each
  edges: EdgeGrid;                 // 'exit' edges only valid on the entrance level
  features: MapFeature[];
}
interface MapDocument {            // versioned, zod-validated
  version: 1;
  levels: LevelDocument[];         // index 0 = entrance level; length 1 = classic game
  entrance: Pos;                   // always on level 0
  spawns: { treasure: Pos; monsters: MonsterSpawn[] };
  metadata: { name?; seed?; difficulty?; author? };
}
type MapFeature =                  // per-level; discriminated union = extension point
  | { type: 'river';    cells: Coord[] }                       // flow = cells[i] -> cells[i+1]
  | { type: 'teleport'; at: Coord; target: Pos; mode: 'oneWay' | 'twoWay' }
                                   // twoWay pairs are two mirrored entries, validated symmetric
  | { type: 'stairs';   at: Coord; to: Pos }                   // bidirectional; mirrored entry on target level
  | { type: 'trapdoor'; at: Coord; to: Pos }                   // one-way, target level must be below
  | { type: 'mine';     at: Coord }                            // pre-baked; player-placed mines live in GameState
  | { type: 'trap';     at: Coord; paralysis: number };        // single-use
  // reserved future variants: pit, fakeTreasure, bearTrap, key, door, ...

type MonsterAI = 'wanderer' | 'patroller' | 'hunter';
interface MonsterSpawn { at: Pos; ai: MonsterAI; route?: Coord[]; scentRadius?: number }

interface PlayerState { id; name; pos: Pos;
  inventory: { grenades: number; bullets: number; mines: number };
  paralysis: number; hasTreasure: boolean; exited: boolean }

interface GameState {
  phase: 'lobby' | 'inProgress' | 'finished';
  map: MapDocument;                // immutable reference
  edges: EdgeGrid[];               // mutable copy per level — grenades modify these
  placedMines: Pos[];              // player-placed, hidden
  sprungTraps: Pos[];              // exhausted single-use traps / consumed baked mines
  players: PlayerState[]; turnIndex: number; turnNumber: number;
  treasure: { carriedBy: string | null; pos: Pos };
  monsters: { id; pos: Pos; ai: MonsterAI; alive: boolean; routeIdx?: number }[];
  rngState: number;                // PRNG in state => pure engine, perfect replays
  config: GameConfig;              // paralysisTurns=3, trapParalysis=2, mineParalysis=3,
                                   // allowBorderGrenade=false, treasureDrifts=false, minesPerPlayer…
  winnerId: string | null;
}

type PlayerAction =
  | { type: 'move' | 'shoot' | 'grenade'; direction: Direction }
  | { type: 'placeMine' };

// Events carry NO absolute coordinates — only the player's own relative observations.
// 'teleported' has no destination; 'fellThroughTrapdoor' says only "down one level".
type EventPayload = moved | bumpedWall | grenadeNoEffect /* reinforced */ | bumpedGrate
  | foundExit | riverDrift | teleported | fellThroughTrapdoor | stairsFound | tookStairs(direction)
  | treasurePickedUp | treasureDropped | monsterEncounter | minePlaced(private)
  | mineTriggered(private victim) | trapSprung(private) | shotFired(public) | screamHeard(public)
  | youWereShot(private) | explosionHeard(public) | wallDestroyed(private)
  | turnSkippedParalyzed | gameWon(public);
interface GameEvent { seq; turn; visibility: private(playerId)|public; payload: EventPayload }
```

Extensibility seam: `features/registry.ts` defines `FeatureBehavior { onEnter(ctx): EntryResult }`; adding a new element = one union variant + one module + registry entry — `apply.ts` never changes.

## 3. Engine — turn resolution order

`applyAction(state, action) -> { state, events }`. Illegal actions throw a typed `InvalidActionError` **before any mutation** and don't consume the turn.

1. **Preconditions**: in-progress, it's your turn, not exited. Paralyzed → emit `turnSkippedParalyzed`, decrement counter, skip to step 8.
2. **Legality**: inventory checks; `U`/`D` move requires standing on stairs; grenade on border rejected (config-gated, default off).
3. **Resolve action**:
   - *move N/E/S/W*: wall/reinforced → `bumpedWall`; grate → `bumpedGrate`; exit edge → leave only if carrying treasure (else `foundExit`, stay); open → step into cell, run entry pipeline (4).
   - *move U/D*: transit the stairway to its linked cell on the other level, `tookStairs`, then entry pipeline (4).
   - *shoot*: ray-march within the current level until blocking edge or occupied cell. All players there: `paralysis = paralysisTurns`, treasure drops on that cell; victim gets private `youWereShot`, all get public `shotFired` + `screamHeard`. Monster hit dies silently.
   - *grenade*: adjacent wall/grate → `open` + private `wallDestroyed`; **reinforced → private `grenadeNoEffect`** (grenade still spent); open/exit → wasted; always public `explosionHeard`.
   - *placeMine*: decrement mines, add current tile to `placedMines`, private `minePlaced`.
4. **Entry pipeline** (after every relocation; `driftBudget = 1`, relocation visited-set):
   a. **teleport** (if unvisited) → relocate per mode (one-way target / two-way twin), `teleported`, restart pipeline
   b. **trapdoor** (if unvisited) → relocate one level down, `fellThroughTrapdoor`, restart pipeline
   c. **river** & budget > 0 → drift 1 downstream, budget--, `riverDrift`, restart (river→teleport chains work; teleport grants no extra drift)
   d. **mine** (baked & unsprung, or placed) → consume it, paralysis = mineParalysis, drop treasure, private `mineTriggered` + public `explosionHeard`
   e. **trap** (unsprung) → spring it permanently, paralysis = trap's value, private `trapSprung`
   f. **stairs** on cell → informational `stairsFound` (transit only via explicit U/D move)
   g. **treasure** on cell & unclaimed & not paralyzed → auto-pickup
   h. **living monster** on cell → `monsterEncounter`: drop treasure, paralysis = 1
   - Two players may share a cell; neither is told (fog is total).
5. **Monsters move** (1 step each, respecting walls/grates, ignoring rivers/teleports/trapdoors/stairs — monsters never change level):
   - `wanderer`: uniform random open direction; `patroller`: next cell of its route loop; `hunter`: BFS step toward nearest same-level player within `scentRadius`, else wander.
   - Monster entering a cell with non-paralyzed players triggers 4h; already-paralyzed players unaffected (no lock-out). Monsters don't trigger mines/traps.
6. **Treasure drift**: only if `config.treasureDrifts` (default off).
7. **Win check**: exited with treasure → `finished`, public `gameWon`.
8. **Advance turn** to next non-exited player; `turnNumber++`.

## 4. Map generator ("bake")

`generateMap(preset, seed) -> MapDocument`, fully deterministic from seed:

1. seed splitmix32; 2. decide **layer count & per-layer sizes** from preset; 3. per layer: **perfect maze** (recursive backtracker — long-corridor bias suits trial-and-error mapping); 4. **braid** — knock down walls at `braidFactor` of dead ends (loops = ambiguity = difficulty); 5. **harden** — promote `reinforcedShare` of interior walls to `reinforced` (never walls whose removal is needed for solvability — checked in validation); 6. **rivers** per layer — non-self-intersecting random walks, flow = walk order, grates on `grateChance` of lateral crossings; 7. **inter-layer connections** — place stairways (≥1 path of stairs linking every layer, mirrored entries) and trap doors (down only); 8. **exits** on level-0 border, min-distance apart; 9. **entrance** on level-0 border ring; 10. **treasure** in top quartile of `dist(entrance,c) + dist(c,nearestExit)` over the *player-movement digraph spanning all layers*; 11. **teleports** (mix of one-way/two-way per preset; two-way emitted as mirrored pairs), targets exclude other features/entrance/exit-adjacent; 12. **mines & traps** — min BFS distance from entrance, never on treasure/stairs/teleports; 13. **monsters** with AI mix per preset, ≥ min distance from entrance; 14. **validate** (below); 15. **difficulty score** 1–10 into metadata.

**Validation — "on bake, all levels must be solvable" (shared with editor)**: build one **directed graph across all layers**: node = (level, cell); edge `a → L(b)` iff a↔b open, where `L(b)` = landing position after resolving b's teleport/trapdoor + 1 river drift — literally the engine's entry pipeline reused as a pure function. Stairs contribute bidirectional cross-level edges; trapdoors one-way edges. Grates and reinforced walls count as walls (pessimistic: solvable without grenades). Checks: (i) treasure reachable from entrance, (ii) an exit reachable from treasure's landing cell, (iii) **no trap regions on any level** — every position reachable from the entrance (including via trapdoor falls and teleports) can still reach an exit, (iv) every stairway/two-way teleport pair is properly mirrored. On failure retry sub-seeds ≤25, then shed a trapdoor/river/teleport — never fail outright.

Presets (complexity is a second axis: `classic` forces 1 layer, no mines/traps/reinforced, wanderer monsters only; `advanced` and `full` unlock the rest):

| preset | sizes | layers | braid | rivers (len) | teleports (1w/2w) | monsters (AI) | mines/traps | exits | reinforced | per-player grenades/bullets/mines |
|---|---|---|---|---|---|---|---|---|---|---|
| small | 3–5 | 1 | 0.2 | 0–1 (3) | 0–1 / 0 | 0 | 0 / 0 | 1 | 0% | 1 / 1 / 0 |
| medium | 6–9 | 1–2 | 0.35 | 1 (~0.15·cells) | 1 / 0–1 | 1 wanderer | 1 / 1 | 1 | 5% | 2 / 2 / 1 |
| large | 10–15 | 1–3 | 0.5 | 2 (~0.12·cells) | 1–2 / 1 | 1–2 mixed AI | 2 / 2 | 2 | 10% | 3 / 3 / 2 |

## 5. Map editor (backend now, UI phase 4)

- Format = `MapDocument` v1 (zod, versioned; migrations are pure v1→v2 functions). Multi-level maps authorable: each level edited separately, cross-level features (stairs/trapdoors/teleports) reference `{level, x, y}` targets.
- REST: `POST/GET/PUT/DELETE /api/maps[/:id]`; `POST /api/maps/validate` runs the same cross-layer checker, returns structured issues (`{code:'TREASURE_UNREACHABLE'|'TRAP_REGION'|'UNMIRRORED_STAIRS'…, positions:[…]}`) for future UI highlighting; `POST /api/maps/generate {preset, complexity, seed?}`.
- `room.create` accepts `{mapId}` (human-authored) or `{preset, complexity, seed?}` (generated).

## 6. Server architecture

**Fastify + `@fastify/websocket` (plain ws, not socket.io)** — we need token-based resume with server-side event-tail replay anyway, so socket.io buys little. **better-sqlite3** raw (synchronous API fits the single-threaded room loop).

- **Rooms**: `Map<roomCode, Room>`; 6-char unambiguous codes. `Room` owns GameState, actionLog, eventLog, sessions. Single mutation path: validate message → `applyAction` → append logs → fan out events filtered by visibility → persist.
- **Sessions/reconnect**: join issues `{playerId, sessionToken}`; `session.resume {token, lastAckedSeq}` re-binds the socket and replays the visible-event tail. Disconnected players stay in the game (optional turn timeout).
- **Persistence**: `games(id, room_code, map_json, seed, config_json, …, winner_id)` + `game_actions(game_id, seq, player_id, action_json)`. Deterministic engine + RNG-in-state ⇒ **initial state + action log = full replay**.
- **Anti-cheat**: server is sole map holder; clients only ever receive events.

**Protocol** (zod discriminated unions in `shared/protocol/`):
- C→S: `session.resume`, `room.create`, `room.join`, `room.leave`, `room.start`, `game.action {action}`, `ping`
- S→C: `session.created`, `room.state`, `room.playerJoined/Left/Reconnected`, `game.started {levelSizes[], entrance, yourPlayerId, turnOrder, inventory}` (players know each level's dimensions and the entrance, nothing else), `game.turn`, `game.events {events[]}` (visibility-filtered, seq-numbered), `game.finished {winnerId, mapReveal}`, `error`, `pong`

## 7. Frontend spec (phase 4 — scoped only)

React + Vite + zustand + **plain SVG** grids. Layout: **left** palette of draggable stamps (wall, reinforced wall, river arrow, teleport, stairs, trap door, mine, trap, monster, treasure, exit, free-text note) → **center** main-map grid with a **level switcher tab bar** (one tab per layer) → **right** expandable panel of **auxiliary maps** (create/rename/remove) for post-teleport/post-trapdoor mapping. Interactions: click-edge wall cycling, drag stamps, rectangular select with copy/cut/paste and move **between maps**, merge auxiliary→main with drag-offset ghost preview, per-map undo/redo (command stack). Game HUD: turn indicator, inventory (grenades/bullets/mines), private+public event feed, action controls (move/shoot/grenade/place-mine + direction picker incl. stairs U/D). Player maps are purely client-local (localStorage per game) — never sent to the server.

## 8. Testing

- **Unit (vitest)**: every resolver + feature module; edge-case table (river→teleport, trapdoor→river chain, drift-budget exhaustion, grenade on reinforced wall, mine triggered by its own placer, trap springs only once, hunter monster pathing, monster onto paralyzed player, pickup denied while paralyzed…).
- **Property-based (fast-check)**: ∀ preset/complexity/seed → generated map passes cross-layer validation and is byte-identical for the same seed; ∀ map + legal action sequence → invariants hold (one treasure, positions in bounds on valid levels, inventory ≥ 0, ≤1 winner, sprung traps never re-fire) and replaying the log reproduces the exact final state.
- **Scenario tests**: hand-written transcripts — the executable rulebook.
- **Integration**: in-process Fastify + two real ws clients play a scripted game (incl. a 2-layer map) to `gameWon`; assert private/public streams differ correctly and resume replays the tail.

## 9. Roadmap

- **Phase 1 — `shared`** ✅: geometry/grid/RNG, domain model, full `applyAction` (all rules incl. layers, mines, traps, monster AI tiers), generator + cross-layer validator, presets; unit + property tests green; deterministic replay proven.
- **Phase 2 — `server`** ✅: Fastify + ws, full protocol, room lifecycle, reconnect, SQLite persistence, map CRUD/validate/generate; integration tests green. **Phases 1+2 = the "backend built" milestone for this task.**
- **Phase 3 — `cli`** ✅: terminal client + `--bot random` for 2-bot smoke games; soak-tests the server.
- **Phase 4 — `web`** ✅: lobby, HUD, mapping UI (§7), map editor UI.
- **Phase 5 — extras** ✅ (spectators, replay viewer, end-of-game map reveal, game history API). Still open for later: new elements via the feature registry (pits, fake treasures, bear traps, keys/doors), heuristic bots.

## Verification (for the backend build)

1. `pnpm -r test` — unit, property, scenario suites green.
2. `pnpm -r typecheck && pnpm -r lint`.
3. Integration suite: scripted 2-player game over real WebSockets from lobby to `gameWon` (incl. a multi-layer map), asserting event visibility and reconnection.
4. Manual smoke: start server, `curl POST /api/maps/generate {preset:'medium', complexity:'advanced', seed:'demo'}`, create a room with it, connect two CLI clients, play turns, kill one client mid-game and resume via token.
5. Determinism check: replay a finished game's action log and diff the final state.

## Deliverables of this task

Implement Phases 1–3 (shared engine + generator, server, minimal CLI harness) on branch `claude/labyrinthium-backend-planning-wuuevl`, commit and push. This spec is committed to the repo as `docs/PLAN.md`.
