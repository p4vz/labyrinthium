import { useState } from 'react';
import type { Fragment, PlayerGrid, Rect, Stamp } from '../state/playerMap.js';
import { normalizeRect } from '../state/playerMap.js';

export const STAMP_GLYPHS: Record<Stamp, string> = {
  you: '🧍',
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
};

const CS = 36; // cell size in px
const PAD = 6;

const EDGE_STYLE: Record<string, { stroke: string; width: number; dash?: string }> = {
  unknown: { stroke: '#d8d4c8', width: 1, dash: '2 4' },
  open: { stroke: '#b5e0b5', width: 2 },
  wall: { stroke: '#3a2f28', width: 5 },
  grate: { stroke: '#4a90d9', width: 4, dash: '5 4' },
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

/** The player's hand-drawn map as an interactive SVG grid. */
export function MapGrid(props: MapGridProps): JSX.Element {
  const { grid } = props;
  const [drag, setDrag] = useState<Rect | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  const w = grid.width * CS + PAD * 2;
  const h = grid.height * CS + PAD * 2;
  const px = (x: number): number => PAD + x * CS;
  const py = (y: number): number => PAD + y * CS;

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
            fill={inDrag ? '#ffe9a8' : inSelection ? '#fff3c4' : '#fffdf6'}
            data-cell={`${x},${y}`}
            onClick={() => props.onCellClick?.(x, y)}
            onMouseDown={(e) => {
              if (props.selectMode && e.button === 0) {
                e.preventDefault();
                setDrag({ x0: x, y0: y, x1: x, y1: y });
              }
            }}
            onMouseEnter={() => {
              setHover({ x, y });
              if (drag) setDrag({ ...drag, x1: x, y1: y });
            }}
            onMouseUp={() => {
              if (drag) {
                props.onDragSelect?.(normalizeRect(drag));
                setDrag(null);
              }
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
            <rect x={px(tx) + 1} y={py(ty) + 1} width={CS - 2} height={CS - 2} fill="#a8d5ff" opacity={0.45} />
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
      onMouseLeave={() => {
        setHover(null);
        setDrag(null);
      }}
    >
      <rect x={0} y={0} width={w} height={h} fill="#faf7ef" rx={6} />
      {cells}
      {edges}
      {ghost}
    </svg>
  );
}

function renderAnno(anno: { stamps: Stamp[]; riverDir?: string; note?: string }, x: number, y: number): JSX.Element {
  const glyphs = anno.stamps.filter((s) => s !== 'river');
  const hasRiver = anno.stamps.includes('river');
  const riverRotation = { N: 270, E: 0, S: 90, W: 180 }[anno.riverDir ?? 'E'] ?? 0;
  return (
    <g pointerEvents="none">
      {hasRiver && (
        <text
          x={x + CS / 2}
          y={y + CS / 2}
          fontSize={16}
          fill="#4a90d9"
          textAnchor="middle"
          dominantBaseline="central"
          transform={`rotate(${riverRotation} ${x + CS / 2} ${y + CS / 2})`}
        >
          ➤
        </text>
      )}
      {glyphs.slice(0, 2).map((s, i) => (
        <text
          key={s}
          x={x + CS / 2 + (glyphs.length > 1 ? (i === 0 ? -7 : 7) : 0)}
          y={y + CS / 2 + (hasRiver ? 8 : 0)}
          fontSize={glyphs.length > 1 ? 12 : 16}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {STAMP_GLYPHS[s]}
        </text>
      ))}
      {anno.note && (
        <text x={x + CS - 6} y={y + 10} fontSize={9} textAnchor="middle">
          ✍<title>{anno.note}</title>
        </text>
      )}
    </g>
  );
}
