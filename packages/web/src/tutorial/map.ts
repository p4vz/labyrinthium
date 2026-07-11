import { createEdgeGrid, setEdge, type MapDocument } from '@labyrinthium/shared';

/**
 * The hand-authored practice labyrinth the tutorial is scripted against.
 * One 5×5 level, laid out so every teaching beat sits on the walking route:
 *
 *         x0   x1   x2   x3   x4
 *       ┌────┬────┬────┬────┬────┐
 *   y0  │    →    →    │    │    │   top corridor: the grenade-free detour
 *       │    ├────┤    ├────┼────┤
 *   y1  │    │ ~m ▓▓ 💰 │ 💎 │    │   ▓▓ the grenade wall · 💰 coins · 💎 treasure
 *       │    ├────┤    ├────┼────┤
 *       │    │ ↑~ ├────┴────┴────┤
 *   y2  🚪 →  │ ~~ │    │    │    │   🚪 entrance gate (W) · ~~ river flowing north
 *       ├────┼────┼────┼────┼────┤
 *   y3  │    │    │    │    │    │
 *       ├────┼────┼────┼────┼────┤
 *   y4  │    │    │    │    │    │
 *       └────┴────┴────┴────┴────┘
 *
 * The scripted route: bump the wall south of the entrance, step east into
 * the river (the current drags you to its mouth), bump the wall east of the
 * mouth, grenade it, scoop the coins, lift the treasure next door, and carry
 * it back out through the gate (west corridor, then south). The top corridor
 * keeps the treasure legal per validateMap (reachable without spending a
 * grenade), so a player who wastes the whole kit can still finish the long
 * way round.
 */
export const TUTORIAL_ENTRANCE = { level: 0, x: 0, y: 2 } as const;
export const TUTORIAL_TREASURE = { level: 0, x: 3, y: 1 } as const;
export const TUTORIAL_COINS = { at: { x: 2, y: 1 }, amount: 25 } as const;
/** the wall the grenade lesson blows open: east side of the river mouth */
export const TUTORIAL_GRENADE_WALL = { x: 1, y: 1, side: 'E' } as const;
/** river cells in flow order — stepping on (1,2) drags you north to (1,1) */
export const TUTORIAL_RIVER_CELLS = [
  { x: 1, y: 2 },
  { x: 1, y: 1 },
] as const;

export function tutorialMap(): MapDocument {
  const edges = createEdgeGrid(5, 5, 'wall');
  const open = (x: number, y: number, d: 'N' | 'E' | 'S' | 'W'): void =>
    setEdge(edges, { x, y }, d, 'open');

  // the gate: the way in is the way out
  setEdge(edges, { x: 0, y: 2 }, 'W', 'exit');
  // the scripted route
  open(0, 2, 'E'); // entrance -> river
  open(1, 2, 'N'); // the river's course
  open(1, 1, 'W'); // river mouth -> west corridor
  open(0, 1, 'S'); // west corridor -> entrance
  open(2, 1, 'E'); // coins -> treasure
  // the grenade-free detour over the top
  open(0, 1, 'N');
  open(0, 0, 'E');
  open(1, 0, 'E');
  open(2, 0, 'S');

  return {
    version: 1,
    levels: [
      {
        width: 5,
        height: 5,
        edges,
        features: [
          { type: 'river', cells: TUTORIAL_RIVER_CELLS.map((c) => ({ ...c })) },
          { type: 'coins', at: { ...TUTORIAL_COINS.at }, amount: TUTORIAL_COINS.amount },
        ],
      },
    ],
    entrance: { ...TUTORIAL_ENTRANCE },
    spawns: { treasure: { ...TUTORIAL_TREASURE }, monsters: [] },
    metadata: { name: 'The Practice Labyrinth', seed: 'tutorial', difficulty: 1 },
  };
}
