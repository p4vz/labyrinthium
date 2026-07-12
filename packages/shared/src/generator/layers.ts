import { posKey } from '../geometry.js';
import type { MapDocument } from '../map/document.js';
import type { GeneratorParams } from '../map/presets.js';
import type { Rng } from '../rng.js';
import { claim, isFree, type Occupied } from './placement.js';
import { resolveLanding } from './validate.js';

export function decideLayerSizes(params: GeneratorParams, rng: Rng): { width: number; height: number }[] {
  const [lo, hi] = params.layerRange;
  const count = lo + rng.int(hi - lo + 1);
  const sizes: { width: number; height: number }[] = [];
  for (let i = 0; i < count; i++) {
    sizes.push({
      width: params.minSize + rng.int(params.maxSize - params.minSize + 1),
      height: params.minSize + rng.int(params.maxSize - params.minSize + 1),
    });
  }
  return sizes;
}

/**
 * Link every adjacent level pair with 1–2 mirrored stairways so the whole
 * labyrinth is one connected building.
 */
export function placeStairs(map: MapDocument, rng: Rng, occ: Occupied): void {
  for (let li = 0; li < map.levels.length - 1; li++) {
    const upper = map.levels[li]!;
    const lower = map.levels[li + 1]!;
    const flights = 1 + rng.int(2);
    for (let s = 0; s < flights; s++) {
      const upperCells = [];
      for (let y = 0; y < upper.height; y++)
        for (let x = 0; x < upper.width; x++)
          if (isFree(occ, { level: li, x, y })) upperCells.push({ x, y });
      const lowerCells = [];
      for (let y = 0; y < lower.height; y++)
        for (let x = 0; x < lower.width; x++)
          if (isFree(occ, { level: li + 1, x, y })) lowerCells.push({ x, y });
      if (upperCells.length === 0 || lowerCells.length === 0) break;
      const a = rng.pick(upperCells);
      const b = rng.pick(lowerCells);
      claim(occ, { level: li, ...a });
      claim(occ, { level: li + 1, ...b });
      upper.features.push({ type: 'stairs', at: a, to: { level: li + 1, ...b } });
      lower.features.push({ type: 'stairs', at: b, to: { level: li, ...a } });
    }
  }
}

/** One-way drops from level li to li+1 onto resting cells. */
export function placeTrapdoors(map: MapDocument, rng: Rng, count: number, occ: Occupied): void {
  if (map.levels.length < 2) return;
  for (let i = 0; i < count; i++) {
    const li = rng.int(map.levels.length - 1);
    const upper = map.levels[li]!;
    const lower = map.levels[li + 1]!;
    const ats = [];
    for (let y = 0; y < upper.height; y++)
      for (let x = 0; x < upper.width; x++)
        if (isFree(occ, { level: li, x, y })) ats.push({ x, y });
    const tos = [];
    for (let y = 0; y < lower.height; y++)
      for (let x = 0; x < lower.width; x++) {
        const p = { level: li + 1, x, y };
        // Land on a resting cell so a fall settles immediately.
        if (isFree(occ, p) && posKey(resolveLanding(map, p)) === posKey(p)) tos.push(p);
      }
    if (ats.length === 0 || tos.length === 0) continue;
    const at = rng.pick(ats);
    const to = rng.pick(tos);
    claim(occ, { level: li, ...at });
    claim(occ, to);
    upper.features.push({ type: 'trapdoor', at, to });
  }
}
