import { describe, expect, it } from 'vitest';
import { FrameBelief, WorldBelief } from '../src/ai/index.js';
import { driveGame, seededRng } from './aiHarness.js';
import { openLevel, testMap } from './fixtures.js';

const SIZES_5 = [{ width: 5, height: 5 }];

describe('anchor posterior (FrameBelief)', () => {
  it('bounds alone confine the anchor: charted cells must fit the grid', () => {
    const world = new WorldBelief(SIZES_5);
    const frame = new FrameBelief({ id: 1, kind: 'teleport', levelPrior: [1] });
    // walked 3 cells east from the landing spot
    frame.observeCell({ x: 0, y: 0 }, { visited: true });
    frame.observeCell({ x: 3, y: 0 }, { visited: true });
    const est = frame.estimate(world)!;
    // anchor x can be 0 or 1 (x+3 must stay inside width 5), y anywhere
    expect(est.support).toBe(2 * 5);
  });

  it('border bumps localize hard: a NW corner has exactly one placement', () => {
    const world = new WorldBelief(SIZES_5);
    const frame = new FrameBelief({ id: 1, kind: 'teleport', levelPrior: [1] });
    // border edges can never be open — observing OPEN both ways pins us
    // one cell off each wall we bumped
    frame.observeEdge({ x: 0, y: 0 }, 'N', 'bumpedWall');
    frame.observeEdge({ x: 0, y: 0 }, 'W', 'bumpedWall');
    frame.observeEdge({ x: 0, y: 0 }, 'E', 'open');
    frame.observeEdge({ x: 1, y: 0 }, 'E', 'open');
    frame.observeEdge({ x: 2, y: 0 }, 'E', 'open');
    frame.observeEdge({ x: 3, y: 0 }, 'E', 'open');
    frame.observeEdge({ x: 0, y: 0 }, 'S', 'open');
    frame.observeEdge({ x: 0, y: 1 }, 'S', 'open');
    frame.observeEdge({ x: 0, y: 2 }, 'S', 'open');
    frame.observeEdge({ x: 0, y: 3 }, 'S', 'open');
    // four open edges east + four south only fit from the NW corner
    const est = frame.estimate(world)!;
    expect(est.support).toBe(1);
    expect(est.anchor).toEqual({ level: 0, x: 0, y: 0 });
    expect(est.p).toBe(1);
  });

  it('matches charted walls against the known map and collapses', () => {
    const world = new WorldBelief(SIZES_5);
    // chart the whole level as open corridors...
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        world.setEdgeObs(0, { x, y }, 'N', y === 0 ? 'bumpedWall' : 'open');
        world.setEdgeObs(0, { x, y }, 'W', x === 0 ? 'bumpedWall' : 'open');
      }
    // ...except a distinctive wall pocket around (3,3)
    world.setEdgeObs(0, { x: 3, y: 3 }, 'N', 'bumpedWall');
    world.setEdgeObs(0, { x: 3, y: 3 }, 'E', 'bumpedWall');
    world.setEdgeObs(0, { x: 3, y: 3 }, 'S', 'open');
    world.setEdgeObs(0, { x: 3, y: 3 }, 'W', 'open');
    const frame = new FrameBelief({ id: 1, kind: 'teleport', levelPrior: [1] });
    frame.observeEdge({ x: 0, y: 0 }, 'N', 'bumpedWall');
    frame.observeEdge({ x: 0, y: 0 }, 'E', 'bumpedWall');
    frame.observeEdge({ x: 0, y: 0 }, 'S', 'open');
    frame.observeEdge({ x: 0, y: 0 }, 'W', 'open');
    // the NE corner looks identical — one probe south of the pocket splits it
    frame.observeEdge({ x: 0, y: 1 }, 'S', 'bumpedWall');
    const est = frame.estimate(world)!;
    expect(est.anchor).toEqual({ level: 0, x: 3, y: 3 });
    expect(est.p).toBeGreaterThan(0.95);
  });

  it('a trapdoor frame lives exactly one level down', () => {
    const world = new WorldBelief([
      { width: 4, height: 4 },
      { width: 5, height: 5 },
    ]);
    const frame = new FrameBelief({ id: 1, kind: 'trapdoor', levelPrior: [0, 1] });
    frame.observeCell({ x: 0, y: 0 }, { visited: true });
    const est = frame.estimate(world)!;
    expect(est.anchor.level).toBe(1);
    expect(est.support).toBe(25);
  });

  it('a previously-seen teleport rune seeds its twin pad', () => {
    const world = new WorldBelief(SIZES_5);
    world.mergeCell(0, { x: 4, y: 4 }, { pad: { label: 2 } });
    const frame = new FrameBelief({ id: 1, kind: 'teleport', levelPrior: [1], label: 2 });
    frame.seeds.set('0:4,4', 25);
    frame.observeCell({ x: 0, y: 0 }, { visited: true });
    const est = frame.estimate(world)!;
    expect(est.anchor).toEqual({ level: 0, x: 4, y: 4 });
  });

  it('feature mismatches are hard vetoes: stairs cannot land on a known plain cell', () => {
    const world = new WorldBelief(SIZES_5);
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        if (x !== 2 || y !== 2) world.mergeCell(0, { x, y }, { visited: true, stairs: [] });
    world.mergeCell(0, { x: 2, y: 2 }, { visited: true, stairs: ['U'] });
    const frame = new FrameBelief({ id: 1, kind: 'teleport', levelPrior: [1] });
    frame.observeCell({ x: 0, y: 0 }, { visited: true, stairs: ['U'] });
    const est = frame.estimate(world)!;
    expect(est.support).toBe(1);
    expect(est.anchor).toEqual({ level: 0, x: 2, y: 2 });
  });

  it('merge folds the aux sheet into the main map at the anchor', () => {
    const world = new WorldBelief(SIZES_5);
    const frame = new FrameBelief({ id: 1, kind: 'teleport', levelPrior: [1] });
    frame.observeEdge({ x: 0, y: 0 }, 'E', 'open');
    frame.observeCell({ x: 0, y: 0 }, { visited: true, stairs: ['D'] });
    frame.merge(world, { level: 0, x: 2, y: 1 });
    expect(world.edge(0, { x: 2, y: 1 }, 'E')).toBe('open');
    expect(world.cell(0, { x: 2, y: 1 })?.stairs).toEqual(['D']);
  });

  it('contradiction everywhere degrades to soft matching instead of dying', () => {
    const world = new WorldBelief([{ width: 3, height: 3 }]);
    // the world "knows" every N edge is open, the frame observed a bump
    for (let x = 0; x < 3; x++)
      for (let y = 1; y < 3; y++) world.setEdgeObs(0, { x, y }, 'N', 'open');
    const frame = new FrameBelief({ id: 1, kind: 'teleport', levelPrior: [1] });
    frame.observeEdge({ x: 0, y: 1 }, 'N', 'bumpedWall');
    frame.observeEdge({ x: 0, y: 1 }, 'S', 'bumpedWall');
    frame.observeEdge({ x: 0, y: 2 }, 'S', 'bumpedWall'); // also a contradiction path
    const est = frame.estimate(world);
    expect(est).not.toBeNull();
    expect(est!.support).toBeGreaterThan(0);
  });
});

