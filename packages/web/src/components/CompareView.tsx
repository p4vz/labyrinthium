import type { MapDocument } from '@labyrinthium/shared';
import { getEdge } from '@labyrinthium/shared';
import type { PlayerGrid, Stamp } from '../state/playerMap.js';
import { STAMP_GLYPHS } from './MapGrid.js';

const CS = 36; // matches MapGrid/TrueMapView so all views share one scale
const PAD = 6;

const GOOD = '#7dc981';
const BAD = '#e05b50';

/** Which belief stamps are gradeable against the true map (the rest —
 * pawns, pieces, flags, notes — are bookkeeping, not claims). */
const GRADED_STAMPS: Stamp[] = [
  'river',
  'teleport',
  'stairs',
  'trapdoor',
  'mine',
  'trap',
  'treasure',
  'exit',
  'empty',
];

interface CellVerdict {
  x: number;
  y: number;
  stamp: Stamp;
  correct: boolean;
}

interface EdgeVerdict {
  kind: 'h' | 'v';
  x: number;
  y: number;
  correct: boolean;
}

export interface CompareResult {
  edges: EdgeVerdict[];
  cells: CellVerdict[];
  correct: number;
  wrong: number;
}

/** Grade one belief grid against one true level. */
export function compareLevel(map: MapDocument, level: number, belief: PlayerGrid): CompareResult {
  const truth = map.levels[level]!;
  const edges: EdgeVerdict[] = [];
  const cells: CellVerdict[] = [];

  const truthOf = (kind: 'h' | 'v', x: number, y: number): string =>
    kind === 'h' ? truth.edges.h[y * truth.width + x]! : truth.edges.v[y * (truth.width + 1) + x]!;

  const edgeMatches = (belief: string, actual: string): boolean => {
    if (belief === 'wall') return actual === 'wall' || actual === 'reinforced';
    return belief === actual; // open/grate/exit map 1:1
  };

  for (let y = 0; y <= belief.height; y++) {
    for (let x = 0; x < belief.width; x++) {
      const mark = belief.h[y * belief.width + x]!;
      if (mark === 'unknown' || mark === 'gate') continue;
      edges.push({ kind: 'h', x, y, correct: edgeMatches(mark, truthOf('h', x, y)) });
    }
  }
  for (let y = 0; y < belief.height; y++) {
    for (let x = 0; x <= belief.width; x++) {
      const mark = belief.v[y * (belief.width + 1) + x]!;
      if (mark === 'unknown' || mark === 'gate') continue;
      edges.push({ kind: 'v', x, y, correct: edgeMatches(mark, truthOf('v', x, y)) });
    }
  }

  const featureTypesAt = (x: number, y: number): Set<string> => {
    const out = new Set<string>();
    for (const f of truth.features) {
      if (f.type === 'river') {
        if (f.cells.some((c) => c.x === x && c.y === y)) out.add('river');
      } else if (f.at.x === x && f.at.y === y) {
        out.add(f.type);
      }
    }
    if (map.spawns.treasure.level === level && map.spawns.treasure.x === x && map.spawns.treasure.y === y) {
      out.add('treasure');
    }
    return out;
  };

  for (let y = 0; y < belief.height; y++) {
    for (let x = 0; x < belief.width; x++) {
      const anno = belief.cells[y * belief.width + x];
      if (!anno) continue;
      const actual = featureTypesAt(x, y);
      for (const stamp of anno.stamps) {
        if (!GRADED_STAMPS.includes(stamp)) continue;
        let correct: boolean;
        if (stamp === 'empty') {
          correct = actual.size === 0;
        } else if (stamp === 'exit') {
          correct = (['N', 'E', 'S', 'W'] as const).some(
            (d) => getEdge(truth.edges, { x, y }, d) === 'exit',
          );
        } else {
          correct = actual.has(stamp);
        }
        cells.push({ x, y, stamp, correct });
      }
    }
  }

  const all = [...edges, ...cells];
  return {
    edges,
    cells,
    correct: all.filter((v) => v.correct).length,
    wrong: all.filter((v) => !v.correct).length,
  };
}

/**
 * The reckoning: the true map, with everything YOU claimed superimposed —
 * green where you were right, red where the labyrinth fooled you.
 */
export function CompareView(props: {
  map: MapDocument;
  level: number;
  belief: PlayerGrid;
}): JSX.Element {
  const truth = props.map.levels[props.level]!;
  const result = compareLevel(props.map, props.level, props.belief);
  const w = truth.width * CS + PAD * 2;
  const h = truth.height * CS + PAD * 2;
  const px = (x: number): number => PAD + x * CS;
  const py = (y: number): number => PAD + y * CS;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} data-testid={`compare-l${props.level}`}>
      <rect x={0} y={0} width={w} height={h} fill="#1d1712" rx={6} />
      {/* the truth, drawn faint underneath */}
      {truth.edges.h.map((state, i) => {
        if (state === 'open') return null;
        const x = i % truth.width;
        const y = Math.floor(i / truth.width);
        return (
          <line key={`th${i}`} x1={px(x)} y1={py(y)} x2={px(x + 1)} y2={py(y)} stroke="#8a7b64" strokeWidth={3} opacity={0.35} />
        );
      })}
      {truth.edges.v.map((state, i) => {
        if (state === 'open') return null;
        const x = i % (truth.width + 1);
        const y = Math.floor(i / (truth.width + 1));
        return (
          <line key={`tv${i}`} x1={px(x)} y1={py(y)} x2={px(x)} y2={py(y + 1)} stroke="#8a7b64" strokeWidth={3} opacity={0.35} />
        );
      })}
      {/* your claims, graded */}
      {result.edges.map((v, i) => (
        <line
          key={`e${i}`}
          x1={px(v.x) + (v.kind === 'v' ? 0 : 2)}
          y1={py(v.y) + (v.kind === 'h' ? 0 : 2)}
          x2={v.kind === 'h' ? px(v.x + 1) - 2 : px(v.x)}
          y2={v.kind === 'h' ? py(v.y) : py(v.y + 1) - 2}
          stroke={v.correct ? GOOD : BAD}
          strokeWidth={4}
          strokeLinecap="round"
        />
      ))}
      {result.cells.map((v, i) => (
        <g key={`c${i}`} pointerEvents="none">
          <text
            x={px(v.x) + CS / 2 - 5}
            y={py(v.y) + CS / 2}
            fontSize={13}
            fill="#e2d6bd"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {STAMP_GLYPHS[v.stamp]}
          </text>
          <text
            x={px(v.x) + CS / 2 + 8}
            y={py(v.y) + CS / 2}
            fontSize={12}
            fill={v.correct ? GOOD : BAD}
            textAnchor="middle"
            dominantBaseline="central"
          >
            {v.correct ? '✓' : '✗'}
          </text>
        </g>
      ))}
    </svg>
  );
}
