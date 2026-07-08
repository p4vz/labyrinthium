import { describe, expect, it } from 'vitest';
import { InvalidActionError } from '../src/engine/actions.js';
import { openLevel, payloadTypes, playScript, startGame, testMap, turn } from './fixtures.js';

describe('movement & walls', () => {
  it('moves through open edges and reports the direction', () => {
    const state = startGame(testMap());
    const { state: next, events } = turn(state, { type: 'move', direction: 'E' });
    expect(next.players[0]!.pos).toMatchObject({ x: 1, y: 0 });
    expect(payloadTypes(events)).toContain('moved');
  });

  it('bumping a wall is a free note — the turn stays open', () => {
    const map = testMap({ walls: [{ at: { x: 0, y: 0 }, dir: 'E' }] });
    const state = startGame(map, 2);
    const { state: next, events } = turn(state, { type: 'move', direction: 'E' });
    expect(next.players[0]!.pos).toMatchObject({ x: 0, y: 0 });
    expect(payloadTypes(events)).toContain('bumpedWall');
    // no turn consumed: same turn number, same active player
    expect(next.turnNumber).toBe(state.turnNumber);
    expect(next.turnIndex).toBe(state.turnIndex);
    // ...and a successful move afterwards ends the turn normally
    const after = turn(next, { type: 'move', direction: 'S' });
    expect(after.state.turnNumber).toBe(state.turnNumber + 1);
  });

  it('reinforced walls bump exactly like plain walls (indistinguishable)', () => {
    const map = testMap({ walls: [{ at: { x: 0, y: 0 }, dir: 'E', state: 'reinforced' }] });
    const { events } = turn(startGame(map), { type: 'move', direction: 'E' });
    expect(payloadTypes(events)).toContain('bumpedWall');
  });

  it('grates report as grates when bumped', () => {
    const map = testMap({ walls: [{ at: { x: 0, y: 0 }, dir: 'E', state: 'grate' }] });
    const { events } = turn(startGame(map), { type: 'move', direction: 'E' });
    expect(payloadTypes(events)).toContain('bumpedGrate');
  });
});

describe('exits & winning', () => {
  it('an exit without treasure is announced but cannot be used', () => {
    const map = testMap({ exits: [{ at: { x: 0, y: 0 }, dir: 'N' }] });
    const { state: next, events } = turn(startGame(map), { type: 'move', direction: 'N' });
    expect(payloadTypes(events)).toContain('foundExit');
    expect(next.players[0]!.exited).toBe(false);
    expect(next.phase).toBe('inProgress');
  });

  it('exiting with the treasure wins the game', () => {
    const map = testMap({
      treasure: { level: 0, x: 1, y: 0 },
      exits: [{ at: { x: 0, y: 0 }, dir: 'N' }],
    });
    const { state, events } = playScript(startGame(map), [
      { type: 'move', direction: 'E' }, // step onto the treasure tile
      { type: 'pickup' }, // lifting it costs the action
      { type: 'move', direction: 'W' },
      { type: 'move', direction: 'N' }, // out through the exit
    ]);
    expect(state.phase).toBe('finished');
    expect(state.winnerId).toBe('p1');
    expect(payloadTypes(events)).toEqual(
      expect.arrayContaining(['treasurePickedUp', 'exitedLabyrinth', 'gameWon']),
    );
  });
});

describe('grenades', () => {
  it('destroys a wall, then the player can walk through', () => {
    const map = testMap({ walls: [{ at: { x: 0, y: 0 }, dir: 'E' }] });
    const { state, events } = playScript(startGame(map), [
      { type: 'grenade', direction: 'E' },
      { type: 'move', direction: 'E' },
    ]);
    expect(payloadTypes(events)).toEqual(expect.arrayContaining(['wallDestroyed', 'explosionHeard', 'moved']));
    expect(state.players[0]!.pos).toMatchObject({ x: 1, y: 0 });
    expect(state.players[0]!.inventory.grenades).toBe(1);
  });

  it('destroys grates', () => {
    const map = testMap({ walls: [{ at: { x: 0, y: 0 }, dir: 'E', state: 'grate' }] });
    const { events } = turn(startGame(map), { type: 'grenade', direction: 'E' });
    const destroyed = events.find((e) => e.payload.type === 'wallDestroyed');
    expect(destroyed?.payload).toMatchObject({ kind: 'grate' });
  });

  it('has no effect on reinforced walls but is still spent', () => {
    const map = testMap({ walls: [{ at: { x: 0, y: 0 }, dir: 'E', state: 'reinforced' }] });
    const { state, events } = turn(startGame(map), { type: 'grenade', direction: 'E' });
    const noEffect = events.find((e) => e.payload.type === 'grenadeNoEffect');
    expect(noEffect?.payload).toMatchObject({ reason: 'reinforced' });
    expect(state.players[0]!.inventory.grenades).toBe(1);
    // wall still there
    const after = turn(state, { type: 'move', direction: 'E' });
    expect(payloadTypes(after.events)).toContain('bumpedWall');
  });

  it('rejects grenading the outer border without consuming the turn', () => {
    const state = startGame(testMap());
    expect(() => turn(state, { type: 'grenade', direction: 'N' })).toThrow(InvalidActionError);
  });

  it('throws when out of grenades', () => {
    const map = testMap({ walls: [{ at: { x: 0, y: 0 }, dir: 'E' }] });
    const state = startGame(map, 1, { startingInventory: { grenades: 0, bullets: 0, mines: 0 } });
    expect(() => turn(state, { type: 'grenade', direction: 'E' })).toThrow('no grenades');
  });
});

