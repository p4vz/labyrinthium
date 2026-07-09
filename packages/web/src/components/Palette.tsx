import { useRef, useState } from 'react';
import { useGameStore } from '../state/gameStore.js';
import { useMapStore } from '../state/mapStore.js';
import { STAMP_GLYPHS } from './MapGrid.js';
import { PIECE_STAMPS, type Stamp } from '../state/playerMap.js';

const STAMPS: { stamp: Stamp; label: string }[] = [
  { stamp: 'you', label: 'you are here' },
  { stamp: 'empty', label: 'nothing here' },
  { stamp: 'entrance', label: 'entrance' },
  { stamp: 'teleport', label: 'teleport' },
  { stamp: 'tpExit', label: 'teleport exit' },
  { stamp: 'stairs', label: 'stairs' },
  { stamp: 'trapdoor', label: 'trap door' },
  { stamp: 'mine', label: 'mine' },
  { stamp: 'trap', label: 'trap' },
  { stamp: 'monster', label: 'monster' },
  { stamp: 'treasure', label: 'treasure' },
  { stamp: 'exit', label: 'exit' },
  { stamp: 'flag', label: 'marker' },
];

const NARROW = 54;
const WIDE = 205;
const SNAP = 120; // release wider than this -> names shown

/**
 * Left rail of drawing tools. A single glyph wide by default on desktop —
 * drag its right edge out to reveal the tool names, drag it back in to
 * collapse to icons only (double-click the edge toggles too).
 */
