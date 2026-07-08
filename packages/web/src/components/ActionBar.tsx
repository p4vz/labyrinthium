import { useEffect, useState } from 'react';
import { send } from '../net/ws.js';
import { actionFor, useGameStore } from '../state/gameStore.js';

/** Bottom bar: how you talk to the labyrinth. One action per turn. */
export function ActionBar(): JSX.Element {
  const started = useGameStore((s) => s.started);
  const activePlayerId = useGameStore((s) => s.activePlayerId);
  const turnNumber = useGameStore((s) => s.turnNumber);
  const turnDeadline = useGameStore((s) => s.turnDeadline);
  const canAct = useGameStore((s) => s.canAct);
  const treasureUnderfoot = useGameStore((s) => s.treasureUnderfoot);
  const finished = useGameStore((s) => s.finished);
  const spectating = useGameStore((s) => s.spectating);
  const paused = useGameStore((s) => s.paused);
  const mode = useGameStore((s) => s.actionMode);
  const setMode = useGameStore((s) => s.setActionMode);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!turnDeadline) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [turnDeadline]);

  // The one action is spent: fall back to walking so taps stay safe.
  useEffect(() => {
    if (!canAct && mode !== 'walk') setMode('walk');
  }, [canAct, mode, setMode]);
  const secondsLeft = turnDeadline ? Math.max(0, Math.ceil((turnDeadline - now) / 1000)) : null;

  const myTurn =
    !spectating && !finished && !paused && started !== null && activePlayerId === started.yourPlayerId;
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
          : paused
            ? '⏸ game paused by the observer'
            : spectating
              ? `watching — ${activeName}'s turn (t${turnNumber})`
              : myTurn
                ? `YOUR TURN (t${turnNumber})`
                : `${activeName}'s turn (t${turnNumber})`}
        {secondsLeft !== null && !finished && (
          <span className={`turn-clock ${secondsLeft <= 5 ? 'urgent' : ''}`}> ⏱ {secondsLeft}s</span>
        )}
      </div>

      <div className="modes">
        <button className={mode === 'walk' ? 'active' : ''} onClick={() => setMode('walk')}>
          🚶 walk
        </button>
        <button
          className={mode === 'shoot' ? 'active' : ''}
          disabled={!canAct && myTurn}
          onClick={() => setMode('shoot')}
          title="shooting is your one action this turn"
        >
          🔫 shoot
        </button>
        <button
          className={mode === 'grenade' ? 'active' : ''}
          disabled={!canAct && myTurn}
          onClick={() => setMode('grenade')}
          title="a bomb is your one action this turn"
        >
          💥 grenade
        </button>
        <button
          disabled={!myTurn || !canAct}
          onClick={() => send({ type: 'game.action', action: { type: 'placeMine' } })}
          title="arming a mine is your one action this turn"
        >
          💣 place mine
        </button>
        <button
          data-testid="pickup-btn"
          className={treasureUnderfoot && myTurn && canAct ? 'glow' : ''}
          disabled={!myTurn || !canAct}
          onClick={() => send({ type: 'game.action', action: { type: 'pickup' } })}
          title="lift the treasure at your feet (your one action this turn)"
        >
          🫳 pick up{treasureUnderfoot ? ' 💰' : ''}
        </button>
        <button
          data-testid="endturn-btn"
          disabled={!myTurn}
          onClick={() => send({ type: 'game.action', action: { type: 'endTurn' } })}
          title="pass without moving"
        >
          ⏭ end turn
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
