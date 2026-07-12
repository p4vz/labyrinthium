import type { AvatarConfig, MapDocument, Pos } from '@labyrinthium/shared';
import { doorGlyph, grateGlyph } from './MapGrid.js';
import { PixelAvatar } from './PixelAvatar.js';

// Same cell size as the players' hand-drawn maps, so an observer flipping
// between the true map and belief maps sees everything at one scale.
const CS = 36;
const PAD = 6;

const TRUE_EDGE_STYLE: Record<string, { stroke: string; width: number; dash?: string } | null> = {
  open: null,
  wall: { stroke: '#d9c9a3', width: 4 },
  reinforced: { stroke: '#e05b50', width: 6 },
  grate: { stroke: '#58a6d8', width: 3, dash: '5 4' },
  exit: { stroke: '#7dc981', width: 6, dash: '2 6' },
};

const FEATURE_GLYPHS: Record<string, string> = {
  teleport: '◎',
  stairs: '↕',
  trapdoor: '⤵',
  mine: '💣',
  trap: '✖',
  coins: '🪙',
};

export interface Overlay {
  players?: { id: string; name: string; pos: Pos; avatar?: AvatarConfig }[];
  monsters?: Pos[];
  treasure?: Pos | null;
  /** gear stashes on the floor (an arsenal — walking over one takes it all) */
  items?: Pos[];
}

export interface TrueMapViewProps {
  map: MapDocument;
  level: number;
  overlay?: Overlay;
  highlight?: { x: number; y: number }[];
  onEdgeClick?(x: number, y: number, side: 'N' | 'W'): void;
  onCellClick?(x: number, y: number): void;
}

