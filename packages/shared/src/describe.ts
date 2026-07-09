import type { GameEvent } from './engine/events.js';

/** Render one game event the way a human game master would say it. */
export function describeEvent(e: GameEvent): string {
  const p = e.payload;
  switch (p.type) {
    case 'actionAnnounced': {
      const d = p.direction ? ` ${dir(p.direction)}` : '';
      switch (p.action) {
        case 'move':
          return `${p.playerName} moves${d}`;
        case 'shoot':
          return `${p.playerName} shoots${d}`;
        case 'grenade':
          return `${p.playerName} throws a grenade${d}`;
        case 'placeMine':
          return `${p.playerName} fumbles with something on the floor…`;
        case 'pickup':
          return `${p.playerName} picks something up`;
        case 'leave':
          return `${p.playerName} heads for the exit…`;
        case 'endTurn':
          return `${p.playerName} ends their turn`;
        case 'skip':
          return `${p.playerName} stays put`;
      }
      return `${p.playerName} acts`;
    }
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
      return p.direction
        ? `the current drags you ${dir(p.direction)}`
        : 'the current drags you… somewhere — you have lost your bearings';
    case 'teleported': {
      const arrival =
        p.mode === 'twoWay' ? ' — its twin pad glints beneath your feet' : '';
      return p.label !== undefined
        ? `you step on teleport pad №${p.label} — a flash of light, and you are... somewhere else${arrival}`
        : `a flash of light — you are... somewhere else${arrival}`;
    }
    case 'fellThroughTrapdoor':
      return 'the floor gives way! you fall one level down';
    case 'stairsFound':
      return `there is a stairway here (${p.directions.map((d) => (d === 'U' ? 'up' : 'down')).join(', ')})`;
    case 'tookStairs':
      return `you take the stairs ${p.direction === 'U' ? 'up' : 'down'}`;
    case 'treasurePickedUp':
      return 'you found the TREASURE! now get out';
    case 'treasureHere':
      return 'the TREASURE lies at your feet — picking it up costs your action';
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
    case 'itemsFound':
      return `you find gear on the floor: ${[
        p.grenades ? `${p.grenades} grenade(s)` : '',
        p.bullets ? `${p.bullets} bullet(s)` : '',
        p.mines ? `${p.mines} mine(s)` : '',
      ]
        .filter(Boolean)
        .join(', ')}`;
    case 'turnSkippedParalyzed':
      return `you are paralyzed — turn skipped (${p.remaining} more)`;
    case 'turnTimedOut':
      return `${p.playerName} ran out of time — turn skipped`;
    case 'monstersStir':
      return '… a low growl rolls through the labyrinth: the guardians have woken';
    case 'exitedLabyrinth':
      return 'daylight! you are OUT with the treasure!';
    case 'gameWon':
      return `*** ${p.playerName} escaped the labyrinth with the treasure and WINS ***`;
    case 'coinsFound':
      return `you scoop up ${p.amount} coin(s)`;
    case 'prizeFound':
      return `hidden inside the treasure: ${p.item.name} (${p.item.rarity.toUpperCase()}) — it is yours!`;
    case 'leftLabyrinth':
      return 'daylight! you walk out — the race goes on without you';
    case 'playerLeft':
      return `${p.playerName} has left the labyrinth`;
    case 'gameEndedNoWinner':
      return '*** everyone has fled — the labyrinth keeps its treasure ***';
  }
  // Cheap armor for clients older than the event stream they're reading.
  return '…something stirs in the dark';
}

function dir(d: string): string {
  return (
    { N: 'north', E: 'east', S: 'south', W: 'west', U: 'up the stairs', D: 'down the stairs' }[d] ?? d
  );
}
