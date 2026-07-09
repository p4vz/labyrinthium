import { describe, expect, it } from 'vitest';
import { scale2x, scale4x } from '../src/cosmetics/upscale.js';

const A = 'a';
const B = 'b';
const _ = null;

describe('Scale2x / Scale4x pixel-art upscaling', () => {
  it('quadruples dimensions: 16x16 -> 64x64', () => {
    const grid = Array.from({ length: 16 }, () => Array<string | null>(16).fill(A));
    const up = scale4x(grid);
    expect(up.length).toBe(64);
    expect(up.every((row) => row.length === 64)).toBe(true);
  });

  it('leaves flat areas untouched (each pixel becomes a solid block)', () => {
    const grid = [
      [A, A],
      [A, A],
    ];
    const up = scale2x(grid);
    expect(up).toEqual([
      [A, A, A, A],
      [A, A, A, A],
      [A, A, A, A],
      [A, A, A, A],
    ]);
  });

  it('smooths a diagonal staircase instead of copying blocks', () => {
    // B on the anti-diagonal of a 2x2 grid
    const grid = [
      [_, B],
      [B, _],
    ];
    const up = scale2x(grid);
    // the transparent cells' corners BETWEEN the two Bs round toward them,
    // connecting the diagonal…
    expect(up[1]![1]).toBe(B); // bottom-right sub-pixel of the top-left cell
    expect(up[2]![2]).toBe(B); // top-left sub-pixel of the bottom-right cell
    // …while the far corners stay transparent
    expect(up[0]![0]).toBe(null);
    expect(up[3]![3]).toBe(null);
  });

  it('never invents colors: output cells all come from the input', () => {
    const grid = [
      [A, B, _, A],
      [B, _, A, B],
      [A, B, B, _],
      [_, A, B, A],
    ];
    const inputs = new Set([A, B, null]);
    for (const row of scale4x(grid)) {
      for (const cell of row) expect(inputs.has(cell)).toBe(true);
    }
  });

  it('is deterministic', () => {
    const grid = [
      [A, B, _],
      [B, A, B],
      [_, B, A],
    ];
    expect(JSON.stringify(scale4x(grid))).toBe(JSON.stringify(scale4x(grid)));
  });
});
