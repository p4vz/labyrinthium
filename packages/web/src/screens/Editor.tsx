import { useState } from 'react';
import {
  createEdgeGrid,
  setEdge,
  getEdge,
  type Coord,
  type EdgeState,
  type MapDocument,
  type MapIssue,
  type PlanarDirection,
} from '@labyrinthium/shared';
import { TrueMapView } from '../components/TrueMapView.js';
import { send } from '../net/ws.js';
import { useGameStore } from '../state/gameStore.js';

type EditorTool =
  | 'edges'
  | 'entrance'
  | 'treasure'
  | 'monster'
  | 'mine'
  | 'trap'
  | 'river'
  | 'teleport'
  | 'teleport2'
  | 'stairs'
  | 'trapdoor'
  | 'eraseFeature';

function blankLevel(width: number, height: number): MapDocument['levels'][number] {
  const edges = createEdgeGrid(width, height, 'open');
  for (let x = 0; x < width; x++) {
    setEdge(edges, { x, y: 0 }, 'N', 'wall');
    setEdge(edges, { x, y: height - 1 }, 'S', 'wall');
  }
  for (let y = 0; y < height; y++) {
    setEdge(edges, { x: 0, y }, 'W', 'wall');
    setEdge(edges, { x: width - 1, y }, 'E', 'wall');
  }
  return { width, height, edges, features: [] };
}

function blankMap(): MapDocument {
  return {
    version: 1,
    levels: [blankLevel(7, 7)],
    entrance: { level: 0, x: 0, y: 0 },
    spawns: { treasure: { level: 0, x: 6, y: 6 }, monsters: [] },
    metadata: { name: 'my labyrinth' },
  };
}

const EDGE_CYCLE_INTERIOR: EdgeState[] = ['open', 'wall', 'reinforced', 'grate'];
const EDGE_CYCLE_BORDER: EdgeState[] = ['wall', 'exit'];

/**
 * The game master's drafting table: edit a REAL MapDocument, validate it with
 * the same solvability checker the generator uses, save it, play it.
 */
