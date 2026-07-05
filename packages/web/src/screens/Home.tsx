import { useState } from 'react';
import { send } from '../net/ws.js';
import { useGameStore } from '../state/gameStore.js';

export function Home(): JSX.Element {
  const connected = useGameStore((s) => s.connected);
  const setScreen = useGameStore((s) => s.setScreen);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [preset, setPreset] = useState<'small' | 'medium' | 'large'>('medium');
  const [complexity, setComplexity] = useState<'classic' | 'advanced' | 'full'>('classic');
  const [seed, setSeed] = useState('');
  const [mapId, setMapId] = useState('');

  return (
    <div className="home">
      <h1>Labyrinthium</h1>
      <p className="tagline">
        The computer draws a maze it will never show you. Move blind, listen to what it says, and
        draw your own map. First one out with the treasure wins.
      </p>
      <div className={`conn-dot ${connected ? 'up' : 'down'}`}>{connected ? 'connected' : 'connecting…'}</div>

      <label>
        Your name
        <input data-testid="name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ariadne" maxLength={40} />
      </label>

      <div className="home-cards">
        <div className="card">
          <h2>Create a game</h2>
          <label>
            Size
            <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}>
              <option value="small">small (3–5)</option>
              <option value="medium">medium (6–9)</option>
              <option value="large">large (10–15)</option>
            </select>
          </label>
          <label>
            Complexity
            <select value={complexity} onChange={(e) => setComplexity(e.target.value as typeof complexity)}>
              <option value="classic">classic — the original game</option>
              <option value="advanced">advanced — layers, mines, traps</option>
              <option value="full">full — everything, dialed up</option>
            </select>
          </label>
          <label>
            Seed <small>(optional — same seed, same maze)</small>
            <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="random" />
          </label>
          <label>
            Map id <small>(optional — play a saved editor map)</small>
            <input data-testid="mapid-input" value={mapId} onChange={(e) => setMapId(e.target.value)} placeholder="from the editor" />
          </label>
          <button
            data-testid="create-btn"
            disabled={!connected || !name}
            onClick={() =>
              send({
                type: 'room.create',
                name,
                preset,
                complexity,
                ...(seed ? { seed } : {}),
                ...(mapId ? { mapId } : {}),
              })
            }
          >
            Create room
          </button>
        </div>

        <div className="card">
          <h2>Join a game</h2>
          <label>
            Room code
            <input data-testid="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AB12CD" maxLength={8} />
          </label>
          <button data-testid="join-btn" disabled={!connected || !name || code.length < 4} onClick={() => send({ type: 'room.join', roomCode: code, name })}>
            Join room
          </button>
          <button
            disabled={!connected || code.length < 4}
            onClick={() => {
              send({ type: 'room.spectate', roomCode: code });
              setScreen('game');
            }}
          >
            Watch as spectator
          </button>
        </div>

        <div className="card">
          <h2>Workshop</h2>
          <button onClick={() => setScreen('editor')}>Map editor</button>
          <button onClick={() => setScreen('replay')}>Replay a finished game</button>
        </div>
      </div>
    </div>
  );
}
