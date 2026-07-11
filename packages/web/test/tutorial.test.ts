import { describe, expect, it } from 'vitest';
import {
  validateMap,
  type ClientMessage,
  type PlanarDirection,
  type ServerMessage,
} from '@labyrinthium/shared';
import { createGrid, cycleEdge, toggleStamp, type PlayerGrid } from '../src/state/playerMap.js';
import { TutorialGM, TUTORIAL_PLAYER_ID } from '../src/tutorial/gm.js';
import { tutorialMap, TUTORIAL_COINS } from '../src/tutorial/map.js';
import { TUTORIAL_STEPS, type TutorialCtx } from '../src/tutorial/steps.js';

/** Drive the GM exactly like the client does, and mimic the player's pencil
 * with the same playerMap primitives the drawing tools call. */
function harness(): {
  gm: TutorialGM;
  messages: ServerMessage[];
  act(action: { type: string } & Record<string, unknown>): boolean;
  draw(fn: (g: PlayerGrid) => PlayerGrid): void;
  ctx(): TutorialCtx;
} {
  const messages: ServerMessage[] = [];
  const gm = new TutorialGM((m) => messages.push(m), 'Tess');
  gm.start();
  let grid = createGrid(5, 5);
  return {
    gm,
    messages,
    act: (action) => gm.handle({ type: 'game.action', action } as ClientMessage),
    draw: (fn) => {
      grid = fn(grid);
    },
    ctx: () => ({
      pos: gm.state.players[0]!.pos,
      hasTreasure: gm.state.players[0]!.hasTreasure,
      finished: messages.some((m) => m.type === 'game.finished'),
      grid,
      sawEvent: (type, direction) =>
        messages.some(
          (m) =>
            m.type === 'game.events' &&
            m.events.some((e) => {
              const p = e.payload as { type: string; direction?: string };
              return p.type === type && (direction === undefined || p.direction === direction);
            }),
        ),
    }),
  };
}

const step = (id: string) => {
  const s = TUTORIAL_STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`no tutorial step '${id}'`);
  return s;
};

