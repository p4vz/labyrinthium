import { useEffect, useState } from 'react';
import { describeEvent } from '@labyrinthium/shared';
import { ActionBar } from '../components/ActionBar.js';
import { AuxPanel } from '../components/AuxPanel.js';
import { CompareView, compareLevel } from '../components/CompareView.js';
import { EventFeed } from '../components/EventFeed.js';
import { MapGrid } from '../components/MapGrid.js';
import { Palette } from '../components/Palette.js';
import { TrueMapView } from '../components/TrueMapView.js';
import { send } from '../net/ws.js';
import { useGameStore } from '../state/gameStore.js';
import { useMapStore } from '../state/mapStore.js';
import type { PlayerMap } from '../state/playerMap.js';

export function Game(): JSX.Element {
  const room = useGameStore((s) => s.room);
  const finished = useGameStore((s) => s.finished);
  const spectating = useGameStore((s) => s.spectating);
  const session = useGameStore((s) => s.session);
  const reset = useGameStore((s) => s.reset);
  const feed = useGameStore((s) => s.feed);
  const paletteWide = useMapStore((s) => s.paletteWide);
  /** aux-maps drawer on small screens; the tool rail stays inline */
  const [mapsOpen, setMapsOpen] = useState(false);
  /** full game-master log as a bottom sheet (opened from the ticker) */
  const [logOpen, setLogOpen] = useState(false);
  /** end-of-game reckoning: grade my map against the truth */
  const [comparing, setComparing] = useState(false);
  const [compareLevelIdx, setCompareLevelIdx] = useState(0);

  const maps = useMapStore((s) => s.maps);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const activeGrid = useMapStore((s) => s.activeGrid);
  const tool = useMapStore((s) => s.tool);
  const selection = useMapStore((s) => s.selection);
  const pending = useMapStore((s) => s.pending);
  const mapStore = useMapStore;

  const activeMap = maps.find((m) => m.id === activeMapId) ?? maps[0];
  const grid = activeMap?.grids[Math.min(activeGrid, (activeMap?.grids.length ?? 1) - 1)];

  // Share the hand-drawn maps with any observers, throttled.
  useEffect(() => {
    if (spectating || !session) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useMapStore.subscribe((s, prev) => {
      if (s.maps === prev.maps) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        send({ type: 'maps.sync', maps: useMapStore.getState().maps });
      }, 1200);
    });
    // an initial snapshot so observers see the entrance markings right away
    send({ type: 'maps.sync', maps: useMapStore.getState().maps });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [spectating, session]);

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
          className={`mobile-only drawer-btn ${mapsOpen ? 'active' : ''}`}
          onClick={() => setMapsOpen(!mapsOpen)}
        >
          🗺️
        </button>
        <button className="leave" onClick={reset}>
          leave
        </button>
      </header>

      <div className="game-body">
        {mapsOpen && <div className="drawer-backdrop mobile-only" onClick={() => setMapsOpen(false)} />}
        <aside className="left-col">
          {!spectating && <Palette />}
          {/* With the rail collapsed, the feed yields to the ticker below. */}
          {(spectating || paletteWide) && <EventFeed />}
        </aside>

        <main className="map-col">
          {spectating && <ObserverPanel />}
          {!spectating && activeMap && activeMap.grids.length > 1 && (
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
          {!spectating && activeMap && activeMap.id !== 'main' && (
            <div className="aux-banner">
              drawing on <b>{activeMap.name}</b> — an uncharted region
            </div>
          )}
          {!spectating && grid && (
            <div className="map-scroll">
              <MapGrid
                grid={grid}
                interactive={!spectating}
                selection={selection && selection.mapId === activeMapId && selection.grid === activeGrid ? selection.rect : null}
                pending={pending}
                selectMode={tool.kind === 'select'}
                paintMode={
                  tool.kind === 'wall'
                    ? 'wall'
                    : tool.kind === 'stamp' && tool.stamp === 'river'
                      ? 'river'
                      : null
                }
                onEdgeClick={(x, y, side) => mapStore.getState().clickEdge(x, y, side)}
                onCellClick={(x, y) => mapStore.getState().clickCell(x, y)}
                onDragSelect={(rect) => mapStore.getState().dragSelect(rect)}
                onPaintWalls={(edges) => mapStore.getState().paintWalls(edges)}
                onPaintRiver={(cells) => mapStore.getState().paintRiver(cells)}
              />
            </div>
          )}
        </main>

        <div className={`aux-wrap ${mapsOpen ? 'mobile-open' : ''}`}>
          <AuxPanel />
        </div>
      </div>

      {feed.length > 0 && !logOpen && (
        <button
          className={`event-ticker ${!paletteWide && !spectating ? 'always' : ''}`}
          data-testid="event-ticker"
          title="tap to swap the controls for the full log"
          onClick={() => setLogOpen(true)}
        >
          {feed.slice(-4).map((entry) => (
            <span key={entry.seq} className="ticker-line">
              {entry.ownerName ? `${entry.ownerName} ▸ ` : ''}
              {describeEvent(entry.event)}
            </span>
          ))}
        </button>
      )}

      {/* The full log docks where the controls were — the map and the
          drawing toolbar stay visible, so you can chart while you read. */}
      {logOpen ? (
        <div className="log-dock" data-testid="log-sheet">
          <button className="log-close" onClick={() => setLogOpen(false)}>
            ▾ back to controls
          </button>
          <EventFeed />
        </div>
      ) : (
        <ActionBar />
      )}

      {finished && (
        <div className="modal-backdrop" data-testid="reveal">
          <div className="modal">
            {finished.winnerId ? (
              <>
                <h1>🏆 {finished.winnerName} wins!</h1>
                <p>
                  Escaped with the treasure on turn {finished.turnNumber}.{' '}
                  {comparing ? 'Your map, graded against the truth:' : 'Here is the labyrinth as it really was:'}
                </p>
              </>
            ) : (
              <>
                <h1>🚪 everyone fled</h1>
                <p>
                  The labyrinth keeps its treasure (turn {finished.turnNumber}).{' '}
                  {comparing ? 'Your map, graded against the truth:' : 'Here is the labyrinth as it really was:'}
                </p>
              </>
            )}
            {!comparing && <LootSummary />}
            {!comparing ? (
              <div className="reveal-maps">
                {finished.mapReveal.levels.map((_, i) => (
                  <div key={i}>
                    <h3>{i === 0 ? 'ground level' : `level -${i}`}</h3>
                    <TrueMapView map={finished.mapReveal} level={i} />
                  </div>
                ))}
              </div>
            ) : (
              <CompareSection
                mapReveal={finished.mapReveal}
                level={compareLevelIdx}
                setLevel={setCompareLevelIdx}
              />
            )}
            <div className="button-row modal-actions">
              {!spectating && maps.length > 0 && (
                <button data-testid="compare-btn" onClick={() => setComparing(!comparing)}>
                  {comparing ? '🗺 show the true map' : '📝 how good was my map?'}
                </button>
              )}
              <button className="primary" onClick={reset}>
                back to the surface
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** What everyone walked away with (or lost in the dark). */
function LootSummary(): JSX.Element | null {
  const finished = useGameStore((s) => s.finished);
  const started = useGameStore((s) => s.started);
  const setInspect = useGameStore((s) => s.setInspect);
  if (!finished || finished.lootSummary.every((p) => p.bankedItems.length === 0 && p.coins === 0)) {
    return null;
  }
  return (
    <div className="loot-summary" data-testid="loot-summary">
      <h3>The haul</h3>
      {finished.lootSummary.map((p) => (
        <div key={p.playerId} className="loot-row">
          <button
            className="loot-name as-link"
            title={`view ${p.name}'s character and haul`}
            onClick={() =>
              setInspect({
                name: p.name,
                avatar: started?.turnOrder.find((t) => t.id === p.playerId)?.avatar ?? null,
                haul: p.bankedItems,
                own: p.playerId === started?.yourPlayerId,
              })
            }
          >
            {p.name}
            {p.left ? ' 🚪' : ''}
          </button>
          <span className="loot-detail">
            {p.coins > 0 && <span>🪙 {p.coins}</span>}
            {p.bankedItems.map((item) => (
              <span key={item.id} className={`loot-item rarity-${item.rarity}`} title={`${item.name} (${item.rarity})`}>
                {item.name}
              </span>
            ))}
            {p.coins === 0 && p.bankedItems.length === 0 && <span className="muted">—</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** End-of-game reckoning: every claim on your map graded green/red. */
function CompareSection(props: {
  mapReveal: NonNullable<ReturnType<typeof useGameStore.getState>['finished']>['mapReveal'];
  level: number;
  setLevel(i: number): void;
}): JSX.Element {
  const maps = useMapStore((s) => s.maps);
  const main = maps.find((m) => m.id === 'main');
  if (!main) return <p>no map to grade</p>;
  const totals = props.mapReveal.levels.reduce(
    (acc, _, i) => {
      const belief = main.grids[i];
      if (!belief) return acc;
      const r = compareLevel(props.mapReveal, i, belief);
      return { correct: acc.correct + r.correct, wrong: acc.wrong + r.wrong };
    },
    { correct: 0, wrong: 0 },
  );
  const total = totals.correct + totals.wrong;
  const belief = main.grids[props.level];
  return (
    <div className="compare-section" data-testid="compare-section">
      <p className="compare-score">
        {total === 0
          ? 'you never marked anything — a purist!'
          : `${totals.correct} right · ${totals.wrong} wrong — ${Math.round((totals.correct / total) * 100)}% of your claims were true`}
      </p>
      {props.mapReveal.levels.length > 1 && (
        <div className="level-tabs">
          {props.mapReveal.levels.map((_, i) => (
            <button key={i} className={i === props.level ? 'active' : ''} onClick={() => props.setLevel(i)}>
              {i === 0 ? 'ground' : `-${i}`}
            </button>
          ))}
        </div>
      )}
      {belief ? (
        <CompareView map={props.mapReveal} level={props.level} belief={belief} />
      ) : (
        <p>you never charted this level</p>
      )}
      <p className="hint">
        faint lines = the real walls · <span style={{ color: '#7dc981' }}>green</span> = you were right ·{' '}
        <span style={{ color: '#e05b50' }}>red</span> = the labyrinth fooled you
      </p>
    </div>
  );
}

/** Observer mode: the unlocked truth with live pieces, and each player's
 * own hand-drawn maps — main AND auxiliary — one click away. */
function ObserverPanel(): JSX.Element {
  const spectate = useGameStore((s) => s.spectate);
  const started = useGameStore((s) => s.started);
  const setView = useGameStore((s) => s.setSpectateView);
  const paused = useGameStore((s) => s.paused);
  const finished = useGameStore((s) => s.finished);
  const [level, setLevel] = useState(0);
  /** which of the viewed player's maps (main / aux) is open */
  const [mapSel, setMapSel] = useState('main');

  // Switching players resets to their main map.
  useEffect(() => {
    setMapSel('main');
  }, [spectate.view]);

  const avatarOf = (id: string) => started?.turnOrder.find((p) => p.id === id)?.avatar;

  if (!spectate.trueMap) return <p className="hint">waiting for the game to start…</p>;
  const players = spectate.live?.players ?? [];
  const viewing = spectate.view !== 'true' ? spectate.beliefMaps[spectate.view] : undefined;
  const beliefMaps = viewing ? (viewing.maps as PlayerMap[]) : null;
  const beliefMap =
    beliefMaps?.find?.((m) => m.id === mapSel) ??
    beliefMaps?.find?.((m) => m.id === 'main') ??
    beliefMaps?.[0];

  return (
    <div className="observer" data-testid="observer">
      <div className="level-tabs observer-tabs">
        <button className={spectate.view === 'true' ? 'active' : ''} onClick={() => setView('true')}>
          👁 true map
        </button>
        {players.map((p) => (
          <button
            key={p.id}
            className={spectate.view === p.id ? 'active' : ''}
            onClick={() => setView(p.id)}
            title={`${p.name}'s own map`}
          >
            🗒 {p.name}
          </button>
        ))}
        {!finished && (
          <button
            className={`pause-btn ${paused ? 'active' : ''}`}
            data-testid="pause-btn"
            onClick={() => send({ type: 'room.pause', paused: !paused })}
            title={paused ? 'let the game continue' : 'freeze the game to study the maps'}
          >
            {paused ? '▶ resume' : '⏸ pause'}
          </button>
        )}
      </div>
      {paused && (
        <div className="aux-banner" data-testid="paused-banner">
          ⏸ game paused — nobody can move until you resume
        </div>
      )}
      {beliefMaps && beliefMaps.length > 1 && (
        <div className="level-tabs" data-testid="observer-map-tabs">
          {beliefMaps.map((m) => (
            <button
              key={m.id}
              className={m.id === (beliefMap?.id ?? 'main') ? 'active' : ''}
              onClick={() => setMapSel(m.id)}
            >
              {m.id === 'main' ? '🗺 main' : `📄 ${m.name}`}
            </button>
          ))}
        </div>
      )}
      {(spectate.view === 'true' ? spectate.trueMap.levels.length > 1 : (beliefMap?.grids.length ?? 0) > 1) && (
        <div className="level-tabs">
          {(spectate.view === 'true' ? spectate.trueMap.levels : beliefMap!.grids).map((_, i) => (
            <button key={i} className={i === level ? 'active' : ''} onClick={() => setLevel(i)}>
              {i === 0 ? 'ground' : `-${i}`}
            </button>
          ))}
        </div>
      )}
      {spectate.view === 'true' ? (
        <div className="map-scroll">
          <TrueMapView
            map={spectate.trueMap}
            level={Math.min(level, spectate.trueMap.levels.length - 1)}
            overlay={
              spectate.live
                ? {
                    players: spectate.live.players
                      .filter((p) => !p.exited)
                      .map((p) => {
                        const avatar = avatarOf(p.id);
                        return {
                          id: p.id,
                          name: p.name,
                          pos: p.pos,
                          ...(avatar ? { avatar } : {}),
                        };
                      }),
                    monsters: spectate.live.monsters,
                    treasure: spectate.live.treasure.carriedBy ? null : spectate.live.treasure.pos,
                  }
                : undefined
            }
          />
        </div>
      ) : beliefMap?.grids ? (
        <div className="map-scroll">
          <MapGrid grid={beliefMap.grids[Math.min(level, beliefMap.grids.length - 1)]!} />
          <p className="hint">
            {viewing?.playerName}'s beliefs, live — walls they've charted, marks they've guessed.
          </p>
        </div>
      ) : (
        <p className="hint">{viewing?.playerName ?? 'this player'} hasn't drawn anything yet.</p>
      )}
    </div>
  );
}

