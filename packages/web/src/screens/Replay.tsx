import { useEffect, useMemo, useState } from 'react';
import {
  applyAction,
  createGame,
  describeEvent,
  type GameConfig,
  type GameEvent,
  type GameState,
  type MapDocument,
  type PlayerAction,
} from '@labyrinthium/shared';
import { TrueMapView } from '../components/TrueMapView.js';
import { useGameStore } from '../state/gameStore.js';

interface GameSummary {
  id: string;
  roomCode: string;
  winnerId: string | null;
  turnCount: number;
  players: { id: string; name: string }[];
  finishedAt: string | null;
}

interface GameRecord {
  id: string;
  map: MapDocument;
  seed: string;
  config: GameConfig;
  players: { id: string; name: string }[];
  winnerId: string | null;
  actions: { playerId: string; action: PlayerAction }[];
}

interface Frame {
  state: GameState;
  events: GameEvent[];
}

/**
 * Replays run the REAL engine in the browser: fold the recorded action log
 * with applyAction from the shared package. Determinism makes this exact.
 */
export function Replay(): JSX.Element {
  const setScreen = useGameStore((s) => s.setScreen);
  const [games, setGames] = useState<GameSummary[]>([]);
  const [record, setRecord] = useState<GameRecord | null>(null);
  const [frame, setFrame] = useState(0);
  const [level, setLevel] = useState(0);

  useEffect(() => {
    void fetch('/api/games')
      .then((r) => r.json())
      .then((b: { games: GameSummary[] }) => setGames(b.games));
  }, []);

  const frames = useMemo<Frame[]>(() => {
    if (!record) return [];
    let state = createGame(record.map, record.players, record.config, record.seed);
    const out: Frame[] = [{ state, events: [] }];
    for (const a of record.actions) {
      try {
        const r = applyAction(state, a.action);
        state = r.state;
        out.push({ state, events: r.events });
      } catch {
        break; // corrupted log — show what we can
      }
    }
    return out;
  }, [record]);

  async function load(id: string): Promise<void> {
    const res = await fetch('/api/games/' + id);
    if (res.ok) {
      setRecord((await res.json()) as GameRecord);
      setFrame(0);
      setLevel(0);
    }
  }

  const cur = frames[Math.min(frame, frames.length - 1)];

  return (
    <div className="replay">
      <header className="game-header">
        <span className="logo">Labyrinthium — replay</span>
        <button className="leave" onClick={() => setScreen('home')}>
          home
        </button>
      </header>

      {!record ? (
        <div className="replay-list">
          <h2>Finished games</h2>
          {games.length === 0 && <p>No finished games yet. Go play one!</p>}
          <ul>
            {games.map((g) => (
              <li key={g.id}>
                <button onClick={() => void load(g.id)}>
                  {g.players.map((p) => p.name).join(' vs ')} — room {g.roomCode}, {g.turnCount} turns
                  {g.finishedAt ? ` (${g.finishedAt})` : ''}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        cur && (
          <div className="replay-body">
            <div className="replay-controls">
              <button onClick={() => setFrame(Math.max(0, frame - 1))}>◀</button>
              <input
                type="range"
                min={0}
                max={frames.length - 1}
                value={frame}
                onChange={(e) => setFrame(Number(e.target.value))}
              />
              <button onClick={() => setFrame(Math.min(frames.length - 1, frame + 1))}>▶</button>
              <span>
                move {frame}/{frames.length - 1} · turn {cur.state.turnNumber}
              </span>
              <button onClick={() => setRecord(null)}>choose another game</button>
            </div>
            {record.map.levels.length > 1 && (
              <div className="level-tabs">
                {record.map.levels.map((_, i) => (
                  <button key={i} className={i === level ? 'active' : ''} onClick={() => setLevel(i)}>
                    {i === 0 ? 'ground' : `-${i}`}
                  </button>
                ))}
              </div>
            )}
            <div className="replay-main">
              <TrueMapView
                map={record.map}
                level={level}
                overlay={{
                  players: cur.state.players
                    .filter((p) => !p.exited)
                    .map((p) => ({
                      id: p.id,
                      name: record.players.find((x) => x.id === p.id)?.name ?? '??',
                      pos: p.pos,
                    })),
                  monsters: cur.state.monsters.filter((m) => m.alive).map((m) => m.pos),
                  treasure: cur.state.treasure.carriedBy ? null : cur.state.treasure.pos,
                }}
              />
              <div className="replay-events">
                <h3>this move</h3>
                {cur.events.map((e) => (
                  <div key={e.seq} className={e.visibility.kind === 'public' ? 'feed-public' : 'feed-private'}>
                    {e.visibility.kind === 'private'
                      ? `${record.players.find((p) => p.id === (e.visibility as { playerId: string }).playerId)?.name}: `
                      : ''}
                    {describeEvent(e)}
                  </div>
                ))}
                {cur.state.winnerId && frame === frames.length - 1 && (
                  <div className="feed-public">
                    🏆 {record.players.find((p) => p.id === cur.state.winnerId)?.name} wins
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}
