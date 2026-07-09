import type { Direction, PlanarDirection } from '../geometry.js';
import type { CosmeticItem } from '../cosmetics/items.js';

/**
 * Everything a player (or everyone) learns comes through events. Events
 * carry NO absolute coordinates — only relative observations. 'teleported'
 * deliberately has no destination and 'fellThroughTrapdoor' says only "down
 * one level": cross-referencing your own maps is the game.
 */
export type EventPayload =
  // The player's declared action, as spoken at the table ("Bob goes north").
  // Public under open-information rules, private to the actor otherwise.
  | {
      type: 'actionAnnounced';
      playerId: string;
      playerName: string;
      action: 'move' | 'shoot' | 'grenade' | 'placeMine' | 'pickup' | 'leave' | 'endTurn' | 'skip';
      direction?: Direction;
    }
  | { type: 'moved'; direction: PlanarDirection }
  | { type: 'bumpedWall'; direction: PlanarDirection }
  | { type: 'bumpedGrate'; direction: PlanarDirection }
  | { type: 'foundExit'; direction: PlanarDirection }
  | { type: 'riverHere' }
  // direction is withheld on hard difficulty (config.hardRivers)
  | { type: 'riverDrift'; direction?: PlanarDirection }
  // The pad's visible rune (pair label) and kind — but never the destination.
  // A two-way arrival has its twin pad plainly underfoot; a one-way arrival
  // is a bare landing spot (the pad's "exit side").
  | { type: 'teleported'; label?: number; mode?: 'oneWay' | 'twoWay' }
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
  | { type: 'itemsFound'; grenades: number; bullets: number; mines: number }
  // ---- aesthetic loot (zero gameplay effect) ----
  | { type: 'coinsFound'; amount: number } // banked instantly
  // the treasure's hidden prize, revealed to the winner at the moment of escape
  | { type: 'prizeFound'; item: CosmeticItem }
  | { type: 'leftLabyrinth' } // private: you walked out, race forfeited
  | { type: 'playerLeft'; playerId: string; playerName: string } // public
  | { type: 'gameEndedNoWinner' } // public: everyone walked out
  | { type: 'turnSkippedParalyzed'; remaining: number }
  | { type: 'turnTimedOut'; playerName: string } // public: the clock ran out
  | { type: 'monstersStir' } // public: the treasure was lifted — the guardians wake
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
