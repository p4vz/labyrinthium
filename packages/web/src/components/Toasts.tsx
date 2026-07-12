import { useGameStore } from '../state/gameStore.js';

/** App-wide error/notice toasts (tap to dismiss). */
export function Toasts(): JSX.Element {
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
