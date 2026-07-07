import { describe, expect, it } from 'vitest';
import { payloadTypes, playScript, startGame, testMap, turn } from './fixtures.js';

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

    // p1 is paralyzed (skips); p2 walks onto the pile and takes everything.
    state = turn(state, { type: 'skip' }).state; // p1 paralyzed skip
    const loot = turn(state, { type: 'move', direction: 'E' }); // p2 onto (1,0)
    expect(payloadTypes(loot.events)).toContain('itemsFound');
    expect(loot.state.floorItems).toHaveLength(0);
    expect(loot.state.players[1]!.inventory.grenades).toBe(4); // 2 own + 2 looted
  });

  it('without dropAllOnShot, a shot victim keeps their gear (only treasure drops)', () => {
    const map = testMap({ treasure: { level: 0, x: 1, y: 0 } });
    let state = startGame(map, 2);
    state = turn(state, { type: 'move', direction: 'E' }).state; // p1 grabs treasure
    const hit = turn(state, { type: 'shoot', direction: 'E' });
    const victim = hit.state.players[0]!;
    expect(victim.inventory.grenades).toBeGreaterThan(0);
    expect(victim.hasTreasure).toBe(false);
    expect(hit.state.floorItems).toHaveLength(0);
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
