import { create } from 'zustand';
import { setLocalHandler } from '../net/ws.js';
import { TutorialGM, TUTORIAL_ROOM_CODE } from '../tutorial/gm.js';
import { TUTORIAL_STEPS, type TutorialCtx } from '../tutorial/steps.js';
import { useGameStore } from './gameStore.js';
import { useMapStore } from './mapStore.js';
import { useProfileStore } from './profileStore.js';

/**
 * The guided first game. Starting it spins up an in-browser game master
 * (see tutorial/gm.ts) over the regular game screen, then walks the player
 * through TUTORIAL_STEPS: info cards advance on click, objective cards
 * advance themselves the moment the engine, the event feed, or the player's
 * own map says the lesson landed.
 */
export interface TutorialStoreState {
  active: boolean;
  stepIndex: number;
  start(): void;
  /** continue (info cards) / skip (objective cards); finishes on the last card */
  next(): void;
  exit(): void;
  evaluate(): void;
}

let gm: TutorialGM | null = null;
let unsubs: (() => void)[] = [];

function buildCtx(): TutorialCtx {
  const you = gm?.state.players[0];
  const game = useGameStore.getState();
  const main = useMapStore.getState().maps.find((m) => m.id === 'main');
  return {
    pos: you ? you.pos : null,
    hasTreasure: you?.hasTreasure ?? false,
    finished: game.finished !== null,
    grid: main?.grids[0] ?? null,
    sawEvent: (type, direction) =>
      game.feed.some((e) => {
        const p = e.event.payload as { type: string; direction?: string };
        return p.type === type && (direction === undefined || p.direction === direction);
      }),
  };
}

export const useTutorialStore = create<TutorialStoreState>((set, get) => ({
  active: false,
  stepIndex: 0,

  start() {
    if (get().active) return;
    // every run starts from clean graph paper
    try {
      localStorage.removeItem(`labyrinthium:maps:${TUTORIAL_ROOM_CODE}`);
    } catch {
      /* a stale practice map is harmless */
    }
    const profile = useProfileStore.getState();
    gm = new TutorialGM(
      (msg) => useGameStore.getState().handleMessage(msg),
      profile.profile?.displayName || 'you',
      profile.avatar,
    );
    setLocalHandler(gm.handle);
    set({ active: true, stepIndex: 0 });
    gm.start();
    // Subscribe AFTER the kickoff burst: the screen watcher must not see the
    // pre-game 'home' state and conclude the player already left.
    unsubs = [
      useGameStore.subscribe((s, prev) => {
        if (!get().active) return;
        if (s.screen !== 'game') {
          get().exit(); // the header's "leave", an error reset, …
          return;
        }
        if (s.feed !== prev.feed || s.finished !== prev.finished) get().evaluate();
      }),
      useMapStore.subscribe((s, prev) => {
        if (s.maps !== prev.maps) get().evaluate();
      }),
    ];
  },

  next() {
    const { stepIndex } = get();
    if (stepIndex >= TUTORIAL_STEPS.length - 1) {
      get().exit();
      return;
    }
    set({ stepIndex: stepIndex + 1 });
    get().evaluate(); // fall through objectives the player already met
  },

  exit() {
    if (!get().active) return;
    set({ active: false, stepIndex: 0 });
    for (const u of unsubs) u();
    unsubs = [];
    setLocalHandler(null);
    gm = null;
    if (useGameStore.getState().screen === 'game') useGameStore.getState().reset();
  },

  evaluate() {
    const { active, stepIndex } = get();
    if (!active || !gm) return;
    const ctx = buildCtx();
    let i = stepIndex;
    while (i < TUTORIAL_STEPS.length) {
      const step = TUTORIAL_STEPS[i]!;
      if (!step.done || !step.done(ctx)) break;
      i++;
    }
    // never auto-advance past the graduation card — it waits for its click
    if (i !== stepIndex) set({ stepIndex: Math.min(i, TUTORIAL_STEPS.length - 1) });
  },
}));
