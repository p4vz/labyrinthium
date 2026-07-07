import { useEffect, useState } from 'react';
import { describeEvent } from '@labyrinthium/shared';
import { ActionBar } from '../components/ActionBar.js';
import { AuxPanel } from '../components/AuxPanel.js';
import { EventFeed } from '../components/EventFeed.js';
import { MapGrid } from '../components/MapGrid.js';
import { Palette } from '../components/Palette.js';
import { TrueMapView } from '../components/TrueMapView.js';
import { useGameStore } from '../state/gameStore.js';
import { useMapStore } from '../state/mapStore.js';

export function Game(): JSX.Element {
  const room = useGameStore((s) => s.room);
  const finished = useGameStore((s) => s.finished);
  const spectating = useGameStore((s) => s.spectating);
  const reset = useGameStore((s) => s.reset);
  const feed = useGameStore((s) => s.feed);
  const paletteWide = useMapStore((s) => s.paletteWide);
  /** which side panel is open on small screens */
  const [drawer, setDrawer] = useState<'draw' | 'maps' | null>(null);

  const maps = useMapStore((s) => s.maps);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const activeGrid = useMapStore((s) => s.activeGrid);
  const tool = useMapStore((s) => s.tool);
  const selection = useMapStore((s) => s.selection);
  const pending = useMapStore((s) => s.pending);
  const mapStore = useMapStore;

  const activeMap = maps.find((m) => m.id === activeMapId) ?? maps[0];
  const grid = activeMap?.grids[Math.min(activeGrid, (activeMap?.grids.length ?? 1) - 1)];

  // Keyboard shortcuts for the standard editing verbs.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const s = mapStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        s.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        s.copySelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
        s.cutSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        s.startPaste();
      } else if (e.key === 'Escape') {
        s.cancelPending();
        s.clearSelection();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mapStore]);

  return (
    <div className="game-screen">
      <header className="game-header">
        <span className="logo">Labyrinthium</span>
        <span data-testid="room-tag">room {room?.roomCode}</span>
        {spectating && <span className="spectator-tag">👁 spectating</span>}
        <button
          className={`mobile-only drawer-btn ${drawer === 'draw' ? 'active' : ''}`}
          onClick={() => setDrawer(drawer === 'draw' ? null : 'draw')}
        >
          ✏️
        </button>
        <button
          className={`mobile-only drawer-btn ${drawer === 'maps' ? 'active' : ''}`}
          onClick={() => setDrawer(drawer === 'maps' ? null : 'maps')}
        >
          🗺️
        </button>
        <button className="leave" onClick={reset}>
          leave
        </button>
      </header>

      <div className="game-body">
        {drawer && <div className="drawer-backdrop mobile-only" onClick={() => setDrawer(null)} />}
        <aside className={`left-col ${drawer === 'draw' ? 'mobile-open' : ''}`}>
          {!spectating && <Palette />}
          {/* With the rail collapsed, the feed yields to the ticker below. */}
          {(spectating || paletteWide || drawer === 'draw') && <EventFeed />}
        </aside>

        <main className="map-col">
          {activeMap && activeMap.grids.length > 1 && (
            <div className="level-tabs">
              {activeMap.grids.map((_, i) => (
                <button
                  key={i}
                  className={i === activeGrid ? 'active' : ''}
                  onClick={() => mapStore.getState().setActive(activeMap.id, i)}
                >
                  {i === 0 ? 'ground' : `level -${i}`}
                </button>
              ))}
            </div>
          )}
          {activeMap && activeMap.id !== 'main' && (
            <div className="aux-banner">
              drawing on <b>{activeMap.name}</b> — an uncharted region
            </div>
          )}
          {grid && (
            <div className="map-scroll">
              <MapGrid
                grid={grid}
                interactive={!spectating}
                selection={selection && selection.mapId === activeMapId && selection.grid === activeGrid ? selection.rect : null}
                pending={pending}
                selectMode={tool.kind === 'select'}
                onEdgeClick={(x, y, side) => mapStore.getState().clickEdge(x, y, side)}
                onCellClick={(x, y) => mapStore.getState().clickCell(x, y)}
                onDragSelect={(rect) => mapStore.getState().dragSelect(rect)}
              />
            </div>
          )}
        </main>

        <div className={`aux-wrap ${drawer === 'maps' ? 'mobile-open' : ''}`}>
          <AuxPanel />
        </div>
      </div>

      {feed.length > 0 && (
        <button
          className={`event-ticker ${!paletteWide && !spectating ? 'always' : ''}`}
          onClick={() => {
            useMapStore.getState().setPaletteWide(true);
            setDrawer('draw');
          }}
        >
          {(() => {
            const last = feed[feed.length - 1]!;
            return `${last.ownerName ? `${last.ownerName} ▸ ` : ''}${describeEvent(last.event)}`;
          })()}
        </button>
      )}

      <ActionBar />
      <Errors />

      {finished && (
        <div className="modal-backdrop" data-testid="reveal">
          <div className="modal">
            <h1>🏆 {finished.winnerName} wins!</h1>
            <p>
              Escaped with the treasure on turn {finished.turnNumber}. Here is the labyrinth as it
              really was:
            </p>
            <div className="reveal-maps">
              {finished.mapReveal.levels.map((_, i) => (
                <div key={i}>
                  <h3>{i === 0 ? 'ground level' : `level -${i}`}</h3>
                  <TrueMapView map={finished.mapReveal} level={i} />
                </div>
              ))}
            </div>
            <button className="primary" onClick={reset}>
              back to the surface
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Errors(): JSX.Element {
  const errors = useGameStore((s) => s.errors);
  const dismiss = useGameStore((s) => s.dismissError);
  return (
    <div className="toasts">
      {errors.map((e, i) => (
        <div key={`${i}${e}`} className="toast" onClick={() => dismiss(i)}>
          {e}
        </div>
      ))}
    </div>
  );
}
