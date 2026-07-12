import { useState } from 'react';
import { useMapStore } from '../state/mapStore.js';

/**
 * Right panel: auxiliary maps. After a teleport or a trapdoor you don't know
 * where you are — start a fresh map, chart the new region, and once you
 * recognize it, merge it onto the main map at the right offset.
 */
export function AuxPanel(): JSX.Element {
  const maps = useMapStore((s) => s.maps);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const store = useMapStore;
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`aux-panel ${expanded ? 'open' : 'closed'}`}>
      <button className="aux-toggle" onClick={() => setExpanded(!expanded)}>
        {expanded ? '▸ maps' : '◂ maps'}
      </button>
      {expanded && (
        <div className="aux-list">
          {maps.map((m) => (
            <div key={m.id} className={`aux-item ${m.id === activeMapId ? 'active' : ''}`}>
              <button className="aux-name" onClick={() => store.getState().setActive(m.id)}>
                {m.name}
              </button>
              {m.id !== 'main' && (
                <span className="aux-actions">
                  <button
                    title="rename"
                    onClick={() => {
                      const name = window.prompt('Map name:', m.name);
                      if (name) store.getState().renameMap(m.id, name);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    title="merge onto main map: pick the offset by clicking a cell there"
                    onClick={() => store.getState().startMerge(m.id)}
                  >
                    ⇱
                  </button>
                  <button
                    title="delete"
                    onClick={() => {
                      if (window.confirm(`Delete ${m.name}?`)) store.getState().removeMap(m.id);
                    }}
                  >
                    🗑
                  </button>
                </span>
              )}
            </div>
          ))}
          <button className="aux-add" onClick={() => store.getState().addAuxMap()}>
            + new auxiliary map
          </button>
          <p className="hint">
            Teleported? Start an aux map, chart the unknown region, then ⇱ merge it onto the main
            map once you've located yourself.
          </p>
        </div>
      )}
    </div>
  );
}
