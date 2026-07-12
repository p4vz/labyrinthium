import { TrueMapView } from './TrueMapView.js';
import { useGameStore } from '../state/gameStore.js';
import { useTutorialStore } from '../state/tutorialStore.js';
import { tutorialMap, TUTORIAL_ARSENAL } from '../tutorial/map.js';
import { TUTORIAL_STEPS } from '../tutorial/steps.js';

/** the bare practice maze shown on the sample-map card (stable identity so
 * the vanish step CSS-fades the SAME svg instead of remounting it) */
const SAMPLE_MAP = tutorialMap();

/**
 * The tutorial coach: a card riding over the game screen with the current
 * lesson. Info cards carry a continue button; objective cards wait for the
 * tutorialStore to notice the deed is done (with a skip escape hatch).
 */
export function TutorialOverlay(): JSX.Element | null {
  const active = useTutorialStore((s) => s.active);
  const stepIndex = useTutorialStore((s) => s.stepIndex);
  const next = useTutorialStore((s) => s.next);
  const exit = useTutorialStore((s) => s.exit);
  const screen = useGameStore((s) => s.screen);

  if (!active || screen !== 'game') return null;
  const step = TUTORIAL_STEPS[stepIndex]!;
  const last = stepIndex === TUTORIAL_STEPS.length - 1;

  return (
    <div className="tutorial-card" data-testid="tutorial-card" data-step={step.id}>
      <div className="tutorial-head">
        <span className="tutorial-tag">
          🎓 tutorial · {stepIndex + 1}/{TUTORIAL_STEPS.length}
        </span>
        <button
          className="tutorial-x"
          data-testid="tutorial-exit"
          title="leave the tutorial"
          onClick={exit}
        >
          ✕
        </button>
      </div>
      <h3>{step.title}</h3>
      {step.visual && (
        <div
          className={`tutorial-map ${step.visual === 'vanish' ? 'vanished' : ''}`}
          data-testid="tutorial-map"
        >
          <TrueMapView map={SAMPLE_MAP} level={0} overlay={{ items: [TUTORIAL_ARSENAL.pos] }} />
          {step.visual === 'vanish' && <span className="tutorial-map-lost">?</span>}
        </div>
      )}
      {step.body.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {step.goal ? (
        <>
          <p className="tutorial-goal" data-testid="tutorial-goal">
            👉 {step.goal}
          </p>
          <div className="tutorial-actions">
            <button className="tutorial-skip" data-testid="tutorial-skip" onClick={next}>
              skip this step ›
            </button>
          </div>
        </>
      ) : (
        <div className="tutorial-actions">
          <button className="primary" data-testid="tutorial-next" onClick={next}>
            {last ? '🎉 finish' : 'continue →'}
          </button>
        </div>
      )}
    </div>
  );
}