describe('shooting', () => {
  it('paralyzes the victim, drops only the treasure, and screams publicly', () => {
    const map = testMap({ treasure: { level: 0, x: 1, y: 0 } });
    let state = startGame(map, 2);
    state = turn(state, { type: 'move', direction: 'E' }).state; // p1 onto the treasure tile
    state = turn(state, { type: 'move', direction: 'S' }).state; // p2 sidesteps to (0,1)
    state = turn(state, { type: 'pickup' }).state; // p1 lifts the treasure (action)...
    state = turn(state, { type: 'move', direction: 'E' }).state; // ...and moves to (2,0)
    state = turn(state, { type: 'move', direction: 'N' }).state; // p2 back to (0,0)
    state = turn(state, { type: 'move', direction: 'S' }).state; // p1 to (2,1)
    const result = turn(state, { type: 'shoot', direction: 'E' }); // p2 shoots row 0 — misses
    state = result.state;
    expect(payloadTypes(result.events)).toContain('shotFired');
    expect(payloadTypes(result.events)).not.toContain('screamHeard');
    state = turn(state, { type: 'endTurn' }).state; // shooting kept p2's turn open

    // p1 steps back up to row 0 at x=2; p2 shoots east again and hits.
    state = turn(state, { type: 'move', direction: 'N' }).state; // p1 to (2,0), carrying treasure
    const hit = turn(state, { type: 'shoot', direction: 'E' });
    state = hit.state;
    expect(payloadTypes(hit.events)).toEqual(expect.arrayContaining(['shotFired', 'screamHeard', 'youWereShot', 'treasureDropped']));
    const victim = state.players[0]!;
    expect(victim.paralysis).toBe(3);
    expect(victim.hasTreasure).toBe(false);
    expect(victim.inventory.grenades).toBeGreaterThan(0); // keeps gear
    expect(state.treasure).toMatchObject({ carriedBy: null, pos: { x: 2, y: 0 } });
  });

  it('bullets stop at walls', () => {
    const map = testMap({ walls: [{ at: { x: 0, y: 0 }, dir: 'E' }] });
    let state = startGame(map, 2);
    state = turn(state, { type: 'move', direction: 'S' }).state; // p1 out of row 0
    state = turn(state, { type: 'move', direction: 'S' }).state; // p2 also moves (turn order)
    // Nothing to hit behind the wall; no scream.
    const result = turn(state, { type: 'shoot', direction: 'E' });
    expect(payloadTypes(result.events)).not.toContain('screamHeard');
  });

  it('paralyzed players auto-skip their turns until recovered', () => {
    const map = testMap();
    let state = startGame(map, 2);
    state = turn(state, { type: 'move', direction: 'E' }).state; // p1 to (1,0)
    let result = turn(state, { type: 'shoot', direction: 'E' }); // p2 shoots from (0,0)
    state = result.state;
    expect(state.players[0]!.paralysis).toBe(3);
    state = turn(state, { type: 'endTurn' }).state; // the shot kept p2's turn open
    for (let i = 3; i > 0; i--) {
      const skip = turn(state, { type: 'skip' });
      state = skip.state;
      expect(payloadTypes(skip.events)).toContain('turnSkippedParalyzed');
      state = turn(state, { type: 'move', direction: i % 2 ? 'S' : 'N' }).state; // p2 paces
    }
    expect(state.players[0]!.paralysis).toBe(0);
    const free = turn(state, { type: 'move', direction: 'E' });
    expect(payloadTypes(free.events)).toContain('moved');
  });

  it('skip is illegal for able-bodied players', () => {
    expect(() => turn(startGame(testMap()), { type: 'skip' })).toThrow('paralyzed');
  });
});

