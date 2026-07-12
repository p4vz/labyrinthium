import { createEdgeGrid, setEdge, type Inventory, type MapDocument, type Pos } from '@labyrinthium/shared';

/**
 * The hand-authored practice labyrinth the tutorial is scripted against.
 * One wide-open 5×5 level — only TWO interior walls, one per lesson — with
 * a river spanning the whole map and an arsenal on the north bank:
 *
 *         x0   x1   x2   x3   x4
 *       ┌────┬────┬────┬────┬────┐
 *   y0  │    │    │ 🎒 │    ▓▓ 💎 │   🎒 arsenal (floor gear) · ▓▓ grenade wall · 💎 treasure
 *       │    │    │    │    │    │
 *   y1  │ ~~ → ~~ → ~~ → ~~ → ~m │   river, west side to east side, flowing east
 *       │    │    │    │    │    │
 *   y2  🚪    │    │    │    │ 🪙 │   🚪 entrance gate (W) · 🪙 coins
 *       │    ├────┤    │    │    │
 *   y3  │    │    │    │    │    │   (the wall south of the entrance is the bump lesson)
 *       │    │    │    │    │    │
 *   y4  │    │    │    │    │    │
 *       └────┴────┴────┴────┴────┘
 *
 * The scripted route: bump the wall south of the entrance, step north into
 * the river (the current drags you east), ride the turn-start drift once
 * more and step out onto the arsenal, bump the treasure vault's wall,
 * grenade it, lift the treasure, and run home south over the river mouth
 * (scooping coins) and west along the open floor to the gate. Everything
 * is legal per validateMap without a single grenade — the vault also opens
 * from the south via the river mouth — so free explorers can never strand
 * themselves.
 */
export const TUTORIAL_ENTRANCE = { level: 0, x: 0, y: 2 } as const;
export const TUTORIAL_TREASURE = { level: 0, x: 4, y: 0 } as const;
export const TUTORIAL_COINS = { at: { x: 4, y: 2 }, amount: 25 } as const;
/** gear stash on the floor of the north bank — walking on it takes it all */
export const TUTORIAL_ARSENAL: { pos: Pos; items: Inventory } = {
  pos: { level: 0, x: 2, y: 0 },
  items: { grenades: 2, bullets: 2, mines: 1 },
};
/** the wall the grenade lesson blows open: east side of (3,0), into the vault */
export const TUTORIAL_GRENADE_WALL = { x: 3, y: 0, side: 'E' } as const;
/** river cells in flow order — the current drags everything east */
export const TUTORIAL_RIVER_CELLS = [
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 2, y: 1 },
  { x: 3, y: 1 },
  { x: 4, y: 1 },
] as const;

export function tutorialMap(): MapDocument {
  const edges = createEdgeGrid(5, 5, 'open');
  // the outer ring is solid stone…
  for (let x = 0; x < 5; x++) {
    setEdge(edges, { x, y: 0 }, 'N', 'wall');
    setEdge(edges, { x, y: 4 }, 'S', 'wall');
  }
  for (let y = 0; y < 5; y++) {
    setEdge(edges, { x: 0, y }, 'W', 'wall');
    setEdge(edges, { x: 4, y }, 'E', 'wall');
  }
  // …except the gate: the way in is the way out
  setEdge(edges, { x: 0, y: 2 }, 'W', 'exit');
  // the two lessons' walls — the only interior walls in the whole maze
  setEdge(edges, { x: 0, y: 2 }, 'S', 'wall'); // the free bump
  setEdge(edges, { x: 3, y: 0 }, 'E', 'wall'); // the grenade vault

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
