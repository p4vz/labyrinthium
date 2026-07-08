import { create } from 'zustand';
import {
  PIECE_STAMPS,
  setEdgeMark,
  setEdgeRaw,
  stampRiver,
  createGrid,
  extract,
  clearRect,
  cycleEdge,
  gridToFragment,
  normalizeRect,
  paste,
  setNote,
  clearCell,
  toggleStamp,
  type Fragment,
  type PlayerMap,
  type Rect,
  type Stamp,
} from './playerMap.js';

export type Tool =
  | { kind: 'wall' } // click edges to cycle unknown/wall/open/grate
  | { kind: 'stamp'; stamp: Stamp; riverDir?: 'N' | 'E' | 'S' | 'W' }
  | { kind: 'note' }
  | { kind: 'erase' }
  | { kind: 'select' };

interface Snapshot {
  maps: PlayerMap[];
}

const PALETTE_PREF_KEY = 'labyrinthium:ui:paletteWide';

function loadPalettePref(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(PALETTE_PREF_KEY);
      if (stored !== null) return stored !== '0';
    }
  } catch {
    /* fall through to the size default */
  }
  // First visit: names on desktop, icon rail on phones (screen is precious).
  return typeof window === 'undefined' || window.innerWidth > 880;
}

export interface MapStoreState {
  storageKey: string | null;
  /** draw rail: true = icons + names, false = single-glyph wide */
  paletteWide: boolean;
  setPaletteWide(wide: boolean): void;
  maps: PlayerMap[];
  activeMapId: string;
  activeGrid: number; // level index within the active map
  tool: Tool;
  selection: { mapId: string; grid: number; rect: Rect } | null;
  clipboard: Fragment | null;
  /** when set, the next cell click pastes this fragment there (ghost mode) */
  pending: Fragment | null;
  undoStack: Snapshot[];
  redoStack: Snapshot[];

  initForGame(
    key: string,
    levelSizes: { width: number; height: number }[],
    entrance?: { level: number; x: number; y: number },
    playerCount?: number,
  ): void;
  /** slide every "you" pawn one tile when the GM confirms you moved */
  moveYouPawn(direction: 'N' | 'E' | 'S' | 'W'): void;
  /** the GM revealed an exit next to you: draw the green gate at the pawn */
  markExitEdge(direction: 'N' | 'E' | 'S' | 'W'): void;
  /** one swipe of the wall tool: a run of edges becomes walls (one undo step) */
  paintWalls(edges: { kind: 'h' | 'v'; x: number; y: number }[]): void;
  /** one swipe of the river tool: a chain of cells with flow directions (one undo step) */
  paintRiver(cells: { x: number; y: number; dir: 'N' | 'E' | 'S' | 'W' }[]): void;
  setActive(mapId: string, grid?: number): void;
  setTool(tool: Tool): void;
  clickEdge(x: number, y: number, side: 'N' | 'W'): void;
  clickCell(x: number, y: number): void;
  dragSelect(rect: Rect): void;
  addAuxMap(): void;
  renameMap(id: string, name: string): void;
  removeMap(id: string): void;
  copySelection(): void;
  cutSelection(): void;
  startPaste(): void;
  startMerge(auxMapId: string): void;
  cancelPending(): void;
  clearSelection(): void;
  undo(): void;
  redo(): void;
}

let auxCounter = 0;

function persist(state: Pick<MapStoreState, 'storageKey' | 'maps'>): void {
  if (state.storageKey && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(state.storageKey, JSON.stringify(state.maps));
    } catch {
      /* storage full or unavailable — the map lives on in memory */
    }
  }
}