describe('mines & traps', () => {
  it('a placed mine detonates on the next player entering, including the placer', () => {
    const map = testMap();
    let state = startGame(map, 2);
    state = turn(state, { type: 'move', direction: 'E' }).state; // p1 to (1,0)
    state = turn(state, { type: 'placeMine' }).state; // p2 mines the entrance (action)
    state = turn(state, { type: 'endTurn' }).state; // and passes
    state = turn(state, { type: 'move', direction: 'W' }).state; // p1 back onto the mine
    const p1 = state.players[0]!;
    expect(p1.paralysis).toBe(3);
    expect(state.placedMines).toHaveLength(0); // consumed
    expect(state.players[1]!.inventory.mines).toBe(0);
  });

  it('baked mines detonate once', () => {
    const map = testMap({ features: [{ feature: { type: 'mine', at: { x: 1, y: 0 } } }] });
    let state = startGame(map, 2);
    const boom = turn(state, { type: 'move', direction: 'E' });
    state = boom.state;
    expect(payloadTypes(boom.events)).toEqual(expect.arrayContaining(['mineTriggered', 'explosionHeard']));
    expect(state.players[0]!.paralysis).toBe(3);
    // p2 walks over the same cell later: nothing happens.
    const walk = turn(state, { type: 'move', direction: 'E' });
    expect(payloadTypes(walk.events)).not.toContain('mineTriggered');
  });

  it('single-use traps spring exactly once', () => {
    const map = testMap({
      features: [{ feature: { type: 'trap', at: { x: 1, y: 0 }, paralysis: 2 } }],
    });
    let state = startGame(map, 2);
    const sprung = turn(state, { type: 'move', direction: 'E' });
    state = sprung.state;
    expect(payloadTypes(sprung.events)).toContain('trapSprung');
    expect(state.players[0]!.paralysis).toBe(2);
    const again = turn(state, { type: 'move', direction: 'E' }); // p2 follows
    expect(payloadTypes(again.events)).not.toContain('trapSprung');
  });

  it('a paralyzed player standing on the treasure cannot pick it up', () => {
    const map = testMap({
      treasure: { level: 0, x: 1, y: 0 },
      features: [{ feature: { type: 'mine', at: { x: 1, y: 0 } } }],
    });
    const result = turn(startGame(map), { type: 'move', direction: 'E' });
    expect(payloadTypes(result.events)).toContain('mineTriggered');
    expect(payloadTypes(result.events)).toContain('treasureHere');
    expect(result.state.players[0]!.hasTreasure).toBe(false);
  });
});

describe('teleports', () => {
  it('one-way teleports relocate without revealing the destination', () => {
    const map = testMap({
      features: [
        { feature: { type: 'teleport', at: { x: 1, y: 0 }, target: { level: 0, x: 2, y: 2 }, mode: 'oneWay' } },
      ],
    });
    const { state, events } = turn(startGame(map), { type: 'move', direction: 'E' });
    expect(state.players[0]!.pos).toMatchObject({ x: 2, y: 2 });
    const tp = events.find((e) => e.payload.type === 'teleported');
    expect(tp).toBeDefined();
    expect(Object.keys(tp!.payload)).toEqual(['type']); // no coordinates leak
  });

  it('two-way teleports bounce you to the twin, and the twin back', () => {
    const map = testMap({
      features: [
        { feature: { type: 'teleport', at: { x: 1, y: 0 }, target: { level: 0, x: 1, y: 2 }, mode: 'twoWay' } },
        { feature: { type: 'teleport', at: { x: 1, y: 2 }, target: { level: 0, x: 1, y: 0 }, mode: 'twoWay' } },
      ],
    });
    let state = startGame(map);
    state = turn(state, { type: 'move', direction: 'E' }).state; // step on pad A
    expect(state.players[0]!.pos).toMatchObject({ x: 1, y: 2 }); // landed on B, did not bounce back
    state = turn(state, { type: 'move', direction: 'W' }).state; // step off
    state = turn(state, { type: 'move', direction: 'E' }).state; // step on pad B
    expect(state.players[0]!.pos).toMatchObject({ x: 1, y: 0 }); // back at A
  });
});

