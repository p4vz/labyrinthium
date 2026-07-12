import { posKey } from '../geometry.js';
import type { MapDocument } from '../map/document.js';
import { distancesFrom } from './validate.js';

/** Heuristic 1–10 difficulty score, stored in map metadata. */
export function scoreDifficulty(map: MapDocument): number {
  const cells = map.levels.reduce((n, l) => n + l.width * l.height, 0);
  const sizeScore = Math.min(4, (cells / 225) * 4); // 15×15 single layer ≈ 4

  const treasureDist = distancesFrom(map, map.entrance).get(posKey(map.spawns.treasure)) ?? 0;
  const pathScore = Math.min(2, (treasureDist / 30) * 2);

  let features = 0;
  let riverCells = 0;
  for (const level of map.levels) {
    for (const f of level.features) {
      if (f.type === 'river') riverCells += f.cells.length;
      else features += 1;
    }
  }
  const featureScore = Math.min(2.5, features * 0.3 + (riverCells / cells) * 3);
  const monsterScore = Math.min(1.5, map.spawns.monsters.length * 0.5);
  const layerScore = (map.levels.length - 1) * 0.5;

  const raw = 1 + sizeScore + pathScore + featureScore + monsterScore + layerScore;
  return Math.round(Math.min(10, Math.max(1, raw)) * 10) / 10;
}
