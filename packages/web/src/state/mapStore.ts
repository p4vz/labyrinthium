import { create } from 'zustand';
import {
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

export interface MapStoreState {
  storageKey: string | null;
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
  ): void;
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
    maps: [],
    activeMapId: 'main',
    activeGrid: 0,
    tool: { kind: 'wall' },
    selection: null,
    clipboard: null,
    pending: null,
    undoStack: [],
    redoStack: [],

    initForGame(key, levelSizes, entrance) {
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
          maps[0]!.grids[entrance.level] = toggleStamp(
            maps[0]!.grids[entrance.level]!,
            entrance.x,
            entrance.y,
            'you',
          );
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

    setTool(tool) {
      set({ tool, pending: null });
    },

    clickEdge(x, y, side) {
      if (get().tool.kind !== 'wall') return;
      withActiveGrid((map, gi) => {
        map.grids[gi] = cycleEdge(map.grids[gi]!, x, y, side);
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
