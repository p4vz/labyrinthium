import { useMapStore } from '../state/mapStore.js';
import { STAMP_GLYPHS } from './MapGrid.js';
import type { Stamp } from '../state/playerMap.js';

const STAMPS: { stamp: Stamp; label: string }[] = [
  { stamp: 'you', label: 'you are here' },
  { stamp: 'teleport', label: 'teleport' },
  { stamp: 'stairs', label: 'stairs' },
  { stamp: 'trapdoor', label: 'trap door' },
  { stamp: 'mine', label: 'mine' },
  { stamp: 'trap', label: 'trap' },
  { stamp: 'monster', label: 'monster' },
  { stamp: 'treasure', label: 'treasure' },
  { stamp: 'exit', label: 'exit' },
  { stamp: 'flag', label: 'marker' },
];

/** Left panel: drawing tools. Click a tool, then click the map. */
export function Palette(): JSX.Element {
  const tool = useMapStore((s) => s.tool);
  const setTool = useMapStore((s) => s.setTool);
  const selection = useMapStore((s) => s.selection);
  const clipboard = useMapStore((s) => s.clipboard);
  const pending = useMapStore((s) => s.pending);
  const store = useMapStore;

  const isStamp = (s: Stamp): boolean => tool.kind === 'stamp' && tool.stamp === s;
  const riverDir = tool.kind === 'stamp' && tool.stamp === 'river' ? tool.riverDir : undefined;

  return (
    <div className="palette">
      <h3>Draw</h3>
      <button className={tool.kind === 'wall' ? 'active' : ''} onClick={() => setTool({ kind: 'wall' })}>
        ▦ walls <small>(click edges)</small>
      </button>
      <button
        className={isStamp('river') ? 'active' : ''}
        onClick={() => setTool({ kind: 'stamp', stamp: 'river', riverDir: riverDir ?? 'E' })}
      >
        <span style={{ color: '#4a90d9' }}>➤</span> river
      </button>
      {isStamp('river') && (
        <div className="river-dirs">
          {(['N', 'E', 'S', 'W'] as const).map((d) => (
            <button
              key={d}
              className={riverDir === d ? 'active' : ''}
              onClick={() => setTool({ kind: 'stamp', stamp: 'river', riverDir: d })}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      {STAMPS.map(({ stamp, label }) => (
        <button
          key={stamp}
          className={isStamp(stamp) ? 'active' : ''}
          onClick={() => setTool({ kind: 'stamp', stamp })}
        >
          {STAMP_GLYPHS[stamp]} {label}
        </button>
      ))}
      <button className={tool.kind === 'note' ? 'active' : ''} onClick={() => setTool({ kind: 'note' })}>
        ✍ note
      </button>
      <button className={tool.kind === 'erase' ? 'active' : ''} onClick={() => setTool({ kind: 'erase' })}>
        ⌫ erase
      </button>

      <h3>Edit</h3>
      <button className={tool.kind === 'select' ? 'active' : ''} onClick={() => setTool({ kind: 'select' })}>
        ▭ select <small>(drag)</small>
      </button>
      <div className="button-row">
        <button disabled={!selection} onClick={() => store.getState().copySelection()} title="copy selection">
          copy
        </button>
        <button disabled={!selection} onClick={() => store.getState().cutSelection()} title="cut selection">
          cut
        </button>
        <button disabled={!clipboard} onClick={() => store.getState().startPaste()} title="paste (click a cell)">
          paste
        </button>
      </div>
      <div className="button-row">
        <button onClick={() => store.getState().undo()}>↶ undo</button>
        <button onClick={() => store.getState().redo()}>↷ redo</button>
      </div>
      {pending && (
        <div className="hint">
          click a cell to stamp it there ·{' '}
          <button onClick={() => store.getState().cancelPending()}>cancel</button>
        </div>
      )}
    </div>
  );
}
