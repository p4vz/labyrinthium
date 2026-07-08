import { useRef, useState } from 'react';
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
  exit: { stroke: '#7dc981', width: 5, dash: '3 5' },
  gate: { stroke: '#e0902e', width: 5, dash: '3 5' },
};

export interface MapGridProps {
  grid: PlayerGrid;
  interactive?: boolean;
  selection?: Rect | null;
  pending?: Fragment | null;
  selectMode?: boolean;
  /** swipe gestures: 'wall' paints edge runs, 'river' paints flow chains */
  paintMode?: 'wall' | 'river' | null;
  onEdgeClick?(x: number, y: number, side: 'N' | 'W'): void;
  onCellClick?(x: number, y: number): void;
  onDragSelect?(rect: Rect): void;
  onPaintWalls?(edges: { kind: 'h' | 'v'; x: number; y: number }[]): void;
  onPaintRiver?(cells: { x: number; y: number; dir: 'N' | 'E' | 'S' | 'W' }[]): void;
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
  /** raw swipe path (SVG units) for the wall/river paint gestures */
  const paintPath = useRef<{ x: number; y: number }[] | null>(null);
  /** a completed swipe eats the synthetic click that follows it */
  const swipeConsumed = useRef(false);

  const w = grid.width * CS + PAD * 2;
  const h = grid.height * CS + PAD * 2;
  const px = (x: number): number => PAD + x * CS;
  const py = (y: number): number => PAD + y * CS;

  /** Pointer position in unscaled SVG units. */
  function svgPoint(e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = rect.width / w; // SVG may be CSS-scaled on small screens
    return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
  }