describe('end-to-end relocalization (BayesianBrain in a real game)', () => {
  it('re-localizes after a teleport and still knows its true position', () => {
    // 5x5, entrance NW with exit gate; a one-way pad at (4,0) drops the bot
    // at (0,4); treasure at (4,4)
    const map = testMap({
      levels: [openLevel(5, 5)],
      entrance: { level: 0, x: 0, y: 0 },
      exits: [{ at: { x: 0, y: 0 }, dir: 'N' }],
      treasure: { level: 0, x: 4, y: 4 },
      features: [
        {
          feature: {
            type: 'teleport',
            at: { x: 4, y: 0 },
            target: { level: 0, x: 0, y: 4 },
            mode: 'oneWay',
            label: 1,
          },
        },
      ],
    });
    const r = driveGame({
      map,
      brains: { p1: { tier: 'hard', rng: seededRng(3) } },
      maxTurns: 300,
    });
    expect(r.illegalActions).toEqual([]);
    expect(r.mislocalizations).toBe(0);
    expect(r.won).toBe(true);
    expect(r.state.winnerId).toBe('p1');
  });

  it('handles trapdoors between differently-sized levels and wins', () => {
    const map = testMap({
      levels: [openLevel(4, 4), openLevel(6, 6)],
      entrance: { level: 0, x: 0, y: 0 },
      exits: [{ at: { x: 0, y: 0 }, dir: 'W' }],
      treasure: { level: 1, x: 5, y: 5 },
      features: [
        { level: 0, feature: { type: 'trapdoor', at: { x: 3, y: 3 }, to: { level: 1, x: 2, y: 2 } } },
        { level: 0, feature: { type: 'stairs', at: { x: 0, y: 3 }, to: { level: 1, x: 0, y: 0 } } },
        { level: 1, feature: { type: 'stairs', at: { x: 0, y: 0 }, to: { level: 0, x: 0, y: 3 } } },
      ],
    });
    const r = driveGame({
      map,
      brains: { p1: { tier: 'hard', rng: seededRng(5) } },
      maxTurns: 500,
    });
    expect(r.illegalActions).toEqual([]);
    expect(r.mislocalizations).toBe(0);
    expect(r.won).toBe(true);
  });

  it('a two-way pad becomes a known shortcut after one round trip', () => {
    const map = testMap({
      levels: [openLevel(5, 5)],
      entrance: { level: 0, x: 0, y: 0 },
      exits: [{ at: { x: 0, y: 0 }, dir: 'N' }],
      treasure: { level: 0, x: 4, y: 4 },
      features: [
        {
          feature: {
            type: 'teleport',
            at: { x: 2, y: 0 },
            target: { level: 0, x: 2, y: 4 },
            mode: 'twoWay',
            label: 1,
          },
        },
        {
          feature: {
            type: 'teleport',
            at: { x: 2, y: 4 },
            target: { level: 0, x: 2, y: 0 },
            mode: 'twoWay',
            label: 1,
          },
        },
      ],
    });
    const r = driveGame({
      map,
      brains: { p1: { tier: 'hard', rng: seededRng(9) } },
      maxTurns: 400,
    });
    expect(r.illegalActions).toEqual([]);
    expect(r.mislocalizations).toBe(0);
    expect(r.won).toBe(true);
  });
});
