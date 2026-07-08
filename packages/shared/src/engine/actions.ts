import { z } from 'zod';

const directionSchema = z.enum(['N', 'E', 'S', 'W', 'U', 'D']);
const planarSchema = z.enum(['N', 'E', 'S', 'W']);

/**
 * A turn is: at most ONE action (shoot / grenade / placeMine / pickup),
 * then a MOVE — the move ends the turn. 'endTurn' passes without moving,
 * and a blocked move (wall bump) costs nothing at all: the answer is free.
 * 'skip' is auto-submitted for paralyzed or timed-out players.
 */
export const playerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), direction: directionSchema }),
  z.object({ type: z.literal('shoot'), direction: planarSchema }),
  z.object({ type: z.literal('grenade'), direction: planarSchema }),
  z.object({ type: z.literal('placeMine') }),
  z.object({ type: z.literal('pickup') }),
  z.object({ type: z.literal('endTurn') }),
  z.object({ type: z.literal('skip') }),
]);

export type PlayerAction = z.infer<typeof playerActionSchema>;

export type InvalidActionCode =
  | 'GAME_FINISHED'
  | 'NOT_YOUR_TURN'
  | 'ALREADY_EXITED'
  | 'NOT_PARALYZED'
  | 'PARALYZED'
  | 'NO_AMMO'
  | 'NO_GRENADES'
  | 'NO_MINES'
  | 'NO_STAIRS_HERE'
  | 'BORDER_INDESTRUCTIBLE'
  | 'ALREADY_ACTED'
  | 'NOTHING_TO_PICK_UP';

/** Thrown before any state mutation; does not consume the turn. */
export class InvalidActionError extends Error {
  constructor(
    public code: InvalidActionCode,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidActionError';
  }
}
