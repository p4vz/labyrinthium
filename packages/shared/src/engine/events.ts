import type { PlanarDirection } from '../geometry.js';

/**
 * Everything a player (or everyone) learns comes through events. Events
 * carry NO absolute coordinates — only relative observations. 'teleported'
 * deliberately has no destination and 'fellThroughTrapdoor' says only "down
 * one level": cross-referencing your own maps is the game.
 */
export type EventPayload =
  | { type: 'moved'; direction: PlanarDirection }
  | { type: 'bumpedWall'; direction: PlanarDirection }
  | { type: 'bumpedGrate'; direction: PlanarDirection }
  | { type: 'foundExit'; direction: PlanarDirection }
  | { type: 'riverHere' }
  | { type: 'riverDrift'; direction: PlanarDirection }
  | { type: 'teleported' }
  | { type: 'fellThroughTrapdoor' }
  | { type: 'stairsFound'; directions: ('U' | 'D')[] }
  | { type: 'tookStairs'; direction: 'U' | 'D' }
  | { type: 'treasurePickedUp' }
  | { type: 'treasureHere' } // saw it but could not pick it up (paralyzed)
  | { type: 'treasureDropped' }
  | { type: 'monsterEncounter'; paralysis: number }
  | { type: 'minePlaced' }
  | { type: 'mineTriggered'; paralysis: number }
  | { type: 'trapSprung'; paralysis: number }
  | { type: 'wallDestroyed'; direction: PlanarDirection; kind: 'wall' | 'grate' }
  | { type: 'grenadeNoEffect'; direction: PlanarDirection; reason: 'reinforced' | 'nothingThere' }
  | { type: 'youWereShot'; paralysis: number }
  | { type: 'shotFired' } // public: a shot was heard somewhere
  | { type: 'screamHeard' } // public: the shot hit someone
  | { type: 'explosionHeard' } // public: grenade or mine
  | { type: 'turnSkippedParalyzed'; remaining: number }
  | { type: 'exitedLabyrinth' }
  | { type: 'gameWon'; playerId: string; playerName: string };

export type Visibility = { kind: 'private'; playerId: string } | { kind: 'public' };

export interface GameEvent {
  seq: number;
  turn: number;
  visibility: Visibility;
  payload: EventPayload;
}

export function visibleTo(event: GameEvent, playerId: string): boolean {
  return event.visibility.kind === 'public' || event.visibility.playerId === playerId;
}