export function Palette(): JSX.Element {
  const tool = useMapStore((s) => s.tool);
  const setTool = useMapStore((s) => s.setTool);
  const selection = useMapStore((s) => s.selection);
  const clipboard = useMapStore((s) => s.clipboard);
  const pending = useMapStore((s) => s.pending);
  const wide = useMapStore((s) => s.paletteWide);
  const started = useGameStore((s) => s.started);
  const store = useMapStore;

  /** Is this element kind even in the current maze? (Outside a game —
   * editor, replays — everything is available.) */
  function inGame(stamp: Stamp): boolean {
    const present = started?.featuresPresent;
    if (!present) return true;
    switch (stamp) {
      case 'river':
        return present.includes('river');
      case 'teleport':
      case 'tpExit':
        return present.includes('teleport');
      case 'stairs':
        return present.includes('stairs');
      case 'trapdoor':
        return present.includes('trapdoor');
      case 'mine':
        // baked mines OR someone can still arm their own
        return present.includes('mine') || started!.inventory.mines > 0;
      case 'trap':
        return present.includes('trap');
      case 'monster':
        return present.includes('monster');
      default:
        return true;
    }
  }

  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragFrom = useRef<{ x: number; width: number } | null>(null);

  const width = dragWidth ?? (wide ? WIDE : NARROW);
  const showLabels = width >= SNAP;

  const isStamp = (s: Stamp): boolean => tool.kind === 'stamp' && tool.stamp === s;
  const riverDir = tool.kind === 'stamp' && tool.stamp === 'river' ? tool.riverDir : undefined;

  function btn(
    key: string,
    active: boolean,
    glyph: React.ReactNode,
    label: React.ReactNode,
    onClick: () => void,
    title?: string,
    disabled = false,
  ): JSX.Element {
    return (
      <button
        key={key}
        className={`${active ? 'active' : ''}${disabled ? ' absent' : ''}`}
        disabled={disabled}
        onClick={onClick}
        title={disabled ? 'not in this labyrinth' : title ?? (typeof label === 'string' ? label : undefined)}
      >
        <span className="glyph">{glyph}</span>
        {showLabels && <span className="label">{label}</span>}
      </button>
    );
  }

  return (
    <div className={`palette ${showLabels ? 'wide' : 'narrow'}`} style={{ width }}>
      {showLabels && <h3>Draw</h3>}
      {btn('wall', tool.kind === 'wall', '▦', <>walls <small>(tap or swipe)</small></>, () => setTool({ kind: 'wall' }), 'walls — tap an edge to cycle, swipe along a line to draw a run')}
      {btn(
        'river',
        isStamp('river'),
        <span style={{ color: '#58a6d8' }}>➤</span>,
        <>river <small>(swipe the flow)</small></>,
        () => setTool({ kind: 'stamp', stamp: 'river', riverDir: riverDir ?? 'E' }),
        'river — hold on a tile and swipe: that tile gets the flow direction',
        !inGame('river'),
      )}
      {isStamp('river') && showLabels && (
        <div className="river-dirs">
          {(['N', 'E', 'S', 'W'] as const).map((d) => (
            <button
              key={d}
              className={riverDir === d ? 'active' : ''}
              onClick={() => setTool({ kind: 'stamp', stamp: 'river', riverDir: d })}
              title={`tap-to-stamp direction ${d}`}
            >
              {d}
            </button>
          ))}
        </div>
      )}
      {STAMPS.map(({ stamp, label }) =>
        btn(stamp, isStamp(stamp), STAMP_GLYPHS[stamp], label, () => setTool({ kind: 'stamp', stamp }), undefined, !inGame(stamp)),
      )}
      {btn('note', tool.kind === 'note', '✍', 'note', () => setTool({ kind: 'note' }))}
      {btn('erase', tool.kind === 'erase', '⌫', 'erase', () => setTool({ kind: 'erase' }))}

      <PlayerPieces showLabels={showLabels} isStamp={isStamp} setStamp={(s) => setTool({ kind: 'stamp', stamp: s })} />

      {showLabels && <h3>Edit</h3>}
      {btn('select', tool.kind === 'select', '▭', <>select <small>(drag)</small></>, () => setTool({ kind: 'select' }), 'select — drag a rectangle')}
      <div className="button-row">
        <button disabled={!selection} onClick={() => store.getState().copySelection()} title="copy selection">
          ⧉{showLabels && ' copy'}
        </button>
        <button disabled={!selection} onClick={() => store.getState().cutSelection()} title="cut selection">
          ✂{showLabels && ' cut'}
        </button>
        <button disabled={!clipboard} onClick={() => store.getState().startPaste()} title="paste — then click a cell">
          ⎘{showLabels && ' paste'}
        </button>
      </div>
      <div className="button-row">
        <button onClick={() => store.getState().undo()} title="undo">
          ↶{showLabels && ' undo'}
        </button>
        <button onClick={() => store.getState().redo()} title="redo">
          ↷{showLabels && ' redo'}
        </button>
      </div>
      {pending && showLabels && (
        <div className="hint">
          click a cell to stamp it there ·{' '}
          <button onClick={() => store.getState().cancelPending()}>cancel</button>
        </div>
      )}

      <div
        className="palette-handle"
        title="drag to resize the toolbar"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          dragFrom.current = { x: e.clientX, width };
        }}
        onPointerMove={(e) => {
          if (!dragFrom.current) return;
          const next = Math.max(NARROW, Math.min(WIDE + 30, dragFrom.current.width + (e.clientX - dragFrom.current.x)));
          setDragWidth(next);
        }}
        onPointerUp={() => {
          if (!dragFrom.current) return;
          const final = dragWidth ?? width;
          dragFrom.current = null;
          setDragWidth(null);
          store.getState().setPaletteWide(final >= SNAP);
        }}
        onDoubleClick={() => store.getState().setPaletteWide(!wide)}
      >
        <span className="grip">⋮</span>
      </div>
    </div>
  );
}

/** One tracking piece per player in the room, colored by turn order. */
function PlayerPieces(props: {
  showLabels: boolean;
  isStamp(s: Stamp): boolean;
  setStamp(s: Stamp): void;
}): JSX.Element | null {
  const started = useGameStore((s) => s.started);
  if (!started || started.turnOrder.length < 2) return null;
  return (
    <>
      {props.showLabels && <h3>Track players</h3>}
      {started.turnOrder.slice(0, PIECE_STAMPS.length).map((p, i) => {
        const stamp = PIECE_STAMPS[i]!;
        return (
          <button
            key={p.id}
            className={props.isStamp(stamp) ? 'active' : ''}
            onClick={() => props.setStamp(stamp)}
            title={`move ${p.name}'s piece on your map`}
          >
            <span className="glyph">{STAMP_GLYPHS[stamp]}</span>
            {props.showLabels && (
              <span className="label">
                {p.name}
                {p.id === started.yourPlayerId ? ' (you)' : ''}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