/** Renders the REAL map — for the editor, the end-of-game reveal, and replays. */
export function TrueMapView(props: TrueMapViewProps): JSX.Element {
  const level = props.map.levels[props.level];
  if (!level) return <div>no such level</div>;
  const grid = level.edges;
  const w = grid.width * CS + PAD * 2;
  const h = grid.height * CS + PAD * 2;
  const px = (x: number): number => PAD + x * CS;
  const py = (y: number): number => PAD + y * CS;

  const parts: JSX.Element[] = [];

  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const hl = props.highlight?.some((c) => c.x === x && c.y === y);
      parts.push(
        <rect
          key={`c${x},${y}`}
          x={px(x) + 1}
          y={py(y) + 1}
          width={CS - 2}
          height={CS - 2}
          fill={hl ? '#5c2622' : '#262019'}
          data-truecell={`${x},${y}`}
          onClick={() => props.onCellClick?.(x, y)}
          style={{ cursor: props.onCellClick ? 'pointer' : 'default' }}
        />,
      );
    }
  }

  // Rivers as a blue path under everything else.
  for (const f of level.features) {
    if (f.type !== 'river') continue;
    const d = f.cells
      .map((c, i) => `${i === 0 ? 'M' : 'L'} ${px(c.x) + CS / 2} ${py(c.y) + CS / 2}`)
      .join(' ');
    parts.push(
      <path key={`river${d}`} d={d} stroke="#2f4a63" strokeWidth={10} fill="none" strokeLinecap="round" opacity={0.9} pointerEvents="none" />,
    );
    const last = f.cells[f.cells.length - 1]!;
    const prev = f.cells[f.cells.length - 2]!;
    const angle = (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI;
    parts.push(
      <text
        key={`riverhead${d}`}
        x={px(last.x) + CS / 2}
        y={py(last.y) + CS / 2}
        fontSize={13}
        fill="#58a6d8"
        textAnchor="middle"
        dominantBaseline="central"
        transform={`rotate(${angle} ${px(last.x) + CS / 2} ${py(last.y) + CS / 2})`}
        pointerEvents="none"
      >
        ➤
      </text>,
    );
  }

  // Point features.
  for (const f of level.features) {
    if (f.type === 'river') continue;
    const glyph = FEATURE_GLYPHS[f.type] ?? '?';
    const title =
      f.type === 'teleport'
        ? `teleport${f.label !== undefined ? ` №${f.label}` : ''} (${f.mode}) → L${f.target.level} (${f.target.x},${f.target.y})`
        : f.type === 'stairs'
          ? `stairs → L${f.to.level} (${f.to.x},${f.to.y})`
          : f.type === 'trapdoor'
            ? `trap door → L${f.to.level} (${f.to.x},${f.to.y})`
            : f.type === 'coins'
              ? `${f.amount} coins`
              : f.type;
    parts.push(
      <text
        key={`f${f.type}${f.at.x},${f.at.y}`}
        x={px(f.at.x) + CS / 2}
        y={py(f.at.y) + CS / 2}
        fontSize={15}
        fill="#e2d6bd"
        textAnchor="middle"
        dominantBaseline="central"
        pointerEvents="none"
      >
        {glyph}
        <title>{title}</title>
      </text>,
    );
    if (f.type === 'teleport' && f.label !== undefined) {
      parts.push(
        <text
          key={`tpl${f.at.x},${f.at.y}`}
          x={px(f.at.x) + 7}
          y={py(f.at.y) + CS - 5}
          fontSize={9}
          fontWeight="bold"
          fill="#c9a3e8"
          textAnchor="middle"
          pointerEvents="none"
        >
          {f.label}
        </text>,
      );
    }
  }

  // One-way teleport ARRIVAL spots: both sides of every teleport belong on
  // the map. (Two-way twins are pad features and already drawn above.)
  props.map.levels.forEach((srcLevel, srcIdx) => {
    for (const f of srcLevel.features) {
      if (f.type !== 'teleport' || f.mode !== 'oneWay') continue;
      if (f.target.level !== props.level) continue;
      const tx = px(f.target.x) + CS / 2;
      const ty = py(f.target.y) + CS / 2;
      parts.push(
        <text
          key={`tpx${srcIdx}:${f.at.x},${f.at.y}`}
          x={tx}
          y={ty}
          fontSize={15}
          fill="#9a86c9"
          textAnchor="middle"
          dominantBaseline="central"
          pointerEvents="none"
        >
          ◉
          <title>
            {`teleport${f.label !== undefined ? ` №${f.label}` : ''} arrival — pad on L${srcIdx} (${f.at.x},${f.at.y})`}
          </title>
        </text>,
      );
      if (f.label !== undefined) {
        parts.push(
          <text
            key={`tpxl${srcIdx}:${f.at.x},${f.at.y}`}
            x={px(f.target.x) + 7}
            y={py(f.target.y) + CS - 5}
            fontSize={9}
            fontWeight="bold"
            fill="#9a86c9"
            textAnchor="middle"
            pointerEvents="none"
          >
            {f.label}
          </text>,
        );
      }
    }
  });

  // Entrance / spawns on this level. The way in IS the way out — the gate is
  // an 'exit' edge on the entrance cell, drawn by the edge pass below.
  if (props.map.entrance.level === props.level) {
    const e = props.map.entrance;
    parts.push(cellGlyph('entrance', px(e.x), py(e.y), '🏁'));
  }
  const treasure = props.overlay?.treasure ?? props.map.spawns.treasure;
  if (treasure && treasure.level === props.level) {
    parts.push(cellGlyph('treasure', px(treasure.x), py(treasure.y), '💰'));
  }
  const monsters = props.overlay?.monsters ?? props.map.spawns.monsters.map((m) => m.at);
  monsters.forEach((m, i) => {
    if (m.level === props.level) parts.push(cellGlyph(`monster${i}`, px(m.x), py(m.y), '👹'));
  });
  props.overlay?.items?.forEach((it, i) => {
    if (it.level === props.level) parts.push(cellGlyph(`items${i}`, px(it.x), py(it.y), '🎒'));
  });
  props.overlay?.players?.forEach((p, i) => {
    if (p.pos.level === props.level) {
      const cx = px(p.pos.x) + CS / 2;
      const cy = py(p.pos.y) + CS / 2;
      const seatColor = ['#e5793a', '#7a5fd0', '#2e9e44', '#d04f7a'][i % 4]!;
      parts.push(
        <g key={`pl${p.id}`} pointerEvents="none">
          {p.avatar ? (
            <>
              {/* seat-color ring keeps the who-is-who system; the pawn is the avatar */}
              <circle cx={cx} cy={cy} r={13} fill="#16110d" stroke={seatColor} strokeWidth={2} opacity={0.95} />
              <g transform={`translate(${cx - 11}, ${cy - 11})`}>
                <PixelAvatar avatar={p.avatar} size={22} title={p.name} />
              </g>
            </>
          ) : (
            <>
              <circle cx={cx} cy={cy} r={11} fill={seatColor} opacity={0.85} />
              <text x={cx} y={cy} fontSize={11} fill="#fff" textAnchor="middle" dominantBaseline="central">
                {p.name.slice(0, 2)}
              </text>
            </>
          )}
        </g>,
      );
    }
  });

  // Edges last, on top.
  const edges: JSX.Element[] = [];
  for (let row = 0; row <= grid.height; row++) {
    for (let x = 0; x < grid.width; x++) {
      const state = grid.h[row * grid.width + x]!;
      const s = TRUE_EDGE_STYLE[state];
      edges.push(
        <g key={`h${x},${row}`}>
          {s && (
            <line x1={px(x)} y1={py(row)} x2={px(x + 1)} y2={py(row)} stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" pointerEvents="none" />
          )}
          {state === 'grate' && grateGlyph(px(x) + CS / 2, py(row))}
          {state === 'exit' && doorGlyph(px(x) + CS / 2, py(row), 'exit')}
          {props.onEdgeClick && (
            <line x1={px(x) + 4} y1={py(row)} x2={px(x + 1) - 4} y2={py(row)} stroke="transparent" strokeWidth={9} data-trueedge={`h:${x},${row}`} onClick={() => props.onEdgeClick?.(x, row, 'N')} style={{ cursor: 'crosshair' }} />
          )}
        </g>,
      );
    }
  }
  for (let y = 0; y < grid.height; y++) {
    for (let col = 0; col <= grid.width; col++) {
      const state = grid.v[y * (grid.width + 1) + col]!;
      const s = TRUE_EDGE_STYLE[state];
      edges.push(
        <g key={`v${col},${y}`}>
          {s && (
            <line x1={px(col)} y1={py(y)} x2={px(col)} y2={py(y + 1)} stroke={s.stroke} strokeWidth={s.width} strokeDasharray={s.dash} strokeLinecap="round" pointerEvents="none" />
          )}
          {state === 'grate' && grateGlyph(px(col), py(y) + CS / 2)}
          {state === 'exit' && doorGlyph(px(col), py(y) + CS / 2, 'exit')}
          {props.onEdgeClick && (
            <line x1={px(col)} y1={py(y) + 4} x2={px(col)} y2={py(y + 1) - 4} stroke="transparent" strokeWidth={9} data-trueedge={`v:${col},${y}`} onClick={() => props.onEdgeClick?.(col, y, 'W')} style={{ cursor: 'crosshair' }} />
          )}
        </g>,
      );
    }
  }

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} data-testid={`truemap-l${props.level}`}>
      <rect x={0} y={0} width={w} height={h} fill="#1d1712" rx={6} />
      {parts}
      {edges}
    </svg>
  );
}

function cellGlyph(key: string, x: number, y: number, glyph: string): JSX.Element {
  return (
    <text key={key} x={x + CS / 2} y={y + CS / 2 - 8} fontSize={13} textAnchor="middle" dominantBaseline="central" pointerEvents="none">
      {glyph}
    </text>
  );
}
