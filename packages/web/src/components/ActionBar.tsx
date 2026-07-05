import { send } from '../net/ws.js';
import { actionFor, useGameStore } from '../state/gameStore.js';

/** Bottom bar: how you talk to the labyrinth. One action per turn. */
export function ActionBar(): JSX.Element {
  const started = useGameStore((s) => s.started);
  const activePlayerId = useGameStore((s) => s.activePlayerId);
  const turnNumber = useGameStore((s) => s.turnNumber);
  const finished = useGameStore((s) => s.finished);
  const spectating = useGameStore((s) => s.spectating);
  const mode = useGameStore((s) => s.actionMode);
  const setMode = useGameStore((s) => s.setActionMode);

  const myTurn = !spectating && !finished && started !== null && activePlayerId === started.yourPlayerId;
  const activeName =
    started?.turnOrder.find((p) => p.id === activePlayerId)?.name ?? '…';

  function act(direction: 'N' | 'E' | 'S' | 'W' | 'U' | 'D'): void {
    const action = actionFor(mode, direction);
    if (action) send({ type: 'game.action', action });
  }

  return (
    <div className="action-bar" data-testid="action-bar">
      <div className={`turn-indicator ${myTurn ? 'my-turn' : ''}`} data-testid="turn-indicator">
        {finished
          ? 'game over'
          : spectating
            ? `watching — ${activeName}'s turn (t${turnNumber})`
            : myTurn
              ? `YOUR TURN (t${turnNumber})`
              : `${activeName}'s turn (t${turnNumber})`}
      </div>

      <div className="modes">
        <button className={mode === 'walk' ? 'active' : ''} onClick={() => setMode('walk')}>
          🚶 walk
        </button>
        <button className={mode === 'shoot' ? 'active' : ''} onClick={() => setMode('shoot')}>
          🔫 shoot
        </button>
        <button className={mode === 'grenade' ? 'active' : ''} onClick={() => setMode('grenade')}>
          💥 grenade
        </button>
        <button
          disabled={!myTurn}
          onClick={() => send({ type: 'game.action', action: { type: 'placeMine' } })}
        >
          💣 place mine
        </button>
      </div>

      <div className="dpad">
        <button disabled={!myTurn} data-testid="go-N" className="dp-n" onClick={() => act('N')}>▲</button>
        <button disabled={!myTurn} data-testid="go-W" className="dp-w" onClick={() => act('W')}>◀</button>
        <button disabled={!myTurn} data-testid="go-E" className="dp-e" onClick={() => act('E')}>▶</button>
        <button disabled={!myTurn} data-testid="go-S" className="dp-s" onClick={() => act('S')}>▼</button>
        <button disabled={!myTurn || mode !== 'walk'} className="dp-u" onClick={() => act('U')} title="take stairs up">⤒</button>
        <button disabled={!myTurn || mode !== 'walk'} className="dp-d" onClick={() => act('D')} title="take stairs down">⤓</button>
      </div>

      {started && !spectating && (
        <div className="inventory" data-testid="inventory">
          💥×{started.inventory.grenades} · 🔫×{started.inventory.bullets} · 💣×{started.inventory.mines}
          <small> (starting kit)</small>
        </div>
      )}
    </div>
  );
}
