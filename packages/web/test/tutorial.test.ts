import { describe, expect, it } from 'vitest';
import {
  validateMap,
  type ClientMessage,
  type PlanarDirection,
  type ServerMessage,
} from '@labyrinthium/shared';
import { createGrid, cycleEdge, toggleStamp, type PlayerGrid } from '../src/state/playerMap.js';
import { TutorialGM, TUTORIAL_PLAYER_ID } from '../src/tutorial/gm.js';
import { tutorialMap, TUTORIAL_ARSENAL, TUTORIAL_COINS } from '../src/tutorial/map.js';
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
  it('walks from the rules card to the graduation card', () => {
    const h = harness();
    const move = (d: PlanarDirection) => h.act({ type: 'move', direction: d });
    const you = () => h.gm.state.players[0]!;

    // the opening: rules, the bare sample map, then the map vanishes —
    // info cards with no completion check; they wait for a click
    expect(step('rules').done).toBeUndefined();
    expect(step('sample-map').done).toBeUndefined();
    expect(step('vanish').done).toBeUndefined();
    // …and the reveal/vanish pair carries the picture
    expect(step('sample-map').visual).toBe('trueMap');
    expect(step('vanish').visual).toBe('vanish');

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

    // step-north: a real step into the river — the current drags you east
    expect(step('step-north').done!(h.ctx())).toBe(false);
    move('N');
    expect(step('step-north').done!(h.ctx())).toBe(true);
    expect(h.ctx().sawEvent('riverDrift', 'E')).toBe(true);
    expect(you().pos).toMatchObject({ x: 1, y: 1 });

    // draw-river: stamp the tile you first stepped into
    expect(step('draw-river').done!(h.ctx())).toBe(false);
    h.draw((g) => toggleStamp(g, 0, 1, 'river', 'E'));
    expect(step('draw-river').done!(h.ctx())).toBe(true);

    // ride-out: the turn OPENS with another drag east, then the step north
    // lands on the arsenal — the whole stash joins the kit
    expect(step('ride-out').done!(h.ctx())).toBe(false);
    move('N');
    expect(step('ride-out').done!(h.ctx())).toBe(true);
    expect(you().pos).toMatchObject({ x: 2, y: 0 }); // dragged to x2, stepped ashore
    expect(h.ctx().sawEvent('itemsFound')).toBe(true);
    expect(you().inventory).toEqual({
      grenades: 2 + TUTORIAL_ARSENAL.items.grenades,
      bullets: 2 + TUTORIAL_ARSENAL.items.bullets,
      mines: 1 + TUTORIAL_ARSENAL.items.mines,
    });
    expect(step('arsenal').done).toBeUndefined(); // info card

    // bump-east: walk the bank until the vault wall answers
    expect(step('bump-east').done!(h.ctx())).toBe(false);
    move('E');
    expect(step('bump-east').done!(h.ctx())).toBe(false); // just walking yet
    move('E');
    expect(step('bump-east').done!(h.ctx())).toBe(true);

    // grenade: the vault comes down, the action is spent, the turn is open
    expect(step('grenade').done!(h.ctx())).toBe(false);
    const grenadesBefore = you().inventory.grenades;
    h.act({ type: 'grenade', direction: 'E' });
    expect(step('grenade').done!(h.ctx())).toBe(true);
    expect(h.gm.state.actedThisTurn).toBe(true);
    expect(you().inventory.grenades).toBe(grenadesBefore - 1);

    // find-treasure: step into the vault, the GM sings out
    expect(step('find-treasure').done!(h.ctx())).toBe(false);
    move('E');
    expect(step('find-treasure').done!(h.ctx())).toBe(true);

    // pickup
    expect(step('pickup').done!(h.ctx())).toBe(false);
    h.act({ type: 'pickup' });
    expect(step('pickup').done!(h.ctx())).toBe(true);

    // coins-home: south over the river MOUTH (no drift), south onto coins
    expect(step('coins-home').done!(h.ctx())).toBe(false);
    move('S');
    expect(you().pos).toMatchObject({ x: 4, y: 1 }); // the mouth held still
    move('S');
    expect(step('coins-home').done!(h.ctx())).toBe(true);
    expect(you().banked.coins).toBe(TUTORIAL_COINS.amount);

    // escape: due west along the open floor, out the gate
    expect(step('escape').done!(h.ctx())).toBe(false);
    move('W');
    move('W');
    move('W');
    move('W');
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

  it('never blocks: the vault also opens without a grenade, via the mouth', () => {
    const h = harness();
    const move = (d: PlanarDirection) => h.act({ type: 'move', direction: d });
    move('N'); // into the river, dragged east to (1,1)
    move('N'); // dragged to (2,1), step ashore onto the arsenal
    move('E'); // (3,0), before the vault wall
    move('S'); // into the river — the current delivers you to the mouth (4,1)
    expect(h.gm.state.players[0]!.pos).toMatchObject({ x: 4, y: 1 });
    move('N'); // up into the vault from the south
    expect(step('find-treasure').done!(h.ctx())).toBe(true);
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