  /** Which cell a pointer event lands on, from raw coordinates. */
  function cellAt(e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null {
    const p = svgPoint(e);
    const cx = Math.floor((p.x - PAD) / CS);
    const cy = Math.floor((p.y - PAD) / CS);
    if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return null;
    return { x: cx, y: cy };
  }

  /** Straight-line wall run along the dominant axis of the swipe. */
  function wallsFromSwipe(path: { x: number; y: number }[]): { kind: 'h' | 'v'; x: number; y: number }[] {
    const a = path[0]!;
    const b = path[path.length - 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const out: { kind: 'h' | 'v'; x: number; y: number }[] = [];
    if (Math.abs(dx) >= Math.abs(dy)) {
      // horizontal swipe -> horizontal edges on the nearest grid line
      const row = Math.max(0, Math.min(grid.height, Math.round(((a.y + b.y) / 2 - PAD) / CS)));
      const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - PAD) / CS));
      const x1 = Math.min(grid.width - 1, Math.floor((Math.max(a.x, b.x) - PAD) / CS));
      for (let x = x0; x <= x1; x++) out.push({ kind: 'h', x, y: row });
    } else {
      const col = Math.max(0, Math.min(grid.width, Math.round(((a.x + b.x) / 2 - PAD) / CS)));
      const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - PAD) / CS));
      const y1 = Math.min(grid.height - 1, Math.floor((Math.max(a.y, b.y) - PAD) / CS));
      for (let y = y0; y <= y1; y++) out.push({ kind: 'v', x: col, y });
    }
    return out;
  }

  /** River chain following the swipe path, arrows pointing along the flow. */
  function riverFromSwipe(path: { x: number; y: number }[]): { x: number; y: number; dir: 'N' | 'E' | 'S' | 'W' }[] {
    const cells: { x: number; y: number }[] = [];
    for (const p of path) {
      const cx = Math.floor((p.x - PAD) / CS);
      const cy = Math.floor((p.y - PAD) / CS);
      if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) continue;
      const prev = cells[cells.length - 1];
      if (!prev || prev.x !== cx || prev.y !== cy) cells.push({ x: cx, y: cy });
    }
    if (cells.length === 0) return [];
    const dirBetween = (a: { x: number; y: number }, b: { x: number; y: number }): 'N' | 'E' | 'S' | 'W' =>
      Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? (b.x >= a.x ? 'E' : 'W') : (b.y >= a.y ? 'S' : 'N');
    if (cells.length === 1) {
      // single cell: the swipe's own direction sets the flow
      const a = path[0]!;
      const b = path[path.length - 1]!;
      return [{ ...cells[0]!, dir: dirBetween({ x: a.x, y: a.y }, { x: b.x, y: b.y }) }];
    }
    return cells.map((c, i) => ({
      ...c,
      dir: i < cells.length - 1 ? dirBetween(c, cells[i + 1]!) : dirBetween(cells[i - 1]!, c),
    }));
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
            {(mark === 'exit' || mark === 'gate') && doorGlyph(px(x) + CS / 2, py(row), mark)}
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
            {(mark === 'exit' || mark === 'gate') && doorGlyph(px(col), py(y) + CS / 2, mark)}
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
      // Block scroll gestures while a drag gesture (select, paste ghost,
      // wall/river swipe) is active, so panning still works otherwise.
      style={{
        touchAction: props.selectMode || props.pending || props.paintMode ? 'none' : 'manipulation',
      }}
      onPointerDown={(e) => {
        if (props.selectMode && !props.pending) {
          const c = cellAt(e);
          if (c) {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({ x0: c.x, y0: c.y, x1: c.x, y1: c.y });
          }
        } else if (props.paintMode && !props.pending) {
          paintPath.current = [svgPoint(e)];
        }
      }}
      onPointerMove={(e) => {
        const c = cellAt(e);
        if (c) setHover(c);
        if (drag && c) setDrag({ ...drag, x1: c.x, y1: c.y });
        if (paintPath.current) paintPath.current.push(svgPoint(e));
      }}
      onPointerUp={() => {
        if (drag) {
          props.onDragSelect?.(normalizeRect(drag));
          setDrag(null);
        }
        const path = paintPath.current;
        paintPath.current = null;
        if (path && path.length > 1) {
          const a = path[0]!;
          const b = path[path.length - 1]!;
          const moved = Math.hypot(b.x - a.x, b.y - a.y);
          // Short taps fall through to the normal edge/cell click handlers.
          if (moved >= CS * 0.45) {
            if (props.paintMode === 'wall') props.onPaintWalls?.(wallsFromSwipe(path));
            else if (props.paintMode === 'river') props.onPaintRiver?.(riverFromSwipe(path));
            swipeConsumed.current = true;
            setTimeout(() => {
              swipeConsumed.current = false;
            }, 0);
          }
        }
      }}
      onPointerLeave={() => {
        setHover(null);
        paintPath.current = null;
      }}
      onClickCapture={(e) => {
        // A finished swipe must not ALSO fire the tap action underneath it.
        if (swipeConsumed.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      <rect x={0} y={0} width={w} height={h} fill="#1d1712" rx={6} />
      {cells}
      {edges}
      {ghost}
    </svg>
  );
}

/**
 * Gate badge on an edge: an archway. Amber = the entrance you came in
 * through; green = an EXIT the game master confirmed.
 */
export function doorGlyph(cx: number, cy: number, kind: 'gate' | 'exit'): JSX.Element {
  const color = kind === 'gate' ? '#e0902e' : '#7dc981';
  return (
    <g pointerEvents="none">
      <circle cx={cx} cy={cy} r={7.5} fill="#1a130c" stroke={color} strokeWidth={1.3} />
      {/* archway: two posts + a rounded top */}
      <path
        d={`M ${cx - 3.4} ${cy + 4} L ${cx - 3.4} ${cy - 0.5} A 3.4 3.4 0 0 1 ${cx + 3.4} ${cy - 0.5} L ${cx + 3.4} ${cy + 4}`}
        fill="none"
        stroke={color}
        strokeWidth={1.4}
      />
      {/* threshold */}
      <line x1={cx - 4.6} y1={cy + 4.2} x2={cx + 4.6} y2={cy + 4.2} stroke={color} strokeWidth={1.2} />
    </g>
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
