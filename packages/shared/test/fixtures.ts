import type { Coord, PlanarDirection } from '../src/geometry.js';
import type { CosmeticItem } from '../src/cosmetics/items.js';
import type { LevelDocument, MapDocument, MapFeature } from '../src/map/document.js';
import { createEdgeGrid, setEdge, type EdgeState } from '../src/map/grid.js';
import { DEFAULT_CONFIG, createGame, type GameConfig, type GameState } from '../src/engine/state.js';
import { applyAction } from '../src/engine/apply.js';
import type { PlayerAction } from '../src/engine/actions.js';
import type { GameEvent } from '../src/engine/events.js';

/** Border walls, all interior edges open — the simplest playable arena. */
export function openLevel(width: number, height: number): LevelDocument {
  const edges = createEdgeGrid(width, height, 'open');
  for (let x = 0; x < width; x++) {
    setEdge(edges, { x, y: 0 }, 'N', 'wall');
    setEdge(edges, { x, y: height - 1 }, 'S', 'wall');
  }
  for (let y = 0; y < height; y++) {
    setEdge(edges, { x: 0, y }, 'W', 'wall');
    setEdge(edges, { x: width - 1, y }, 'E', 'wall');
  }
  return { width, height, edges, features: [] };
}

export interface TestMapSpec {
  levels?: LevelDocument[];
  entrance?: { level: number; x: number; y: number };
  treasure?: { level: number; x: number; y: number };
  /** the treasure's hidden prize (won on escape) */
  prize?: CosmeticItem;
  monsters?: MapDocument['spawns']['monsters'];
  walls?: { level?: number; at: Coord; dir: PlanarDirection; state?: EdgeState }[];
  exits?: { level?: number; at: Coord; dir: PlanarDirection }[];
  features?: { level?: number; feature: MapFeature }[];
}

/** Hand-build a small deterministic map for scenario tests. */
export function testMap(spec: TestMapSpec = {}): MapDocument {
  const levels = spec.levels ?? [openLevel(3, 3)];
  const map: MapDocument = {
    version: 1,
    levels,
    entrance: spec.entrance ?? { level: 0, x: 0, y: 0 },
    spawns: {
      treasure: spec.treasure ?? { level: 0, x: 2, y: 2 },
      ...(spec.prize ? { prize: spec.prize } : {}),
      monsters: spec.monsters ?? [],
    },
    metadata: { name: 'test' },
  };
  for (const w of spec.walls ?? []) {
    setEdge(levels[w.level ?? 0]!.edges, w.at, w.dir, w.state ?? 'wall');
  }
  for (const e of spec.exits ?? []) {
    setEdge(levels[e.level ?? 0]!.edges, e.at, e.dir, 'exit');
  }
  for (const f of spec.features ?? []) {
    levels[f.level ?? 0]!.features.push(f.feature);
  }
  return map;
}

export function startGame(
  map: MapDocument,
  playerCount = 1,
  config: Partial<GameConfig> = {},
): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
  }));
  return createGame(map, players, { ...DEFAULT_CONFIG, ...config }, 'test-seed');
}

export interface StepResult {
  state: GameState;
  events: GameEvent[];
}

/** Apply an action and return both the new state and this turn's events. */
export function turn(state: GameState, action: PlayerAction): StepResult {
  return applyAction(state, action);
}

/** Apply a scripted sequence, collecting all events. */
export function playScript(state: GameState, actions: PlayerAction[]): {
  state: GameState;
  events: GameEvent[];
} {
  let cur = state;
  const events: GameEvent[] = [];
  for (const action of actions) {
    const r = applyAction(cur, action);
    cur = r.state;
    events.push(...r.events);
  }
  return { state: cur, events };
}

export function payloadTypes(events: GameEvent[]): string[] {
  return events.map((e) => e.payload.type);
}

/** A hand-rolled cosmetic item for scenario tests. */
export function testItem(overrides: Partial<CosmeticItem> = {}): CosmeticItem {
  return {
    id: 'itm-test-1',
    slot: 'hat',
    templateId: 'straw-hat',
    rarity: 'common',
    paletteId: 'moss',
    name: 'Straw Hat',
    ...overrides,
  };
}