describe('rivers', () => {
  const riverMap = () =>
    testMap({
      levels: [openLevel(4, 3)],
      treasure: { level: 0, x: 3, y: 2 },
      features: [
        { feature: { type: 'river', cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } },
      ],
    });

  it('entering a river drifts you one tile downstream', () => {
    const { state, events } = turn(startGame(riverMap()), { type: 'move', direction: 'E' });
    expect(state.players[0]!.pos).toMatchObject({ x: 2, y: 0 });
    expect(payloadTypes(events)).toEqual(expect.arrayContaining(['moved', 'riverHere', 'riverDrift']));
  });

  it('the current sweeps you again at the start of your next turn', () => {
    let state = turn(startGame(riverMap()), { type: 'move', direction: 'E' }).state; // at (2,0)
    const swept = turn(state, { type: 'move', direction: 'S' });
    // drift to (3,0) happens first, then the declared move executes from there
    expect(payloadTypes(swept.events)).toContain('riverDrift');
    expect(swept.state.players[0]!.pos).toMatchObject({ x: 3, y: 1 });
  });

  it('the river mouth does not drift', () => {
    let state = turn(startGame(riverMap()), { type: 'move', direction: 'E' }).state; // (2,0)
    state = turn(state, { type: 'move', direction: 'S' }).state; // swept to (3,0) mouth... moved S to (3,1)
    state = turn(state, { type: 'move', direction: 'N' }).state; // back to mouth (3,0)
    const settled = turn(state, { type: 'move', direction: 'S' });
    // no drift this time: mouth has no downstream
    expect(payloadTypes(settled.events)).not.toContain('riverDrift');
  });

  it('river chains into a teleport but a teleport grants no extra drift', () => {
    const map = testMap({
      levels: [openLevel(4, 3)],
      treasure: { level: 0, x: 3, y: 2 },
      features: [
        { feature: { type: 'river', cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }] } },
        { feature: { type: 'teleport', at: { x: 2, y: 0 }, target: { level: 0, x: 0, y: 2 }, mode: 'oneWay' } },
      ],
    });
    const { state, events } = turn(startGame(map), { type: 'move', direction: 'E' });
    // enter river at (1,0) -> drift to (2,0) -> teleport to (0,2), settle there
    expect(payloadTypes(events)).toEqual(expect.arrayContaining(['riverDrift', 'teleported']));
    expect(state.players[0]!.pos).toMatchObject({ x: 0, y: 2 });
  });
});

describe('multi-level maps', () => {
  const towerMap = () =>
    testMap({
      levels: [openLevel(3, 3), openLevel(4, 4)],
      treasure: { level: 1, x: 3, y: 3 },
      features: [
        { level: 0, feature: { type: 'stairs', at: { x: 1, y: 1 }, to: { level: 1, x: 0, y: 0 } } },
        { level: 1, feature: { type: 'stairs', at: { x: 0, y: 0 }, to: { level: 0, x: 1, y: 1 } } },
        { level: 0, feature: { type: 'trapdoor', at: { x: 2, y: 2 }, to: { level: 1, x: 2, y: 2 } } },
      ],
    });

  it('stairs are announced and traversed with U/D moves', () => {
    let state = startGame(towerMap());
    state = turn(state, { type: 'move', direction: 'E' }).state; // (1,0)
    const found = turn(state, { type: 'move', direction: 'S' }); // onto stairs at (1,1)
    state = found.state;
    const stairsEvent = found.events.find((e) => e.payload.type === 'stairsFound');
    expect(stairsEvent?.payload).toMatchObject({ directions: ['D'] });

    const down = turn(state, { type: 'move', direction: 'D' });
    state = down.state;
    expect(state.players[0]!.pos).toMatchObject({ level: 1, x: 0, y: 0 });
    expect(payloadTypes(down.events)).toContain('tookStairs');

    const up = turn(state, { type: 'move', direction: 'U' });
    expect(up.state.players[0]!.pos).toMatchObject({ level: 0, x: 1, y: 1 });
  });

  it('moving U/D without stairs is rejected', () => {
    expect(() => turn(startGame(towerMap()), { type: 'move', direction: 'D' })).toThrow('stairway');
  });

  it('trapdoors drop you one level without saying where', () => {
    let state = startGame(towerMap());
    state = turn(state, { type: 'move', direction: 'S' }).state; // (0,1)
    state = turn(state, { type: 'move', direction: 'S' }).state; // (0,2)
    state = turn(state, { type: 'move', direction: 'E' }).state; // (1,2)
    const fall = turn(state, { type: 'move', direction: 'E' }); // (2,2) trapdoor
    expect(fall.state.players[0]!.pos).toMatchObject({ level: 1, x: 2, y: 2 });
    const evt = fall.events.find((e) => e.payload.type === 'fellThroughTrapdoor');
    expect(evt).toBeDefined();
    expect(Object.keys(evt!.payload)).toEqual(['type']);
  });
});

