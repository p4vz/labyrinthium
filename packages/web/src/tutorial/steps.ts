import type { PlayerGrid } from '../state/playerMap.js';
import {
  TUTORIAL_ARSENAL,
  TUTORIAL_COINS,
  TUTORIAL_ENTRANCE,
  TUTORIAL_RIVER_CELLS,
} from './map.js';

/**
 * Everything a lesson's completion check may look at: the engine's ground
 * truth (position, treasure), the GM's spoken record (events), and the
 * player's own hand-drawn map. Pure data + functions — no store imports —
 * so the whole script is testable in node.
 */
export interface TutorialCtx {
  pos: { level: number; x: number; y: number } | null;
  hasTreasure: boolean;
  finished: boolean;
  /** the main hand-drawn map, ground level */
  grid: PlayerGrid | null;
  /** has the GM said this yet? (optionally narrowed by direction) */
  sawEvent(type: string, direction?: string): boolean;
}

export interface TutorialStep {
  id: string;
  title: string;
  /** the coach's words, one paragraph per entry */
  body: string[];
  /** the objective line; absent = an info card with a continue button */
  goal?: string;
  /** auto-advance when true; only objective steps have one */
  done?(ctx: TutorialCtx): boolean;
  /**
   * A picture on the card: 'trueMap' shows the practice maze with nothing
   * hidden; 'vanish' shows the same picture fading to nothing — the moment
   * the player learns the maze will be invisible from here on.
   */
  visual?: 'trueMap' | 'vanish';
}

const E = TUTORIAL_ENTRANCE; // the pawn starts here: (0, 2)
const RIVER_ENTRY = TUTORIAL_RIVER_CELLS[0]; // (0, 1) — first stepped in here

/** north bank reached (the row above the river) */
function onNorthBank(ctx: TutorialCtx): boolean {
  return ctx.pos !== null && ctx.pos.y === 0;
}

