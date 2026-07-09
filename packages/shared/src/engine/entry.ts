import { directionBetween, posEq, posKey } from '../geometry.js';
import { isRarePlus } from '../cosmetics/items.js';
import { featuresAt, levelOf, riverNext } from '../map/document.js';
import type { MapFeature } from '../map/document.js';
import type { EventPayload, Visibility } from './events.js';
import type { GameState, PlayerState } from './state.js';

export interface EngineCtx {
  state: GameState;
  emit(visibility: Visibility, payload: EventPayload): void;
}

export function dropTreasure(ctx: EngineCtx, player: PlayerState): void {
  if (!player.hasTreasure) return;
  player.hasTreasure = false;
  ctx.state.treasure.carriedBy = null;
  ctx.state.treasure.pos = { ...player.pos };
  ctx.emit({ kind: 'private', playerId: player.id }, { type: 'treasureDropped' });
}

/** Carried rares fall where the carrier stands — anyone can walk over and
 * claim them, exactly like the treasure. Called at every treasure-drop site. */
export function dropCarriedRares(ctx: EngineCtx, player: PlayerState): void {
  if (player.carriedRares.length === 0) return;
  for (const item of player.carriedRares) {
    ctx.state.groundCosmetics.push({ pos: { ...player.pos }, item });
  }
  ctx.emit(
    { kind: 'private', playerId: player.id },
    { type: 'rareLootDropped', count: player.carriedRares.length },
  );
  player.carriedRares = [];
}

/** The extraction moment: carried rares become permanently the player's. */
export function bankCarriedRares(ctx: EngineCtx, player: PlayerState): void {
  if (player.carriedRares.length === 0) return;
  const items = player.carriedRares;
  player.carriedRares = [];
  player.banked.items.push(...items);
  ctx.emit({ kind: 'private', playerId: player.id }, { type: 'rareLootBanked', items });
}

function isSprung(state: GameState, pos: { level: number; x: number; y: number }): boolean {
  return state.sprungTraps.some((t) => posEq(t, pos));
}

/**
 * Resolves everything that happens when a player lands on a cell, in spec
 * order: teleport -> trapdoor -> river drift -> mine -> trap -> stairs ->
 * treasure -> monster. Teleports/trapdoors restart the pipeline at the new
 * cell; a visited-set guards against authored relocation loops, and the
 * landing pad of a teleport never re-fires (you arrive on top of it).
 */
