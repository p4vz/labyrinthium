import { describe, expect, it } from 'vitest';
import { openLevel, payloadTypes, playScript, startGame, testMap, turn } from './fixtures.js';

describe('house rules', () => {
  it('open information announces actions publicly; secret mode keeps them private', () => {
    const open = turn(startGame(testMap(), 1, { openInformation: true }), {
      type: 'move',
      direction: 'E',
    });
    const announce = open.events.find((e) => e.payload.type === 'actionAnnounced');
    expect(announce?.visibility.kind).toBe('public');
    expect(announce?.payload).toMatchObject({ action: 'move', direction: 'E' });

    const secret = turn(startGame(testMap(), 1, { openInformation: false }), {
      type: 'move',
      direction: 'E',
    });
    const hidden = secret.events.find((e) => e.payload.type === 'actionAnnounced');
    expect(hidden?.visibility.kind).toBe('private');
  });

  it('with a turn timer, a skip is legal for able players and is announced', () => {
    const state = startGame(testMap(), 2, { turnTimerSeconds: 30 });
    const skipped = turn(state, { type: 'skip' });
    expect(payloadTypes(skipped.events)).toContain('turnTimedOut');
    expect(skipped.state.turnIndex).toBe(1); // turn passed to the next player
  });

  it('without a timer, voluntary skip stays illegal', () => {
    expect(() => turn(startGame(testMap()), { type: 'skip' })).toThrow('paralyzed');
  });

  it('dropAllOnShot: the victim loses their gear to the floor and a visitor scoops it up', () => {
    const map = testMap();
    let state = startGame(map, 2, { dropAllOnShot: true });
    state = turn(state, { type: 'move', direction: 'E' }).state; // p1 to (1,0)
    const hit = turn(state, { type: 'shoot', direction: 'E' }); // p2 shoots from (0,0)
    state = hit.state;
    const victim = state.players[0]!;
    expect(victim.inventory).toEqual({ grenades: 0, bullets: 0, mines: 0 });
    expect(state.floorItems).toHaveLength(1);
    expect(state.floorItems[0]!.items.grenades).toBeGreaterThan(0);

    // p2 ends the turn; p1 is paralyzed (skips); p2 loots the pile.
    state = turn(state, { type: 'endTurn' }).state;
    state = turn(state, { type: 'skip' }).state; // p1 paralyzed skip
    const loot = turn(state, { type: 'move', direction: 'E' }); // p2 onto (1,0)
    expect(payloadTypes(loot.events)).toContain('itemsFound');
    expect(loot.state.floorItems).toHaveLength(0);
    expect(loot.state.players[1]!.inventory.grenades).toBe(4); // 2 own + 2 looted
  });

  it('without dropAllOnShot, a shot victim keeps their gear (only treasure drops)', () => {
    const map = testMap({ treasure: { level: 0, x: 1, y: 0 } });
    let state = startGame(map, 2);
    state = turn(state, { type: 'move', direction: 'E' }).state; // p1 onto the treasure
    state = turn(state, { type: 'move', direction: 'S' }).state; // p2 out of the way
    state = turn(state, { type: 'pickup' }).state; // p1 lifts it (action)...
    state = turn(state, { type: 'endTurn' }).state; // ...and stays put
    state = turn(state, { type: 'move', direction: 'N' }).state; // p2 back to (0,0)
    state = turn(state, { type: 'endTurn' }).state; // p1 holds position
    const hit = turn(state, { type: 'shoot', direction: 'E' }); // p2 fires down row 0
    const victim = hit.state.players[0]!;
    expect(victim.inventory.grenades).toBeGreaterThan(0);
    expect(victim.hasTreasure).toBe(false);
    expect(hit.state.floorItems).toHaveLength(0);
  });

  it('a bomb only breaks breakable walls — it never harms whoever stands behind them', () => {
    const map = testMap({ walls: [{ at: { x: 0, y: 0 }, dir: 'E' }] });
    let state = startGame(map, 2);
    state = turn(state, { type: 'move', direction: 'S' }).state; // p1 to (0,1)
    state = turn(state, { type: 'move', direction: 'S' }).state; // p2 to (0,1) too
    state = turn(state, { type: 'move', direction: 'N' }).state; // p1 back to (0,0)
    state = turn(state, { type: 'move', direction: 'N' }).state; // p2 back to (0,0)... wait, p2 follows p1
    // p1 grenades the wall east with p2 sharing the very same cell:
    const boom = turn(state, { type: 'grenade', direction: 'E' });
    expect(boom.state.players[1]!.paralysis).toBe(0); // nobody is hurt
    expect(boom.state.players[0]!.paralysis).toBe(0);
    const evts = payloadTypes(boom.events);
    expect(evts).toContain('wallDestroyed');
    expect(evts).not.toContain('youWereShot');
    expect(evts).not.toContain('screamHeard');
  });

  it('replays stay exact with the new rules on', () => {
    const map = testMap();
    const script = [
      { type: 'move', direction: 'E' },
      { type: 'shoot', direction: 'E' },
      { type: 'skip' },
      { type: 'move', direction: 'E' },
    ] as const;
    const cfg = { dropAllOnShot: true, turnTimerSeconds: 10, openInformation: true };
    const a = playScript(startGame(map, 2, cfg), [...script]);
    const b = playScript(startGame(map, 2, cfg), [...script]);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });
});

describe('difficulty: hard rivers', () => {
  const riverMap = () =>
    testMap({
      levels: [openLevel(4, 3)],
      treasure: { level: 0, x: 3, y: 2 },
      features: [
        { feature: { type: 'river', cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } },
      ],
    });

  it('easy (default): the GM names the drift direction', () => {
    const { events } = turn(startGame(riverMap()), { type: 'move', direction: 'E' });
    const drift = events.find((e) => e.payload.type === 'riverDrift');
    expect(drift?.payload).toEqual({ type: 'riverDrift', direction: 'E' });
  });

  it('hard: you are dragged, but not told which way', () => {
    const { state, events } = turn(startGame(riverMap(), 1, { hardRivers: true }), {
      type: 'move',
      direction: 'E',
    });
    // the drift itself still happens...
    expect(state.players[0]!.pos).toMatchObject({ x: 2, y: 0 });
    // ...but the event carries no direction (turn-start drift too)
    const drifts = events.filter((e) => e.payload.type === 'riverDrift');
    expect(drifts.length).toBeGreaterThan(0);
    for (const d of drifts) expect(d.payload).toEqual({ type: 'riverDrift' });
  });
});