/** inside (or past) the treasure vault in the north-east corner */
function inVault(ctx: TutorialCtx): boolean {
  return ctx.hasTreasure || (ctx.pos !== null && ctx.pos.x === 4 && ctx.pos.y === 0);
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'rules',
    title: 'Welcome to the labyrinth',
    body: [
      'The game master has drawn a maze it will never show you. Somewhere inside lies a treasure 💰 — the first player to walk out through an exit carrying it wins.',
      'A turn is simple: at most ONE action (shoot, grenade, arm a mine, or pick up), then ONE step. Walking into a wall costs nothing — the GM says a wall is there, and you may try another way the same turn.',
      'This is a practice run: a tiny 5×5 maze, nobody else inside, no dangers.',
    ],
  },
  {
    id: 'sample-map',
    title: 'A sample labyrinth',
    visual: 'trueMap',
    body: [
      'Here is the very maze you are about to enter — with nothing hidden, and almost no walls: roam wherever you like. The gate at the entrance 🏁 is also the EXIT (dashed green).',
      'A river crosses the whole maze, west side to east side, flowing east. On the north bank: an arsenal 🎒 of dropped gear, and the treasure 💰 sealed in a one-wall vault. Coins 🪙 glitter in the south-east.',
      'Take a good look.',
    ],
  },
  {
    id: 'vanish',
    title: 'Now the maze hides',
    visual: 'vanish',
    body: [
      'Gone. This is how you will really see it: not at all. The maze stays hidden — you explore it blind and rediscover every wall, one answer from the game master at a time.',
      'The big grid behind this card is YOUR map: blank graph paper. Nothing ever appears on it unless you draw it — the left rail holds your pencils, the bottom bar your legs, and the GM speaks in the ticker at the bottom (tap it for the full log).',
      'Your pawn 🧍 waits on the entrance 🏁, the green gate at your back.',
    ],
  },
  {
    id: 'bump',
    title: 'Feeling the walls',
    body: [
      "You never see walls — you find them with your face. A blocked move costs nothing: the GM says a wall is there, and you may try another direction the same turn.",
    ],
    goal: 'Walk south — press ▼.',
    done: (ctx) => ctx.sawEvent('bumpedWall', 'S'),
  },
  {
    id: 'draw-wall',
    title: 'Draw what you learned',
    body: [
      "That answer is how the hidden maze reaches you — and the GM's words scroll away, so your map is your memory. Every mark mirrors something the GM said: it said 'wall south', so draw a wall south of the pawn. The ▦ walls tool is already selected.",
      '(Tapping an edge again cycles the mark: wall → open → grate → exit — stop on the thick wall line.)',
    ],
    goal: "Tap the bottom edge of your pawn's cell so a bright wall line appears.",
    done: (ctx) =>
      ctx.grid !== null && ctx.grid.h[(E.y + 1) * ctx.grid.width + E.x] === 'wall',
  },
  {
    id: 'step-north',
    title: 'Take a real step',
    body: [
      'A successful step ends your turn (in a real game, the others move between your turns). Bumps are free; steps are spent.',
      'You saw the river one row north. Step into it anyway — feel what it does.',
    ],
    goal: 'Walk north — press ▲.',
    done: (ctx) => ctx.sawEvent('riverDrift'),
  },
  {
    id: 'river',
    title: 'The river takes you',
    body: [
      'You stepped into WATER and the current dragged you one tile east. That is the rule: every time you ENTER a river tile, the current pushes you one tile downstream.',
      'Worse: START a turn standing in the river and it drags you again before you do anything. A river you have not charted can carry you clean off your own map.',
    ],
  },
  {
    id: 'draw-river',
    title: 'Chart the river',
    body: [
      'Pick the ➤ river tool in the left rail. The N/E/S/W buttons under it set the flow for a tap — or simply swipe across the tile in the direction of the current (east, here).',
    ],
    goal: 'Mark the tile you first stepped into — one west of your pawn — as river.',
    done: (ctx) => {
      if (!ctx.grid) return false;
      const cell = ctx.grid.cells[RIVER_ENTRY.y * ctx.grid.width + RIVER_ENTRY.x];
      return cell?.stamps.includes('river') ?? false;
    },
  },
  {
    id: 'ride-out',
    title: 'Get out of the water',
    body: [
      'You are still IN the river, so your next turn opens with the current dragging you once more. Let it — then step out onto the north bank, where you saw the 🎒 lying.',
    ],
    goal: 'Press ▲ — one more drag east, then the step north lands you ashore.',
    done: (ctx) => ctx.sawEvent('itemsFound') || onNorthBank(ctx),
  },
  {
    id: 'arsenal',
    title: 'An arsenal!',
    body: [
      `The 🎒 marks gear lying loose on the floor — an arsenal. Whoever steps on a stash takes ALL of it: yours just grew by 💥×${TUTORIAL_ARSENAL.items.grenades} 🔫×${TUTORIAL_ARSENAL.items.bullets} 💣×${TUTORIAL_ARSENAL.items.mines} — watch the kit counter at the bottom right.`,
      'In real games, gear also hits the floor when its owner is shot (under the drop-all house rule) — and lies there for anyone.',
    ],
  },
  {
    id: 'bump-east',
    title: 'The vault',
    body: [
      'You saw where the treasure 💰 sleeps: the far end of this bank, behind a single wall. In a real game nobody shows you — the GM only tells you when it is under your feet.',
    ],
    goal: 'Walk east along the bank until a wall stops you.',
    done: (ctx) => ctx.sawEvent('bumpedWall', 'E') || inVault(ctx),
  },
  {
    id: 'grenade',
    title: 'When walls argue, argue back',
    body: [
      'A grenade blows a plain wall to rubble. Using one is your ONE action this turn — but you may still move after it. That is the rhythm of every turn: at most one action, then one step.',
    ],
    goal: 'Select 💥 grenade, then press ▶ to blast the vault open.',
    done: (ctx) => ctx.sawEvent('wallDestroyed') || inVault(ctx),
  },
  {
    id: 'find-treasure',
    title: 'It glitters ahead',
    body: [
      'After an action the mode snaps back to 🚶 walk, so the pad is safe to press again.',
    ],
    goal: 'Step east into the vault — press ▶.',
    done: (ctx) => ctx.sawEvent('treasureHere') || ctx.hasTreasure,
  },
  {
    id: 'pickup',
    title: 'Lift it',
    body: [
      'The TREASURE lies at your feet. Lifting it is an action (the glowing button). From now on you are the most interesting person in the labyrinth: get shot, trapped or mauled while carrying it, and it drops where you fall.',
    ],
    goal: 'Press 🫳 pick up.',
    done: (ctx) => ctx.hasTreasure,
  },
  {
    id: 'coins-home',
    title: 'Head for home',
    body: [
      'Down is the fast way back: the river directly below you is its MOUTH — no downstream left, so the current cannot grab you. And you saw coins 🪙 glittering one row further.',
      'Coins and cosmetics are aesthetic loot: they bank the instant you touch them and never change the game (in real runs they fill your Wardrobe; practice loot stays here).',
    ],
    goal: 'Press ▼ twice — across the river mouth, onto the coins.',
    done: (ctx) => ctx.sawEvent('coinsFound') || (ctx.pos !== null && ctx.pos.y >= 2),
  },
  {
    id: 'escape',
    title: 'Run for daylight',
    body: [
      'Now it is your game: walk the treasure out through an EXIT. You know exactly one — the green gate you came in by, due west along the open floor.',
    ],
    goal: 'Find your way back and carry the treasure out through the green gate.',
    done: (ctx) => ctx.finished,
  },
  {
    id: 'graduated',
    title: '🎓 You know the ropes',
    body: [
      'That was the whole loop: probe blind, chart everything, spend your one action wisely, escape with the prize. The reveal behind this card shows the maze as it really was — compare it to what you drew.',
      'Real games add rivals: shoot 🔫 to make them drop the treasure, arm 💣 mines on their path, and listen — every shot and explosion echoes publicly through the maze.',
      'Bigger labyrinths stack levels with stairs, trap doors and teleport pads (that is what the auxiliary maps panel is for). Create a room and share the code, or fill it with bots.',
    ],
  },
];
