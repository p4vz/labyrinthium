import { describe, expect, it } from 'vitest';
import {
  createGrid,
  cycleEdge,
  extract,
  gridToFragment,
  paste,
  toggleStamp,
  clearRect,
} from '../src/state/playerMap.js';
import { useMapStore } from '../src/state/mapStore.js';

describe('player map primitives', () => {
  it('cycles edge marks unknown -> wall -> open -> grate -> exit -> unknown', () => {
    let g = createGrid(3, 3);
    expect(g.h[0]).toBe('unknown');
    g = cycleEdge(g, 0, 0, 'N');
    expect(g.h[0]).toBe('wall');
    g = cycleEdge(g, 0, 0, 'N');
    expect(g.h[0]).toBe('open');
    g = cycleEdge(g, 0, 0, 'N');
    expect(g.h[0]).toBe('grate');
    g = cycleEdge(g, 0, 0, 'N');
    expect(g.h[0]).toBe('exit');
    g = cycleEdge(g, 0, 0, 'N');
    expect(g.h[0]).toBe('unknown');
  });

  it('the "you are here" stamp is unique and moves', () => {
    let g = createGrid(3, 3);
    g = toggleStamp(g, 0, 0, 'you');
    g = toggleStamp(g, 2, 2, 'you');
    const marks = g.cells.map((c, i) => (c?.stamps.includes('you') ? i : -1)).filter((i) => i >= 0);
    expect(marks).toEqual([8]); // only (2,2)
  });

  it('copy/paste carries cells and edges, and unknown never erases knowledge', () => {
    let src = createGrid(4, 4);
    src = cycleEdge(src, 1, 1, 'N'); // wall above (1,1)
    src = toggleStamp(src, 1, 1, 'treasure');
    const frag = extract(src, { x0: 1, y0: 1, x1: 2, y1: 2 });

    let dst = createGrid(4, 4);
    dst = cycleEdge(dst, 0, 0, 'N'); // pre-existing knowledge outside paste area
    dst = cycleEdge(dst, 2, 3, 'N'); // pre-existing knowledge INSIDE paste area
    dst = cycleEdge(dst, 2, 3, 'N'); // -> open
    const before = dst.h[3 * 4 + 2];
    expect(before).toBe('open');

    dst = paste(dst, frag, 1, 2); // paste offset (+0, +1) relative to extraction
    // treasure stamp landed at (1,2)+(0,0) -> (1, 2)? fragment cell (0,0) is src (1,1)
    expect(dst.cells[2 * 4 + 1]?.stamps).toContain('treasure');
    // the wall above src (1,1) maps to h edge at row 2, x 1
    expect(dst.h[2 * 4 + 1]).toBe('wall');
    // pre-existing open edge at (2,3).N survives, because the fragment there is 'unknown'
    expect(dst.h[3 * 4 + 2]).toBe('open');
    // knowledge outside the paste area untouched
    expect(dst.h[0]).toBe('wall');
  });

  it('paste clips at the grid border without throwing', () => {
    let src = createGrid(3, 3);
    src = toggleStamp(src, 2, 2, 'monster');
    const frag = gridToFragment(src);
    const dst = paste(createGrid(3, 3), frag, 2, 2); // mostly out of bounds
    expect(dst.cells.filter((c) => c?.stamps.includes('monster'))).toHaveLength(0);
    expect(dst.width).toBe(3);
  });

  it('clearRect wipes annotations and surrounding edges', () => {
    let g = createGrid(3, 3);
    g = toggleStamp(g, 1, 1, 'mine');
    g = cycleEdge(g, 1, 1, 'N');
    g = clearRect(g, { x0: 1, y0: 1, x1: 1, y1: 1 });
    expect(g.cells[4]).toBeNull();
    expect(g.h[1 * 3 + 1]).toBe('unknown');
  });
});

