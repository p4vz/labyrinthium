import { PixelAvatar } from '../components/PixelAvatar.js';
import { send } from '../net/ws.js';
import { useGameStore } from '../state/gameStore.js';

export function Lobby(): JSX.Element {
  const room = useGameStore((s) => s.room);
  const session = useGameStore((s) => s.session);
  const reset = useGameStore((s) => s.reset);
  const setInspect = useGameStore((s) => s.setInspect);
  if (!room) return <div className="lobby">joining…</div>;
  const isHost = session?.playerId === room.hostId;

  return (
    <div className="lobby">
      <h1>Room</h1>
      <div className="room-code" data-testid="room-code">{room.roomCode}</div>
      <p>Share this code. Friends join from their own devices — nobody sees anybody's map.</p>
      <div className="card">
        <h2>
          Map: {room.mapMeta.name ?? 'secret'}
          {room.mapMeta.difficulty ? ` · difficulty ${room.mapMeta.difficulty}/10` : ''}
          {` · ${room.mapMeta.levelCount} level${room.mapMeta.levelCount > 1 ? 's' : ''}`}
        </h2>
        <ul data-testid="player-list" className="player-list">
          {room.players.map((p) => (
            <li key={p.id}>
              {/* the lobby is the runway: everyone's avatar on parade —
                  click a player to see their character full size */}
              {p.isBot ? (
                <span className="lobby-avatar bot">🤖</span>
              ) : (
                <button
                  className="lobby-avatar as-button"
                  data-testid={`inspect-${p.name}`}
                  title={`view ${p.name}'s character`}
                  onClick={() =>
                    setInspect({
                      name: p.name,
                      avatar: p.avatar ?? null,
                      own: p.id === session?.playerId,
                    })
                  }
                >
                  <PixelAvatar avatar={p.avatar ?? null} size={28} title={`${p.name}'s avatar`} />
                </button>
              )}
              {p.name}
              {p.id === room.hostId ? ' 👑' : ''}
              {p.connected ? '' : ' (away)'}
            </li>
          ))}
        </ul>
      </div>
      {isHost && (
        <div className="bot-row" data-testid="bot-row">
          add an AI player:
          <button onClick={() => send({ type: 'room.addBot', difficulty: 'easy' })}>🤖 easy</button>
          <button onClick={() => send({ type: 'room.addBot', difficulty: 'medium' })}>🤖 medium</button>
          <button onClick={() => send({ type: 'room.addBot', difficulty: 'hard' })}>🤖 hard</button>
        </div>
      )}
      {isHost ? (
        <button data-testid="start-btn" className="primary" onClick={() => send({ type: 'room.start' })}>
          Start the descent
        </button>
      ) : (
        <p>waiting for the host to start…</p>
      )}
      <button onClick={reset}>leave</button>
    </div>
  );
}
