import { send } from '../net/ws.js';
import { useGameStore } from '../state/gameStore.js';

export function Lobby(): JSX.Element {
  const room = useGameStore((s) => s.room);
  const session = useGameStore((s) => s.session);
  const reset = useGameStore((s) => s.reset);
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
        <ul data-testid="player-list">
          {room.players.map((p) => (
            <li key={p.id}>
              {p.name}
              {p.id === room.hostId ? ' 👑' : ''}
              {p.connected ? '' : ' (away)'}
            </li>
          ))}
        </ul>
      </div>
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