export function Editor(): JSX.Element {
  const setScreen = useGameStore((s) => s.setScreen);
  const connected = useGameStore((s) => s.connected);
  const [doc, setDoc] = useState<MapDocument>(blankMap);
  const [level, setLevel] = useState(0);
  const [tool, setTool] = useState<EditorTool>('edges');
  const [issues, setIssues] = useState<MapIssue[] | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [riverPath, setRiverPath] = useState<Coord[]>([]);
  const [pendingLink, setPendingLink] = useState<{ tool: EditorTool; from: { level: number } & Coord } | null>(null);
  const [hostName, setHostName] = useState('');

  function update(fn: (d: MapDocument) => void): void {
    const next = JSON.parse(JSON.stringify(doc)) as MapDocument;
    fn(next);
    setDoc(next);
    setIssues(null);
    setSavedId(null);
  }

  function clickEdge(x: number, y: number, side: 'N' | 'W'): void {
    if (tool !== 'edges') return;
    update((d) => {
      const lv = d.levels[level]!;
      // Convert the canonical (N/W of cell) reference into cell+direction.
      const cell: Coord = { x, y: side === 'N' ? y : y };
      const dir: PlanarDirection = side === 'N' ? 'N' : 'W';
      const isBorder =
        (side === 'N' && (y === 0 || y === lv.height)) || (side === 'W' && (x === 0 || x === lv.width));
      // Edge clicked below the last row / right of last column belongs to the far cell.
      const target: Coord =
        side === 'N' && y === lv.height ? { x, y: y - 1 } : side === 'W' && x === lv.width ? { x: x - 1, y } : cell;
      const targetDir: PlanarDirection =
        side === 'N' && y === lv.height ? 'S' : side === 'W' && x === lv.width ? 'E' : dir;
      const cycle = isBorder && level === 0 ? EDGE_CYCLE_BORDER : isBorder ? ['wall'] as EdgeState[] : EDGE_CYCLE_INTERIOR;
      const cur = getEdge(lv.edges, target, targetDir);
      const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length] ?? 'wall';
      setEdge(lv.edges, target, targetDir, next);
    });
  }

  function clickCell(x: number, y: number): void {
    const here = { level, x, y };
    switch (tool) {
      case 'entrance':
        update((d) => {
          d.entrance = { level: 0, x, y };
        });
        break;
      case 'treasure':
        update((d) => {
          d.spawns.treasure = here;
        });
        break;
      case 'monster':
        update((d) => {
          const i = d.spawns.monsters.findIndex((m) => m.at.level === level && m.at.x === x && m.at.y === y);
          if (i >= 0) {
            // cycle AI, then remove
            const m = d.spawns.monsters[i]!;
            if (m.ai === 'wanderer') m.ai = 'patroller';
            else if (m.ai === 'patroller') {
              m.ai = 'hunter';
              m.scentRadius = 4;
            } else d.spawns.monsters.splice(i, 1);
          } else {
            d.spawns.monsters.push({ at: here, ai: 'wanderer' });
          }
        });
        break;
      case 'mine':
        update((d) => {
          d.levels[level]!.features.push({ type: 'mine', at: { x, y } });
        });
        break;
      case 'trap':
        update((d) => {
          d.levels[level]!.features.push({ type: 'trap', at: { x, y }, paralysis: 2 });
        });
        break;
      case 'river':
        setRiverPath([...riverPath, { x, y }]);
        break;
      case 'teleport':
      case 'teleport2':
      case 'stairs':
      case 'trapdoor': {
        if (!pendingLink) {
          setPendingLink({ tool, from: here });
          setStatus(
            tool === 'trapdoor'
              ? 'now click the landing cell one level below'
              : 'now click the destination cell (switch level tabs if needed)',
          );
        } else {
          const from = pendingLink.from;
          update((d) => {
            if (pendingLink.tool === 'teleport' || pendingLink.tool === 'teleport2') {
              const mode = pendingLink.tool === 'teleport' ? 'oneWay' : 'twoWay';
              d.levels[from.level]!.features.push({ type: 'teleport', at: { x: from.x, y: from.y }, target: here, mode });
              if (mode === 'twoWay') {
                d.levels[level]!.features.push({ type: 'teleport', at: { x, y }, target: from, mode });
              }
            } else if (pendingLink.tool === 'stairs') {
              d.levels[from.level]!.features.push({ type: 'stairs', at: { x: from.x, y: from.y }, to: here });
              d.levels[level]!.features.push({ type: 'stairs', at: { x, y }, to: from });
            } else {
              d.levels[from.level]!.features.push({ type: 'trapdoor', at: { x: from.x, y: from.y }, to: here });
            }
          });
          setPendingLink(null);
          setStatus('');
        }
        break;
      }
      case 'eraseFeature':
        update((d) => {
          const lv = d.levels[level]!;
          lv.features = lv.features.filter((f) =>
            f.type === 'river' ? !f.cells.some((c) => c.x === x && c.y === y) : !(f.at.x === x && f.at.y === y),
          );
          d.spawns.monsters = d.spawns.monsters.filter(
            (m) => !(m.at.level === level && m.at.x === x && m.at.y === y),
          );
        });
        break;
      case 'edges':
        break;
    }
  }

  function finishRiver(): void {
    if (riverPath.length >= 2) {
      update((d) => {
        d.levels[level]!.features.push({ type: 'river', cells: riverPath });
        // open the channel so the flow is walkable, like the generator does
        for (let i = 0; i < riverPath.length - 1; i++) {
          const a = riverPath[i]!;
          const b = riverPath[i + 1]!;
          const dir: PlanarDirection | null =
            b.x - a.x === 1 ? 'E' : b.x - a.x === -1 ? 'W' : b.y - a.y === 1 ? 'S' : b.y - a.y === -1 ? 'N' : null;
          if (dir) setEdge(d.levels[level]!.edges, a, dir, 'open');
        }
      });
    }
    setRiverPath([]);
  }

  async function validate(): Promise<void> {
    setStatus('validating…');
    const res = await fetch('/api/maps/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    const body = (await res.json()) as { ok?: boolean; issues?: MapIssue[]; error?: string };
    if (body.error) {
      setStatus(`schema error: ${body.error}`);
      setIssues([]);
    } else {
      setIssues(body.issues ?? []);
      setStatus(body.ok ? '✔ solvable — every reachable spot can still reach an exit' : '✘ problems found');
    }
  }

  async function save(): Promise<void> {
    const res = await fetch('/api/maps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    const body = (await res.json()) as { id?: string; error?: string };
    if (body.id) {
      setSavedId(body.id);
      setStatus(`saved — map id ${body.id}`);
    } else {
      setStatus(`save failed: ${body.error}`);
    }
  }

  async function generate(): Promise<void> {
    setStatus('generating…');
    const res = await fetch('/api/maps/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'medium', complexity: 'advanced' }),
    });
    const body = (await res.json()) as { map: MapDocument };
    setDoc(body.map);
    setLevel(0);
    setIssues(null);
    setStatus('generated — now make it yours');
  }

  function play(): void {
    if (!savedId || !hostName) return;
    send({ type: 'room.create', name: hostName, mapId: savedId });
  }

  const lv = doc.levels[level]!;
  const highlight = issues?.filter((i) => i.positions.some((p) => p.level === level)).flatMap((i) => i.positions.filter((p) => p.level === level)) ?? [];

  return (
    <div className="editor">
      <header className="game-header">
        <span className="logo">Labyrinthium — map editor</span>
        <button className="leave" onClick={() => setScreen('home')}>
          home
        </button>
      </header>

      <div className="editor-body">
        <aside className="editor-tools">
          <h3>Tools</h3>
          {(
            [
              ['edges', '▦ edges (click to cycle wall/reinforced/grate; border: wall/exit)'],
              ['entrance', '🏁 entrance'],
              ['treasure', '💰 treasure'],
              ['monster', '👹 monster (click again: AI, then remove)'],
              ['mine', '💣 mine'],
              ['trap', '✖ trap'],
              ['river', '➤ river (click cells along the flow)'],
              ['teleport', '◎ teleport one-way (source, then target)'],
              ['teleport2', '◎◎ teleport two-way pair'],
              ['stairs', '↕ stairs (two levels, mirrored)'],
              ['trapdoor', '⤵ trap door (target one level below)'],
              ['eraseFeature', '⌫ erase feature'],
            ] as [EditorTool, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              className={tool === t ? 'active' : ''}
              onClick={() => {
                setTool(t);
                setPendingLink(null);
                setRiverPath([]);
              }}
            >
              {label}
            </button>
          ))}
          {tool === 'river' && (
            <button className="primary" onClick={finishRiver} disabled={riverPath.length < 2}>
              finish river ({riverPath.length} cells)
            </button>
          )}

          <h3>Levels</h3>
          <div className="level-tabs">
            {doc.levels.map((_, i) => (
              <button key={i} className={i === level ? 'active' : ''} onClick={() => setLevel(i)}>
                {i === 0 ? 'ground' : `-${i}`}
              </button>
            ))}
            <button
              onClick={() =>
                update((d) => {
                  if (d.levels.length < 5) d.levels.push(blankLevel(7, 7));
                })
              }
            >
              +
            </button>
          </div>
          <label>
            name
            <input
              value={doc.metadata.name ?? ''}
              onChange={(e) =>
                update((d) => {
                  d.metadata.name = e.target.value;
                })
              }
            />
          </label>
        </aside>

        <main className="map-col">
          <div className="map-scroll">
            <TrueMapView map={doc} level={level} highlight={highlight} onEdgeClick={clickEdge} onCellClick={clickCell} />
          </div>
          {riverPath.length > 0 && <div className="hint">river so far: {riverPath.map((c) => `(${c.x},${c.y})`).join(' → ')}</div>}
        </main>

        <aside className="editor-actions">
          <h3>Bake & play</h3>
          <button onClick={generate}>🎲 generate a base</button>
          <button data-testid="validate-btn" onClick={validate}>✓ validate</button>
          <button data-testid="save-btn" onClick={save}>💾 save</button>
          <label>
            your name
            <input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="to host a game" />
          </label>
          <button data-testid="play-btn" className="primary" disabled={!savedId || !hostName || !connected} onClick={play}>
            ▶ play this map
          </button>
          <div className="status" data-testid="editor-status">{status}</div>
          {issues && issues.length > 0 && (
            <ul className="issues">
              {issues.map((i, n) => (
                <li key={n}>
                  <b>{i.code}</b> {i.message}
                  {i.positions[0] ? ` @ L${i.positions[0].level} (${i.positions[0].x},${i.positions[0].y})` : ''}
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
