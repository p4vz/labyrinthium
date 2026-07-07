import { useState } from 'react';
import type { Fragment, PlayerGrid, Rect, Stamp } from '../state/playerMap.js';
import { normalizeRect } from '../state/playerMap.js';

export const STAMP_GLYPHS: Record<Stamp, string> = {
  you: '🧍',
  entrance: '🏁',
  empty: '·',
  river: '➤',
  teleport: '◎',
  stairs: '↕',
  trapdoor: '⤵',
  mine: '💣',
  trap: '✖',
  monster: '👹',
  treasure: '💰',
  exit: '🚪',
  flag: '⚑',
  piece1: '🔴',
  piece2: '🔵',
  piece3: '🟢',
  piece4: '🟣',
  piece5: '🟠',
  piece6: '🟤',
  piece7: '⚫',
  piece8: '⚪',
};

const CS = 36; // cell size in px
const PAD = 6;

// Chalk lines on dark stone: what you KNOW glows, what you don't stays dim.
const EDGE_STYLE: Record<string, { stroke: string; width: number; dash?: string }> = {
  unknown: { stroke: '#3b3229', width: 1, dash: '2 4' },
  open: { stroke: '#4a6b4a', width: 2 },
  wall: { stroke: '#d9c9a3', width: 5 },
  grate: { stroke: '#58a6d8', width: 4, dash: '5 4' },
};

export interface MapGridProps {
  grid: PlayerGrid;
  interactive?: boolean;
  selection?: Rect | null;
  pending?: Fragment | null;
  selectMode?: boolean;
  onEdgeClick?(x: number, y: number, side: 'N' | 'W'): void;
  onCellClick?(x: number, y: number): void;
  onDragSelect?(rect: Rect): void;
}

/**
 * The player's hand-drawn map as an interactive SVG grid. All interactions
 * are pointer-based so they work identically with mouse and touch:
 * taps hit cells/edges, and in select mode a drag sweeps out a rectangle
 * (computed from pointer coordinates, not per-element hover, so it works
 * on touchscreens too).
 */
export function MapGrid(props: MapGridProps): JSX.Element {
  const { grid } = props;
  const [drag, setDrag] = useState<Rect | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const w = grid.width * CS + PAD * 2;
  const h = grid.height * CS + PAD * 2;
  const px = (x: number): number => PAD + x * CS;
  const py = (y: number): number => PAD + y * CS;

  /** Which cell a pointer event lands on, from raw coordinates. */
  function cellAt(e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width / w; // SVG may be CSS-scaled on small screens
    const cx = Math.floor(((e.clientX - rect.left) / scale - PAD) / CS);
    const cy = Math.floor(((e.clientY - rect.top) / scale - PAD) / CS);
    if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return null;
    return { x: cx, y: cy };
  }

  const cells = [];
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const anno = grid.cells[y * grid.width + x];
      const inSelection =
        props.selection &&
        x >= props.selection.x0 &&
        x <= props.selection.x1 &&
        y >= props.selection.y0 &&
        y <= props.selection.y1;
      const inDrag = drag && (() => {
        const r = normalizeRect(drag);
        return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
      })();
      cells.push(
        <g key={`c${x},${y}`}>
          <rect
            x={px(x) + 1}
            y={py(y) + 1}
            width={CS - 2}
            height={CS - 2}
            fill={inDrag ? '#5a4318' : inSelection ? '#453413' : '#262019'}
            data-cell={`${x},${y}`}
            onClick={() => {
              if (!props.selectMode) props.onCellClick?.(x, y);
              else if (props.pending) props.onCellClick?.(x, y);
            }}
            style={{ cursor: props.interactive ? 'pointer' : 'default' }}
          />
          {anno && renderAnno(anno, px(x), py(y))}
        </g>,
      );
    }
  }

  const edges = [];
  if (props.interactive || true) {
    // horizontal edges (N side of cell (x, row))
    for (let row = 0; row <= grid.height; row++) {
      for (let x = 0; x < grid.width; x++) {
        const mark = grid.h[row * grid.width + x]!;
        const s = EDGE_STYLE[mark]!;
        edges.push(
          <g key={`h${x},${row}`}>
            <line
              x1={px(x)}
              y1={py(row)}
              x2={px(x + 1)}
              y2={py(row)}
              stroke={s.stroke}
              strokeWidth={s.width}
              strokeDasharray={s.dash}
              strokeLinecap="round"
            />
            {mark === 'grate' && grateGlyph(px(x) + CS / 2, py(row))}
            {props.onEdgeClick && (
              <line
                x1={px(x) + 4}
                y1={py(row)}
                x2={px(x + 1) - 4}
                y2={py(row)}
                stroke="transparent"
                strokeWidth={9}
                data-edge={`h:${x},${row}`}
                onClick={() => props.onEdgeClick?.(x, row, 'N')}
                style={{ cursor: 'crosshair' }}
              />
            )}
          </g>,
        );
      }
    }
    // vertical edges (W side of cell (col, y))
    for (let y = 0; y < grid.height; y++) {
      for (let col = 0; col <= grid.width; col++) {
        const mark = grid.v[y * (grid.width + 1) + col]!;
        const s = EDGE_STYLE[mark]!;
        edges.push(
          <g key={`v${col},${y}`}>
            <line
              x1={px(col)}
              y1={py(y)}
              x2={px(col)}
              y2={py(y + 1)}
              stroke={s.stroke}
              strokeWidth={s.width}
              strokeDasharray={s.dash}
              strokeLinecap="round"
            />
            {mark === 'grate' && grateGlyph(px(col), py(y) + CS / 2)}
            {props.onEdgeClick && (
              <line
                x1={px(col)}
                y1={py(y) + 4}
                x2={px(col)}
                y2={py(y + 1) - 4}
                stroke="transparent"
                strokeWidth={9}
                data-edge={`v:${col},${y}`}
                onClick={() => props.onEdgeClick?.(col, y, 'W')}
                style={{ cursor: 'crosshair' }}
              />
            )}
          </g>,
        );
      }
    }
  }

  // Ghost preview of a pending paste/merge at the hovered cell.
  let ghost = null;
  if (props.pending && hover) {
    const frag = props.pending;
    const parts = [];
    for (let fy = 0; fy < frag.height; fy++) {
      for (let fx = 0; fx < frag.width; fx++) {
        const tx = hover.x + fx;
        const ty = hover.y + fy;
        if (tx >= grid.width || ty >= grid.height) continue;
        const anno = frag.cells[fy * frag.width + fx];
        parts.push(
          <g key={`g${fx},${fy}`}>
            <rect x={px(tx) + 1} y={py(ty) + 1} width={CS - 2} height={CS - 2} fill="#2f4a63" opacity={0.6} />
            {anno && renderAnno(anno, px(tx), py(ty))}
          </g>,
        );
      }
    }
    ghost = <g opacity={0.75}>{parts}</g>;
  }

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="player-map-svg"
      // Block scroll gestures only while a drag-select or paste is active,
      // so normal panning of a big map still works on touchscreens.
      style={{ touchAction: props.selectMode || props.pending ? 'none' : 'manipulation' }}
      onPointerDown={(e) => {
        if (props.selectMode && !props.pending) {
          const c = cellAt(e);
          if (c) {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({ x0: c.x, y0: c.y, x1: c.x, y1: c.y });
          }
        }
      }}
      onPointerMove={(e) => {
        const c = cellAt(e);
        if (c) setHover(c);
        if (drag && c) setDrag({ ...drag, x1: c.x, y1: c.y });
      }}
      onPointerUp={() => {
        if (drag) {
          props.onDragSelect?.(normalizeRect(drag));
          setDrag(null);
        }
      }}
      onPointerLeave={() => {
        setHover(null);
      }}
    >
      <rect x={0} y={0} width={w} height={h} fill="#1d1712" rx={6} />
      {cells}
      {edges}
      {ghost}
    </svg>
  );
}