describe('the practice labyrinth', () => {
  it('is a legal map by the generator’s own rules', () => {
    const result = validateMap(tutorialMap());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('opens like a real game: brief, blank map, your turn', () => {
    const { messages } = harness();
    const started = messages.find((m) => m.type === 'game.started');
    expect(started).toMatchObject({
      yourPlayerId: TUTORIAL_PLAYER_ID,
      entrance: { level: 0, x: 0, y: 2 },
      exitSides: ['W'],
      featuresPresent: ['river'],
    });
    const turn = messages.find((m) => m.type === 'game.turn');
    expect(turn).toMatchObject({ activePlayerId: TUTORIAL_PLAYER_ID, canAct: true });
  });
});

describe('the scripted route satisfies every lesson, in order', () => {
  it('walks from the welcome card to the graduation card', () => {
    const h = harness();
    const move = (d: PlanarDirection) => h.act({ type: 'move', direction: d });

    // info cards have no completion check — they wait for a click
    expect(step('welcome').done).toBeUndefined();
    expect(step('tour').done).toBeUndefined();

    // bump: walking south answers with a wall, and the turn survives
    expect(step('bump').done!(h.ctx())).toBe(false);
    const turnBefore = h.gm.state.turnNumber;
    move('S');
    expect(step('bump').done!(h.ctx())).toBe(true);
    expect(h.gm.state.turnNumber).toBe(turnBefore); // free retry

    // draw-wall: one tap of the wall tool on the south edge of the entrance
    // (the S edge of (0,2) IS the N edge of (0,3) — how the UI addresses it)
    expect(step('draw-wall').done!(h.ctx())).toBe(false);
    h.draw((g) => cycleEdge(g, 0, 3, 'N'));
    expect(step('draw-wall').done!(h.ctx())).toBe(true);

    // step-east: a real step — and the river immediately drags you north
    expect(step('step-east').done!(h.ctx())).toBe(false);
    move('E');
    expect(step('step-east').done!(h.ctx())).toBe(true);
    expect(h.ctx().sawEvent('riverDrift', 'N')).toBe(true);
    expect(h.gm.state.players[0]!.pos).toMatchObject({ x: 1, y: 1 });

    // draw-river: stamp the tile you drifted from
    expect(step('draw-river').done!(h.ctx())).toBe(false);
    h.draw((g) => toggleStamp(g, 1, 2, 'river', 'N'));
    expect(step('draw-river').done!(h.ctx())).toBe(true);

    // bump-east: the grenade wall announces itself
    expect(step('bump-east').done!(h.ctx())).toBe(false);
    move('E');
    expect(step('bump-east').done!(h.ctx())).toBe(true);

    // grenade: the wall comes down, the action is spent, the turn is open
    expect(step('grenade').done!(h.ctx())).toBe(false);
    h.act({ type: 'grenade', direction: 'E' });
    expect(step('grenade').done!(h.ctx())).toBe(true);
    expect(h.gm.state.actedThisTurn).toBe(true);
    expect(h.gm.state.players[0]!.inventory.grenades).toBe(1);

    // through: step into the breach and scoop the coins
    expect(step('through').done!(h.ctx())).toBe(false);
    move('E');
    expect(step('through').done!(h.ctx())).toBe(true);
    expect(h.gm.state.players[0]!.banked.coins).toBe(TUTORIAL_COINS.amount);

    // find-treasure: the GM sings out
    expect(step('find-treasure').done!(h.ctx())).toBe(false);
    move('E');
    expect(step('find-treasure').done!(h.ctx())).toBe(true);

    // pickup
    expect(step('pickup').done!(h.ctx())).toBe(false);
    h.act({ type: 'pickup' });
    expect(step('pickup').done!(h.ctx())).toBe(true);

    // escape: retrace west (the river mouth cannot drag you), south, out
    expect(step('escape').done!(h.ctx())).toBe(false);
    move('W'); // back through the rubble
    move('W'); // river mouth — no downstream, no drift
    expect(h.gm.state.players[0]!.pos).toMatchObject({ x: 1, y: 1 });
    move('W');
    move('S');
    move('W'); // through the gate, carrying the treasure
    expect(step('escape').done!(h.ctx())).toBe(true);

    const finished = h.messages.find((m) => m.type === 'game.finished');
    expect(finished).toMatchObject({
      winnerId: TUTORIAL_PLAYER_ID,
      winnerName: 'Tess',
      lootSummary: [{ coins: TUTORIAL_COINS.amount, left: false }],
    });
    // the graduation card never auto-advances
    expect(step('graduated').done).toBeUndefined();
  });

  it('never blocks: every objective can also be reached without a grenade', () => {
    const h = harness();
    const move = (d: PlanarDirection) => h.act({ type: 'move', direction: d });
    // squander the whole kit on the outer wall's neighbors? no — walk the
    // detour: north up the west corridor, east along the top, down to loot
    move('E'); // into the river, dragged to (1,1)
    move('W');
    move('N');
    move('E');
    move('E');
    move('S'); // (2,1): coins
    expect(step('grenade').done!(h.ctx())).toBe(true); // corridor reached
    expect(step('through').done!(h.ctx())).toBe(true);
    move('E'); // treasure
    h.act({ type: 'pickup' });
    expect(step('pickup').done!(h.ctx())).toBe(true);
  });
});

describe('the local GM behaves like the server room', () => {
  it('consumes game traffic and lets lobby traffic pass to the socket', () => {
    const h = harness();
    expect(h.gm.handle({ type: 'maps.sync', maps: [] })).toBe(true);
    expect(h.gm.handle({ type: 'ping' })).toBe(true);
    expect(h.gm.handle({ type: 'room.create', name: 'x' })).toBe(false);
  });

  it('answers an invalid action with an error and an intact turn', () => {
    const h = harness();
    const before = h.gm.state.turnNumber;
    h.act({ type: 'pickup' }); // no treasure underfoot at the entrance
    const err = h.messages.find((m) => m.type === 'error');
    expect(err).toMatchObject({ code: 'NOTHING_TO_PICK_UP' });
    expect(h.gm.state.turnNumber).toBe(before);
  });
});
