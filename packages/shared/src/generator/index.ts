import { coordKey } from '../geometry.js';
import type { MapDocument } from '../map/document.js';
import { generatorParams, type Complexity, type SizePreset } from '../map/presets.js';
import { Rng } from '../rng.js';
import { scoreDifficulty } from './difficulty.js';
import { decideLayerSizes, placeStairs, placeTrapdoors } from './layers.js';
import { braid, carveMaze, harden } from './maze.js';
import {
  placeEntrance,
  placeMinesAndTraps,
  placeMonsters,
  placeTeleports,
  placeTreasure,
  type Occupied,
} from './placement.js';
import { carveRiver } from './rivers.js';
import { validateMap } from './validate.js';

export interface GenerateOptions {
  preset: SizePreset;
  complexity: Complexity;
  seed: string;
}

/**
 * Bake a map. Fully deterministic from (preset, complexity, seed). Each
 * attempt that fails validation retries with a derived sub-seed; later
 * attempts progressively shed risky features (trapdoors, then teleports,
 * then rivers) so generation never fails outright — the final fallback is a
 * plain perfect maze, which is always solvable.
 */
export function generateMap(opts: GenerateOptions): MapDocument {
  const MAX_ATTEMPTS = 25;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const map = attemptGenerate(opts, attempt);
    if (validateMap(map).ok) {
      map.metadata.difficulty = scoreDifficulty(map);
      return map;
    }
  }
  // Unreachable in practice: by attempt 20+ the map is a bare perfect maze.
  throw new Error(`map generation failed for seed "${opts.seed}"`);
}

function attemptGenerate(opts: GenerateOptions, attempt: number): MapDocument {
  const rng = Rng.fromSeed(`${opts.preset}:${opts.complexity}:${opts.seed}:${attempt}`);
  const params = { ...generatorParams(opts.preset, opts.complexity) };

  // Shed complexity as attempts fail so we always converge on a valid map.
  if (attempt >= 8) params.trapdoorCount = [0, 0];
  if (attempt >= 12) {
    params.oneWayTeleports = [0, 0];
    params.twoWayTeleportPairs = [0, 0];
  }
  if (attempt >= 16) params.riverCount = [0, 0];
  if (attempt >= 20) {
    params.layerRange = [1, 1];
    params.mineCount = [0, 0];
    params.trapCount = [0, 0];
  }

  const pickCount = ([lo, hi]: [number, number]): number => lo + rng.int(hi - lo + 1);

  const sizes = decideLayerSizes(params, rng);
  const map: MapDocument = {
    version: 1,
    levels: sizes.map((s) => ({
      width: s.width,
      height: s.height,
      edges: carveMaze(s.width, s.height, rng),
      features: [],
    })),
    entrance: { level: 0, x: 0, y: 0 },
    spawns: { treasure: { level: 0, x: 0, y: 0 }, monsters: [] },
    metadata: {
      seed: opts.seed,
      name: `${opts.preset} ${opts.complexity} #${opts.seed}`,
    },
  };
  const occ: Occupied = map.levels.map(() => new Set<string>());

  for (const level of map.levels) {
    braid(level.edges, params.braidFactor, rng);
    harden(level.edges, params.reinforcedShare, rng);
  }

  // Rivers claim their cells so nothing else lands mid-stream.
  map.levels.forEach((level, li) => {
    const riverCount = pickCount(params.riverCount);
    const length = Math.max(3, Math.round(level.width * level.height * params.riverLengthFactor));
    const taken = occ[li]!;
    for (let r = 0; r < riverCount; r++) {
      const river = carveRiver(level.edges, rng, length, taken, params.grateChance);
      if (river) {
        level.features.push(river);
        river.cells.forEach((c) => taken.add(coordKey(c)));
      }
    }
  });

  placeStairs(map, rng, occ);
  placeTrapdoors(map, rng, pickCount(params.trapdoorCount), occ);
  placeEntrance(map, rng, occ); // the entrance gate doubles as THE exit
  placeTeleports(map, rng, pickCount(params.oneWayTeleports), pickCount(params.twoWayTeleportPairs), occ);
  placeTreasure(map, rng, occ);
  placeMinesAndTraps(map, rng, pickCount(params.mineCount), pickCount(params.trapCount), occ);
  placeMonsters(map, rng, pickCount(params.monsterCount), params.monsterAIs, occ);

  return map;
}

export { validateMap, resolveLanding, distancesFrom, distancesToExit, exitCells } from './validate.js';
export type { MapIssue, ValidationResult } from './validate.js';
export { scoreDifficulty } from './difficulty.js';