/** Portcullis badge on a grate edge — a dark disc with iron bars. */
export function grateGlyph(cx: number, cy: number): JSX.Element {
  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={7} fill="#10202e" stroke="#58a6d8" strokeWidth={1.2} />
      {/* vertical bars */}
      {[-3, 0, 3].map((dx) => (
        <line key={dx} x1={cx + dx} y1={cy - 4} x2={cx + dx} y2={cy + 4} stroke="#8cc4e8" strokeWidth={1.1} />
      ))}
      {/* cross brace */}
      <line x1={cx - 4.5} y1={cy - 1} x2={cx + 4.5} y2={cy - 1} stroke="#8cc4e8" strokeWidth={1.1} />
      <line x1={cx - 4.5} y1={cy + 2.5} x2={cx + 4.5} y2={cy + 2.5} stroke="#8cc4e8" strokeWidth={1.1} />
      {/* spikes at the bottom, like a raised portcullis */}
      {[-3, 0, 3].map((dx) => (
        <line key={`s${dx}`} x1={cx + dx} y1={cy + 4} x2={cx + dx} y2={cy + 5.2} stroke="#58a6d8" strokeWidth={0.8} />
      ))}
    </g>
  );
}

function renderAnno(anno: { stamps: Stamp[]; riverDir?: string; note?: string }, x: number, y: number): JSX.Element {
  const glyphs = anno.stamps.filter((s) => s !== 'river');
  const hasRiver = anno.stamps.includes('river');
  const riverRotation = { N: 270, E: 0, S: 90, W: 180 }[anno.riverDir ?? 'E'] ?? 0;
  // Up to 4 glyphs in a 2×2 mini-grid so a crowded entrance stays readable.
  const spots =
    glyphs.length <= 1
      ? [[0, 0]]
      : glyphs.length === 2
        ? [
            [-7, 0],
            [7, 0],
          ]
        : [
            [-7, -7],
            [7, -7],
            [-7, 7],
            [7, 7],
          ];
  return (
    <g pointerEvents="none">
      {hasRiver && (
        <text
          x={x + CS / 2}
          y={y + CS / 2}
          fontSize={16}
          fill="#58a6d8"
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(${riverRotation} ${x + CS / 2} ${y + CS / 2})`}
        >
          ➤
        </text>
      )}
      {glyphs.slice(0, 4).map((s, i) => (
        <text
          key={s}
          x={x + CS / 2 + (spots[i]?.[0] ?? 0)}
          y={y + CS / 2 + (spots[i]?.[1] ?? 0) + (hasRiver ? 6 : 0)}
          fontSize={s === 'empty' ? 20 : glyphs.length > 1 ? 11 : 16}
          fill={s === 'empty' ? '#7a6c55' : '#e2d6bd'}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {STAMP_GLYPHS[s]}
        </text>
      ))}
      {glyphs.length > 4 && (
        <text x={x + CS - 5} y={y + CS - 4} fontSize={8} textAnchor="middle">
          +{glyphs.length - 4}
        </text>
      )}
      {anno.note && (
        <text x={x + CS - 6} y={y + 10} fontSize={9} textAnchor="middle">
          ✍<title>{anno.note}</title>
        </text>
      )}
    </g>
  );
}