describe('map store: undo/redo, aux maps, merge', () => {
  function fresh(): typeof useMapStore {
    useMapStore.getState().initForGame(`test-${Math.random()}`, [{ width: 5, height: 5 }], {
      level: 0,
      x: 0,
      y: 0,
    });
    return useMapStore;
  }

  it('mutations are undoable and redoable', () => {
    const store = fresh();
    store.getState().setTool({ kind: 'stamp', stamp: 'flag' });
    store.getState().clickCell(2, 2);
    expect(store.getState().maps[0]!.grids[0]!.cells[2 * 5 + 2]?.stamps).toContain('flag');
    store.getState().undo();
    expect(store.getState().maps[0]!.grids[0]!.cells[2 * 5 + 2]).toBeNull();
    store.getState().redo();
    expect(store.getState().maps[0]!.grids[0]!.cells[2 * 5 + 2]?.stamps).toContain('flag');
  });

  it('aux maps: create, draw, merge onto main with offset, delete', () => {
    const store = fresh();
    store.getState().addAuxMap();
    const auxId = store.getState().activeMapId;
    expect(auxId).not.toBe('main');

    // Draw a wall + teleport pad on the aux map at (0,0)/(1,0).
    store.getState().setTool({ kind: 'wall' });
    store.getState().clickEdge(0, 0, 'N');
    store.getState().setTool({ kind: 'stamp', stamp: 'teleport' });
    store.getState().clickCell(1, 0);

    // Merge: ghost fragment, then click (2,3) on the main map.
    store.getState().startMerge(auxId);
    expect(store.getState().activeMapId).toBe('main');
    expect(store.getState().pending).not.toBeNull();
    store.getState().clickCell(2, 3);
    const main = store.getState().maps.find((m) => m.id === 'main')!.grids[0]!;
    expect(main.cells[3 * 5 + 3]?.stamps).toContain('teleport'); // (1,0)+(2,3)=(3,3)
    expect(main.h[3 * 5 + 2]).toBe('wall'); // aux (0,0).N -> main (2,3).N
    expect(store.getState().pending).toBeNull();

    store.getState().removeMap(auxId);
    expect(store.getState().maps.some((m) => m.id === auxId)).toBe(false);
  });

  it('copy from one map, paste into another', () => {
    const store = fresh();
    store.getState().setTool({ kind: 'stamp', stamp: 'exit' });
    store.getState().clickCell(4, 4);
    store.getState().setTool({ kind: 'select' });
    store.getState().dragSelect({ x0: 4, y0: 4, x1: 4, y1: 4 });
    store.getState().copySelection();

    store.getState().addAuxMap();
    store.getState().startPaste();
    store.getState().clickCell(0, 0);
    const aux = store.getState().maps.find((m) => m.id === store.getState().activeMapId)!;
    expect(aux.grids[0]!.cells[0]?.stamps).toContain('exit');
  });

  it('moveYouPawn slides the pawn with confirmed moves, clamped to the grid', () => {
    const store = fresh(); // entrance pawn at (0,0)
    store.getState().moveYouPawn('E');
    store.getState().moveYouPawn('S');
    let grid = store.getState().maps[0]!.grids[0]!;
    expect(grid.cells[1 * 5 + 1]?.stamps).toContain('you');
    // walking off the edge does nothing
    store.getState().moveYouPawn('W');
    store.getState().moveYouPawn('W');
    store.getState().moveYouPawn('W');
    grid = store.getState().maps[0]!.grids[0]!;
    expect(grid.cells[1 * 5 + 0]?.stamps).toContain('you');
    // pawn moves on an aux map too, wherever it currently is
    store.getState().addAuxMap();
    store.getState().setTool({ kind: 'stamp', stamp: 'you' });
    store.getState().clickCell(2, 2);
    store.getState().moveYouPawn('N');
    const aux = store.getState().maps.find((m) => m.id === store.getState().activeMapId)!;
    expect(aux.grids[0]!.cells[1 * aux.grids[0]!.width + 2]?.stamps).toContain('you');
  });

  it('entrance gate is auto-drawn on the border and foundExit charts a green gate at the pawn', () => {
    const store = fresh(); // entrance (0,0): border sides N and W get gates
    const grid = store.getState().maps[0]!.grids[0]!;
    expect(grid.h[0]).toBe('gate'); // (0,0).N
    expect(grid.v[0]).toBe('gate'); // (0,0).W
    // pawn walks east twice, then the GM reveals an exit to the north
    store.getState().moveYouPawn('E');
    store.getState().moveYouPawn('E');
    store.getState().markExitEdge('N');
    const after = store.getState().maps[0]!.grids[0]!;
    expect(after.h[2]).toBe('exit'); // (2,0).N
  });

  it('cut clears the source region', () => {
    const store = fresh();
    store.getState().setTool({ kind: 'stamp', stamp: 'mine' });
    store.getState().clickCell(1, 1);
    store.getState().setTool({ kind: 'select' });
    store.getState().dragSelect({ x0: 1, y0: 1, x1: 1, y1: 1 });
    store.getState().cutSelection();
    expect(store.getState().maps[0]!.grids[0]!.cells[1 * 5 + 1]).toBeNull();
    expect(store.getState().clipboard).not.toBeNull();
  });
});