export const useMapStore = create<MapStoreState>((set, get) => {
  /** push undo snapshot, apply mutation to the active grid's map, persist */
  function mutate(fn: (maps: PlayerMap[]) => PlayerMap[]): void {
    const { maps, undoStack, storageKey } = get();
    const next = fn(JSON.parse(JSON.stringify(maps)) as PlayerMap[]);
    const snapshot: Snapshot = { maps };
    set({
      maps: next,
      undoStack: [...undoStack.slice(-99), snapshot],
      redoStack: [],
    });
    persist({ storageKey, maps: next });
  }

  function withActiveGrid(fn: (map: PlayerMap, gridIdx: number) => void): void {
    mutate((maps) => {
      const map = maps.find((m) => m.id === get().activeMapId);
      if (map) fn(map, Math.min(get().activeGrid, map.grids.length - 1));
      return maps;
    });
  }

  return {
    storageKey: null,
    paletteWide: loadPalettePref(),
    setPaletteWide(wide) {
      set({ paletteWide: wide });
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(PALETTE_PREF_KEY, wide ? '1' : '0');
        }
      } catch {
        /* preference just won't stick */
      }
    },
    maps: [],
    activeMapId: 'main',
    activeGrid: 0,
    tool: { kind: 'wall' },
    selection: null,
    clipboard: null,
    pending: null,
    undoStack: [],
    redoStack: [],

    initForGame(key, levelSizes, entrance, playerCount) {
      const storageKey = `labyrinthium:maps:${key}`;
      let maps: PlayerMap[] | null = null;
      try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
        if (raw) maps = JSON.parse(raw) as PlayerMap[];
      } catch {
        maps = null;
      }
      if (!maps || maps.length === 0) {
        maps = [
          {
            id: 'main',
            name: 'Main map',
            grids: levelSizes.map((s) => createGrid(s.width, s.height)),
          },
        ];
        if (entrance && maps[0]!.grids[entrance.level]) {
          // Everyone starts at the entrance: mark it and set out one piece
          // per player (plus your own pawn) so opponents can be tracked.
          let grid = maps[0]!.grids[entrance.level]!;
          grid = toggleStamp(grid, entrance.x, entrance.y, 'entrance');
          grid = toggleStamp(grid, entrance.x, entrance.y, 'you');
          for (let i = 0; i < Math.min(playerCount ?? 0, PIECE_STAMPS.length); i++) {
            grid = toggleStamp(grid, entrance.x, entrance.y, PIECE_STAMPS[i]!);
          }
          maps[0]!.grids[entrance.level] = grid;
        }
      }
      // The entrance is a GATE in the outer wall — draw the arch on every
      // border side of the entrance cell (also patches maps saved before
      // this existed, hence outside the fresh-map branch).
      if (entrance) {
        const main = maps.find((m) => m.id === 'main');
        let grid = main?.grids[entrance.level];
        if (main && grid) {
          const sides: ('N' | 'E' | 'S' | 'W')[] = [];
          if (entrance.y === 0) sides.push('N');
          if (entrance.x === 0) sides.push('W');
          if (entrance.y === grid.height - 1) sides.push('S');
          if (entrance.x === grid.width - 1) sides.push('E');
          for (const side of sides) {
            grid = setEdgeMark(grid, entrance.x, entrance.y, side, 'gate');
          }
          if (!grid.cells.some((c) => c?.stamps.includes('entrance'))) {
            grid = toggleStamp(grid, entrance.x, entrance.y, 'entrance');
          }
          main.grids[entrance.level] = grid;
        }
      }
      auxCounter = maps.length - 1;
      set({
        storageKey,
        maps,
        activeMapId: 'main',
        activeGrid: 0,
        selection: null,
        clipboard: null,
        pending: null,
        undoStack: [],
        redoStack: [],
      });
    },

    setActive(mapId, grid) {
      set({ activeMapId: mapId, activeGrid: grid ?? 0, selection: null, pending: null });
    },

    moveYouPawn(direction) {
      // Automatic bookkeeping, not an edit: no undo snapshot, so Ctrl+Z
      // stays reserved for the player's own drawing.
      const delta = { N: { x: 0, y: -1 }, E: { x: 1, y: 0 }, S: { x: 0, y: 1 }, W: { x: -1, y: 0 } }[
        direction
      ];
      const { maps, storageKey } = get();
      const next = JSON.parse(JSON.stringify(maps)) as PlayerMap[];
      let changed = false;
      for (const map of next) {
        for (let gi = 0; gi < map.grids.length; gi++) {
          const grid = map.grids[gi]!;
          const idx = grid.cells.findIndex((c) => c?.stamps.includes('you'));
          if (idx < 0) continue;
          const x = idx % grid.width;
          const y = Math.floor(idx / grid.width);
          const tx = x + delta.x;
          const ty = y + delta.y;
          if (tx < 0 || ty < 0 || tx >= grid.width || ty >= grid.height) continue;
          map.grids[gi] = toggleStamp(grid, tx, ty, 'you');
          changed = true;
        }
      }
      if (changed) {
        set({ maps: next });
        persist({ storageKey, maps: next });
      }
    },

    markExitEdge(direction) {
      const { maps, storageKey } = get();
      const next = JSON.parse(JSON.stringify(maps)) as PlayerMap[];
      let changed = false;
      for (const map of next) {
        for (let gi = 0; gi < map.grids.length; gi++) {
          const grid = map.grids[gi]!;
          const idx = grid.cells.findIndex((c) => c?.stamps.includes('you'));
          if (idx < 0) continue;
          const x = idx % grid.width;
          const y = Math.floor(idx / grid.width);
          map.grids[gi] = setEdgeMark(grid, x, y, direction, 'exit');
          changed = true;
        }
      }
      if (changed) {
        set({ maps: next });
        persist({ storageKey, maps: next });
      }
    },

    setTool(tool) {
      set({ tool, pending: null });
    },

    clickEdge(x, y, side) {
      if (get().tool.kind !== 'wall') return;
      withActiveGrid((map, gi) => {
        map.grids[gi] = cycleEdge(map.grids[gi]!, x, y, side);
      });
    },

    paintWalls(edges) {
      if (edges.length === 0) return;
      withActiveGrid((map, gi) => {
        for (const e of edges) {
          map.grids[gi] = setEdgeRaw(map.grids[gi]!, e.kind, e.x, e.y, 'wall');
        }
      });
    },

    paintRiver(cells) {
      if (cells.length === 0) return;
      withActiveGrid((map, gi) => {
        for (const c of cells) {
          map.grids[gi] = stampRiver(map.grids[gi]!, c.x, c.y, c.dir);
        }
      });
    },

    clickCell(x, y) {
      const { tool, pending } = get();
      if (pending) {
        withActiveGrid((map, gi) => {
          map.grids[gi] = paste(map.grids[gi]!, pending, x, y);
        });
        set({ pending: null });
        return;
      }
      if (tool.kind === 'stamp') {
        withActiveGrid((map, gi) => {
          map.grids[gi] = toggleStamp(map.grids[gi]!, x, y, tool.stamp, tool.riverDir);
        });
      } else if (tool.kind === 'erase') {
        withActiveGrid((map, gi) => {
          map.grids[gi] = clearCell(map.grids[gi]!, x, y);
        });
      } else if (tool.kind === 'note') {
        const text = window.prompt('Note for this tile:') ?? '';
        withActiveGrid((map, gi) => {
          map.grids[gi] = setNote(map.grids[gi]!, x, y, text);
        });
      }
    },

    dragSelect(rect) {
      set({
        selection: { mapId: get().activeMapId, grid: get().activeGrid, rect: normalizeRect(rect) },
      });
    },

    addAuxMap() {
      auxCounter += 1;
      const id = `aux-${auxCounter}`;
      const active = get().maps.find((m) => m.id === get().activeMapId);
      const base = active?.grids[get().activeGrid];
      const size = Math.max(base?.width ?? 9, base?.height ?? 9);
      mutate((maps) => {
        maps.push({ id, name: `Aux ${auxCounter}`, grids: [createGrid(size, size)] });
        return maps;
      });
      set({ activeMapId: id, activeGrid: 0 });
    },

    renameMap(id, name) {
      mutate((maps) => {
        const m = maps.find((x) => x.id === id);
        if (m) m.name = name;
        return maps;
      });
    },

    removeMap(id) {
      if (id === 'main') return;
      mutate((maps) => maps.filter((m) => m.id !== id));
      if (get().activeMapId === id) set({ activeMapId: 'main', activeGrid: 0 });
    },

    copySelection() {
      const { selection, maps } = get();
      if (!selection) return;
      const map = maps.find((m) => m.id === selection.mapId);
      const grid = map?.grids[selection.grid];
      if (!grid) return;
      set({ clipboard: extract(grid, selection.rect) });
    },

    cutSelection() {
      const { selection } = get();
      if (!selection) return;
      get().copySelection();
      withActiveGrid((map, gi) => {
        map.grids[gi] = clearRect(map.grids[gi]!, selection.rect);
      });
    },

    startPaste() {
      const { clipboard } = get();
      if (clipboard) set({ pending: clipboard });
    },

    startMerge(auxMapId) {
      const aux = get().maps.find((m) => m.id === auxMapId);
      const grid = aux?.grids[0];
      if (!grid) return;
      set({ pending: gridToFragment(grid), activeMapId: 'main' });
    },

    cancelPending() {
      set({ pending: null });
    },

    clearSelection() {
      set({ selection: null });
    },

    undo() {
      const { undoStack, maps, storageKey } = get();
      const prev = undoStack[undoStack.length - 1];
      if (!prev) return;
      set({
        maps: prev.maps,
        undoStack: undoStack.slice(0, -1),
        redoStack: [...get().redoStack, { maps }],
      });
      persist({ storageKey, maps: prev.maps });
    },

    redo() {
      const { redoStack, maps, storageKey } = get();
      const next = redoStack[redoStack.length - 1];
      if (!next) return;
      set({
        maps: next.maps,
        redoStack: redoStack.slice(0, -1),
        undoStack: [...get().undoStack, { maps }],
      });
      persist({ storageKey, maps: next.maps });
    },
  };
});
