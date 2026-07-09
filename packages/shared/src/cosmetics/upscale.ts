/**
 * Pixel-art upscaling (AdvMAME Scale2x / Scale4x). Every cosmetic asset is
 * authored once at 16x16; the wardrobe and character-card screens show a 4x
 * version derived by this filter — diagonals smooth out and corners round,
 * while flat areas stay untouched, so the art keeps its pixel soul. The
 * in-game renders (pawns, map stamps, lobby chips) keep the raw 16x16.
 *
 * Deterministic and pure: high-res art is always exactly in sync with the
 * low-res source — there is one catalog, two renditions.
 */

type Grid<T> = (T | null)[][];

/** Neighbor lookup with edge clamping — off-grid reads repeat the border
 * pixel (the standard Scale2x convention), so edges never erode. */
function at<T>(grid: Grid<T>, x: number, y: number): T | null {
  const cy = Math.min(Math.max(y, 0), grid.length - 1);
  const row = grid[cy]!;
  const cx = Math.min(Math.max(x, 0), row.length - 1);
  return row[cx] ?? null;
}

/** One AdvMAME2x pass: each pixel becomes 2x2, edges follow their neighbors. */
export function scale2x<T>(grid: Grid<T>): Grid<T> {
  const h = grid.length;
  const w = h > 0 ? grid[0]!.length : 0;
  const out: Grid<T> = Array.from({ length: h * 2 }, () => Array<T | null>(w * 2).fill(null));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = at(grid, x, y);
      const b = at(grid, x, y - 1); // up
      const d = at(grid, x - 1, y); // left
      const f = at(grid, x + 1, y); // right
      const hh = at(grid, x, y + 1); // down
      let e0 = e;
      let e1 = e;
      let e2 = e;
      let e3 = e;
      if (b !== hh && d !== f) {
        e0 = d === b ? d : e;
        e1 = b === f ? f : e;
        e2 = d === hh ? d : e;
        e3 = hh === f ? f : e;
      }
      out[y * 2]![x * 2] = e0;
      out[y * 2]![x * 2 + 1] = e1;
      out[y * 2 + 1]![x * 2] = e2;
      out[y * 2 + 1]![x * 2 + 1] = e3;
    }
  }
  return out;
}

/** Scale2x twice: 16x16 -> 64x64. */
export function scale4x<T>(grid: Grid<T>): Grid<T> {
  return scale2x(scale2x(grid));
}