describe('monsters', () => {
  it('landing on a monster paralyzes and drops the treasure', () => {
    // The monster is sealed in a box at (2,2); a teleport drops the player
    // right on top of it, so the encounter is fully deterministic.
    const map = testMap({
      treasure: { level: 0, x: 0, y: 1 },
      monsters: [{ at: { level: 0, x: 2, y: 2 }, ai: 'wanderer' }],
      walls: [
        { at: { x: 2, y: 2 }, dir: 'N' },
        { at: { x: 2, y: 2 }, dir: 'W' },
      ],
      features: [
        { feature: { type: 'teleport', at: { x: 1, y: 0 }, target: { level: 0, x: 2, y: 2 }, mode: 'oneWay' } },
      ],
    });
    let state = startGame(map);
    state = turn(state, { type: 'move', direction: 'S' }).state; // onto the treasure tile
    state = turn(state, { type: 'pickup' }).state; // lift it (action)
    expect(state.players[0]!.hasTreasure).toBe(true);
    state = turn(state, { type: 'move', direction: 'N' }).state; // back to (0,0)
    const clash = turn(state, { type: 'move', direction: 'E' }); // teleport pad -> monster box
    expect(payloadTypes(clash.events)).toEqual(expect.arrayContaining(['teleported', 'monsterEncounter']));
    expect(clash.state.players[0]!.paralysis).toBe(1);
    expect(clash.state.players[0]!.hasTreasure).toBe(false);
    expect(clash.state.treasure.pos).toMatchObject({ x: 2, y: 2 });
  });

  it('a patroller walks its loop', () => {
    const map = testMap({
      levels: [openLevel(4, 3)],
      treasure: { level: 0, x: 3, y: 2 },
      monsters: [
        {
          at: { level: 0, x: 2, y: 2 },
          ai: 'patroller',
          route: [{ x: 2, y: 2 }, { x: 3, y: 2 }],
        },
      ],
    });
    let state = startGame(map);
    const before = state.monsters[0]!.pos;
    state = turn(state, { type: 'move', direction: 'E' }).state;
    const after = state.monsters[0]!.pos;
    expect(after).not.toMatchObject(before);
    state = turn(state, { type: 'move', direction: 'W' }).state;
    expect(state.monsters[0]!.pos).toMatchObject(before); // returned
  });

  it('bullets kill monsters silently', () => {
    // Clear line of fire along row 0: the shot resolves before the monster's
    // world-phase move, so this is deterministic.
    const map = testMap({
      monsters: [{ at: { level: 0, x: 2, y: 0 }, ai: 'wanderer' }],
    });
    const kill = turn(startGame(map), { type: 'shoot', direction: 'E' });
    expect(kill.state.monsters[0]!.alive).toBe(false);
    expect(payloadTypes(kill.events)).toContain('shotFired');
    expect(payloadTypes(kill.events)).not.toContain('screamHeard');
  });

  it('walls shield monsters from bullets', () => {
    const map = testMap({
      monsters: [{ at: { level: 0, x: 2, y: 0 }, ai: 'wanderer' }],
      walls: [
        { at: { x: 2, y: 0 }, dir: 'W' },
        { at: { x: 2, y: 0 }, dir: 'S' },
      ],
    });
    const blocked = turn(startGame(map), { type: 'shoot', direction: 'E' });
    expect(blocked.state.monsters[0]!.alive).toBe(true);
  });
});

describe('determinism', () => {
  it('replaying the same action log reproduces the exact final state', () => {
    const map = testMap({
      levels: [openLevel(5, 5)],
      treasure: { level: 0, x: 4, y: 4 },
      monsters: [{ at: { level: 0, x: 4, y: 0 }, ai: 'wanderer' }],
    });
    const script = [
      { type: 'move', direction: 'E' },
      { type: 'move', direction: 'S' },
      { type: 'shoot', direction: 'E' },
      { type: 'move', direction: 'S' },
      { type: 'placeMine' },
      { type: 'move', direction: 'E' },
      { type: 'grenade', direction: 'S' },
      { type: 'move', direction: 'S' },
    ] as const;
    const run1 = playScript(startGame(map, 2), [...script]);
    const run2 = playScript(startGame(map, 2), [...script]);
    expect(JSON.stringify(run1.state)).toBe(JSON.stringify(run2.state));
    expect(JSON.stringify(run1.events)).toBe(JSON.stringify(run2.events));
  });
});
