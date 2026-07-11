import type { PlayerGrid } from '../state/playerMap.js';
import {
  TUTORIAL_ENTRANCE,
  TUTORIAL_COINS,
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
}

const E = TUTORIAL_ENTRANCE; // the pawn starts here: (0, 2)
const RIVER_HEAD = TUTORIAL_RIVER_CELLS[0]; // (1, 2) — drifted FROM here

/** the player broke through (or walked around) into the treasure corridor */
function inTreasureCorridor(ctx: TutorialCtx): boolean {
  return ctx.pos !== null && ctx.pos.y === 1 && ctx.pos.x >= 2;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to the labyrinth',
    body: [
      'The computer has drawn a maze it will never show you. You walk it blind: declare a move, and the game master tells you — and only you — what happened.',
      'This is a practice run: a tiny 5×5 maze, nobody else inside, no dangers. Everything you learn here is the real game.',
    ],
  },
  {
    id: 'tour',
    title: 'Your tools',
    body: [
      'The dark grid in the middle is YOUR map — blank graph paper. Nothing ever appears on it unless you draw it.',
      'Left rail: drawing tools. Bottom: your actions and the walk pad. The game master speaks in the ticker at the bottom — tap it to read the full log.',
      'Your pawn 🧍 stands on the entrance 🏁. The dashed green gate behind you is also the EXIT: first one to walk out carrying the treasure wins.',
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
      "The GM's words scroll away — your map is your memory. The ▦ walls tool is already selected.",
      '(Tapping an edge again cycles the mark: wall → open → grate → exit — stop on the thick wall line.)',
    ],
    goal: "Tap the bottom edge of your pawn's cell so a bright wall line appears.",
    done: (ctx) =>
      ctx.grid !== null && ctx.grid.h[(E.y + 1) * ctx.grid.width + E.x] === 'wall',
  },
  {
    id: 'step-east',
    title: 'Take a real step',
    body: [
      'A successful step ends your turn (in a real game, the others move between your turns). Bumps are free; steps are spent.',
    ],
    goal: 'Walk east — press ▶.',
    done: (ctx) => ctx.sawEvent('moved', 'E'),
  },
  {
    id: 'river',
    title: 'The river takes you',
    body: [
      'You stepped into WATER. Rivers run through these mazes: every time you enter a river tile — or start your turn in one — the current drags you one tile downstream.',
      'The GM said it dragged you north, so you now stand at the river\'s mouth, one tile further than you meant to go. Losing people is the river\'s favorite trick: chart it, or it will fool you twice.',
    ],
  },
  {
    id: 'draw-river',
    title: 'Chart the river',
    body: [
      'Pick the ➤ river tool in the left rail. The N/E/S/W buttons under it set the flow for a tap — or simply swipe across the tile in the direction of the current (north, here).',
    ],
    goal: 'Mark the tile you drifted from — one south of your pawn — as river.',
    done: (ctx) => {
      if (!ctx.grid) return false;
      const cell = ctx.grid.cells[RIVER_HEAD.y * ctx.grid.width + RIVER_HEAD.x];
      return cell?.stamps.includes('river') ?? false;
    },
  },
  {
    id: 'bump-east',
    title: 'Onward',
    body: [
      'Somewhere in these halls lies the treasure 💰. The GM will tell you when it is under your feet — never before.',
    ],
    goal: 'Try walking east — press ▶.',
    done: (ctx) => ctx.sawEvent('bumpedWall', 'E') || inTreasureCorridor(ctx),
  },
  {
    id: 'grenade',
    title: 'When walls argue, argue back',
    body: [
      'Your starting kit sits bottom-right: 💥×2 grenades, 🔫×2 bullets, 💣×1 mine. A grenade blows a plain wall to rubble.',
      'Using one is your ONE action this turn — but you may still move after it. That is the rhythm of every turn: at most one action, then one step.',
    ],
    goal: 'Select 💥 grenade, then press ▶ to blast the wall east of you.',
    done: (ctx) => ctx.sawEvent('wallDestroyed') || inTreasureCorridor(ctx),
  },
  {
    id: 'through',
    title: 'Walk the rubble',
    body: [
      'After an action the mode snaps back to 🚶 walk, so the pad is safe to press again.',
    ],
    goal: 'Step east through the hole — press ▶.',
    done: (ctx) => ctx.sawEvent('coinsFound') || inTreasureCorridor(ctx),
  },
  {
    id: 'coins',
    title: 'Loot!',
    body: [
      `You scooped 🪙 ${TUTORIAL_COINS.amount} coins just by stepping on them. Coins and cosmetics are aesthetic loot — they never change the game.`,
      'In real runs, coins bank straight to your character (spend them in the Wardrobe); rarer finds must be CARRIED out alive. Practice loot stays in the practice maze.',
    ],
  },
  {
    id: 'find-treasure',
    title: 'It glitters ahead',
    body: ['Keep going — the GM will sing out when you stand on it.'],
    goal: 'Walk east once more — press ▶.',
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
    id: 'escape',
    title: 'Run for daylight',
    body: [
      'Now walk it out through an EXIT. You know exactly one: the green gate you came in by.',
      'The way back: ◀ ◀ ◀ west (through the rubble, past the river mouth), then ▼ south, then ◀ west through the gate. The river cannot grab you — its mouth has no downstream.',
    ],
    goal: 'Carry the treasure out through the green gate.',
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
