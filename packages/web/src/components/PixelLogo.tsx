/**
 * Retro pixel-art title: LABYRINTHIUM built from brick-like pixel letters,
 * flanked by two flickering pixel torches. Pure procedural SVG — no image
 * assets — with shape-rendering: crispEdges for the chunky 8-bit look.
 */

// 5×7 bitmap font, only the letters the title needs.
const FONT: Record<string, string[]> = {
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
};

const TITLE = 'LABYRINTHIUM';

// Weathered masonry: three brick shades picked deterministically per pixel,
// so the letters look laid by hand, not printed.
const BRICK_SHADES = ['#9c4f2c', '#8a4426', '#af5a33'];
const MORTAR_EDGE = '#5e2f1a';

function brickShade(x: number, y: number): string {
  return BRICK_SHADES[(x * 7 + y * 13) % BRICK_SHADES.length]!;
}

const P = 1; // one font pixel = 1 svg unit; scaled by the svg width

interface TorchProps {
  x: number;
  y: number;
  frame: 'a' | 'b';
}

/** 5×11 pixel wall torch. Two flame frames alternate via CSS for flicker. */
function Torch({ x, y }: Omit<TorchProps, 'frame'>): JSX.Element {
  const px = (fx: number, fy: number, fill: string, cls?: string): JSX.Element => (
    <rect key={`${fx},${fy},${fill},${cls ?? ''}`} x={x + fx} y={y + fy} width={P} height={P} fill={fill} className={cls} />
  );
  const parts: JSX.Element[] = [];
  // handle + sconce
  parts.push(px(2, 7, '#6b4a2a'));
  parts.push(px(2, 8, '#5a3c20'));
  parts.push(px(2, 9, '#6b4a2a'));
  parts.push(px(1, 10, '#4a3018'));
  parts.push(px(2, 10, '#5a3c20'));
  parts.push(px(3, 10, '#4a3018'));
  // ember base (always lit)
  parts.push(px(1, 6, '#e0902e'));
  parts.push(px(2, 6, '#f4b13c'));
  parts.push(px(3, 6, '#e0902e'));
  // flame frame A
  for (const [fx, fy, c] of [
    [2, 2, '#ffe08a'],
    [1, 3, '#f4b13c'],
    [2, 3, '#ffe08a'],
    [3, 4, '#e0902e'],
    [1, 4, '#e0902e'],
    [2, 4, '#f4b13c'],
    [2, 5, '#f4b13c'],
    [3, 5, '#c1591f'],
    [1, 5, '#c1591f'],
  ] as const) {
    parts.push(px(fx, fy, c, 'flame-a'));
  }
  // flame frame B (leans the other way, one pixel taller)
  for (const [fx, fy, c] of [
    [2, 1, '#ffe08a'],
    [3, 2, '#f4b13c'],
    [2, 2, '#ffe08a'],
    [1, 3, '#e0902e'],
    [3, 3, '#f4b13c'],
    [2, 3, '#f4b13c'],
    [2, 4, '#f4b13c'],
    [1, 4, '#c1591f'],
    [3, 4, '#e0902e'],
    [2, 5, '#e0902e'],
    [1, 5, '#c1591f'],
    [3, 5, '#c1591f'],
  ] as const) {
    parts.push(px(fx, fy, c, 'flame-b'));
  }
  return <g>{parts}</g>;
}

export function PixelLogo(): JSX.Element {
  const letterRects: JSX.Element[] = [];
  let cursor = 8; // room for the left torch
  const top = 3;

  for (const ch of TITLE) {
    const glyph = FONT[ch];
    if (!glyph) continue;
    glyph.forEach((row, gy) => {
      row.split('').forEach((bit, gx) => {
        if (bit !== '1') return;
        const x = cursor + gx;
        const y = top + gy;
        letterRects.push(
          <g key={`${x},${y}`}>
            <rect x={x} y={y} width={P} height={P} fill={brickShade(x, y)} />
            {/* mortar shadow along the bottom-right of every brick */}
            <rect x={x} y={y + 0.8} width={P} height={0.2} fill={MORTAR_EDGE} />
            <rect x={x + 0.8} y={y} width={0.2} height={P} fill={MORTAR_EDGE} />
          </g>,
        );
      });
    });
    cursor += 6; // 5px glyph + 1px gap
  }

  const width = cursor + 7; // room for the right torch
  const height = 13;

  return (
    <div className="pixel-logo" role="img" aria-label="Labyrinthium">
      <svg viewBox={`0 0 ${width} ${height}`} shapeRendering="crispEdges" preserveAspectRatio="xMidYMid meet">
        <Torch x={1} y={1} />
        {letterRects}
        <Torch x={width - 6} y={1} />
      </svg>
    </div>
  );
}