export function runEntryPipeline(
  ctx: EngineCtx,
  player: PlayerState,
  opts: { driftBudget: number },
): void {
  const { state } = ctx;
  const priv: Visibility = { kind: 'private', playerId: player.id };
  const visited = new Set<string>();
  let driftBudget = opts.driftBudget;

  // Bounded by construction (visited set + drift budget), but belt-and-braces.
  for (let guard = 0; guard < 64; guard++) {
    const level = levelOf(state.map, player.pos.level);
    const feats = featuresAt(level, player.pos);
    const here = posKey(player.pos);

    const teleport = feats.find((f): f is Extract<MapFeature, { type: 'teleport' }> => f.type === 'teleport');
    if (teleport && !visited.has(here)) {
      visited.add(here);
      visited.add(posKey(teleport.target)); // landing pad never re-fires
      player.pos = { ...teleport.target };
      // The rune on the pad is plainly visible — the destination is not.
      // (mode is visible too: a two-way arrival has its twin pad underfoot.)
      ctx.emit(priv, {
        type: 'teleported',
        ...(teleport.label !== undefined ? { label: teleport.label } : {}),
        mode: teleport.mode,
      });
      continue;
    }

    const trapdoor = feats.find((f): f is Extract<MapFeature, { type: 'trapdoor' }> => f.type === 'trapdoor');
    if (trapdoor && !visited.has(here)) {
      visited.add(here);
      player.pos = { ...trapdoor.to };
      ctx.emit(priv, { type: 'fellThroughTrapdoor' });
      continue;
    }

    const river = feats.find((f): f is Extract<MapFeature, { type: 'river' }> => f.type === 'river');
    if (river) {
      ctx.emit(priv, { type: 'riverHere' });
      if (driftBudget > 0) {
        const next = riverNext(river, player.pos);
        if (next) {
          const direction = directionBetween(player.pos, next);
          if (direction) {
            driftBudget--;
            player.pos = { ...player.pos, ...next };
            ctx.emit(priv, { type: 'riverDrift', direction });
            continue;
          }
        }
      }
    }

    // Mines: player-placed first, then baked (a baked mine can be consumed once).
    const placedIdx = state.placedMines.findIndex((m) => posEq(m, player.pos));
    const bakedMine = feats.some((f) => f.type === 'mine') && !isSprung(state, player.pos);
    if (placedIdx >= 0 || bakedMine) {
      if (placedIdx >= 0) state.placedMines.splice(placedIdx, 1);
      else state.sprungTraps.push({ ...player.pos });
      player.paralysis = Math.max(player.paralysis, state.config.mineParalysis);
      dropTreasure(ctx, player);
      dropCarriedRares(ctx, player);
      ctx.emit(priv, { type: 'mineTriggered', paralysis: state.config.mineParalysis });
      ctx.emit({ kind: 'public' }, { type: 'explosionHeard' });
    }

    const trap = feats.find((f): f is Extract<MapFeature, { type: 'trap' }> => f.type === 'trap');
    if (trap && !isSprung(state, player.pos)) {
      state.sprungTraps.push({ ...player.pos });
      player.paralysis = Math.max(player.paralysis, trap.paralysis);
      dropTreasure(ctx, player);
      dropCarriedRares(ctx, player);
      ctx.emit(priv, { type: 'trapSprung', paralysis: trap.paralysis });
    }

    // Dropped gear on the floor: an able-bodied visitor scoops it all up.
    const floorIdx = state.floorItems.findIndex((f) => posEq(f.pos, player.pos));
    if (floorIdx >= 0 && player.paralysis === 0) {
      const found = state.floorItems[floorIdx]!.items;
      player.inventory.grenades += found.grenades;
      player.inventory.bullets += found.bullets;
      player.inventory.mines += found.mines;
      state.floorItems.splice(floorIdx, 1);
      ctx.emit(priv, { type: 'itemsFound', ...found });
    }

    // Aesthetic loot is scooped in stride — it costs nothing and changes
    // nothing about play. Coins and commons bank on the spot; rare+ pieces
    // ride along at risk until the carrier walks out (or drops them).
    if (player.paralysis === 0) {
      const coinIdx = state.coinPiles.findIndex((c) => posEq(c.pos, player.pos));
      if (coinIdx >= 0) {
        const { amount } = state.coinPiles[coinIdx]!;
        state.coinPiles.splice(coinIdx, 1);
        player.banked.coins += amount;
        ctx.emit(priv, { type: 'coinsFound', amount });
      }
      for (let i = state.groundCosmetics.length - 1; i >= 0; i--) {
        const g = state.groundCosmetics[i]!;
        if (!posEq(g.pos, player.pos)) continue;
        state.groundCosmetics.splice(i, 1);
        if (isRarePlus(g.item.rarity)) {
          player.carriedRares.push(g.item);
          ctx.emit(priv, { type: 'rareLootFound', item: g.item });
        } else {
          player.banked.items.push(g.item);
          ctx.emit(priv, { type: 'cosmeticFound', item: g.item });
        }
      }
    }

    const stairs = feats.filter((f): f is Extract<MapFeature, { type: 'stairs' }> => f.type === 'stairs');
    if (stairs.length > 0) {
      const directions = stairs.map((s) => (s.to.level > player.pos.level ? 'D' as const : 'U' as const));
      ctx.emit(priv, { type: 'stairsFound', directions });
    }

    // Treasure is never scooped up in stride: the GM announces it, and
    // lifting it costs your turn's action ('pickup').
    const treasure = state.treasure;
    if (treasure.carriedBy === null && posEq(treasure.pos, player.pos)) {
      ctx.emit(priv, { type: 'treasureHere' });
    }

    const monster = state.monsters.find((m) => m.alive && posEq(m.pos, player.pos));
    if (monster && player.paralysis === 0) {
      player.paralysis = state.config.monsterParalysis;
      dropTreasure(ctx, player);
      dropCarriedRares(ctx, player);
      ctx.emit(priv, { type: 'monsterEncounter', paralysis: state.config.monsterParalysis });
    }

    return;
  }
  throw new Error('entry pipeline failed to settle (relocation loop in map?)');
}
