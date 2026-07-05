import type { GameEvent } from './engine/events.js';

/** Render one game event the way a human game master would say it. */
export function describeEvent(e: GameEvent): string {
  const p = e.payload;
  switch (p.type) {
    case 'moved':
      return `you step ${dir(p.direction)}`;
    case 'bumpedWall':
      return `a wall blocks the way ${dir(p.direction)}`;
    case 'bumpedGrate':
      return `a metal grate blocks the way ${dir(p.direction)} — a grenade might open it`;
    case 'foundExit':
      return `there is an EXIT ${dir(p.direction)} — but you need the treasure to leave`;
    case 'riverHere':
      return 'you are standing in a river';
    case 'riverDrift':
      return `the current drags you ${dir(p.direction)}`;
    case 'teleported':
      return 'a flash of light — you are... somewhere else';
    case 'fellThroughTrapdoor':
      return 'the floor gives way! you fall one level down';
    case 'stairsFound':
      return `there is a stairway here (${p.directions.map((d) => (d === 'U' ? 'up' : 'down')).join(', ')})`;
    case 'tookStairs':
      return `you take the stairs ${p.direction === 'U' ? 'up' : 'down'}`;
    case 'treasurePickedUp':
      return 'you found the TREASURE! now get out';
    case 'treasureHere':
      return 'the treasure lies here, but you cannot lift it right now';
    case 'treasureDropped':
      return 'you dropped the treasure!';
    case 'monsterEncounter':
      return `a MONSTER mauls you — paralyzed for ${p.paralysis} turn(s)`;
    case 'minePlaced':
      return 'you carefully arm a mine on this tile';
    case 'mineTriggered':
      return `BOOM — you stepped on a mine, paralyzed for ${p.paralysis} turn(s)`;
    case 'trapSprung':
      return `a hidden trap springs — paralyzed for ${p.paralysis} turn(s)`;
    case 'wallDestroyed':
      return `your grenade blows the ${p.kind} ${dir(p.direction)} to rubble`;
    case 'grenadeNoEffect':
      return p.reason === 'reinforced'
        ? `the grenade goes off ${dir(p.direction)} but the wall doesn't even crack`
        : `the grenade goes off ${dir(p.direction)} — there was nothing to destroy`;
    case 'youWereShot':
      return `you are SHOT — paralyzed for ${p.paralysis} turn(s)`;
    case 'shotFired':
      return '… a shot rings out somewhere in the labyrinth';
    case 'screamHeard':
      return '… a scream echoes through the corridors';
    case 'explosionHeard':
      return '… a muffled explosion shakes the walls';
    case 'turnSkippedParalyzed':
      return `you are paralyzed — turn skipped (${p.remaining} more)`;
    case 'exitedLabyrinth':
      return 'daylight! you are OUT with the treasure!';
    case 'gameWon':
      return `*** ${p.playerName} escaped the labyrinth with the treasure and WINS ***`;
  }
}

function dir(d: string): string {
  return { N: 'north', E: 'east', S: 'south', W: 'west' }[d] ?? d;
}
