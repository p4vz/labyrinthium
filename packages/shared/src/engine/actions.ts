import { z } from 'zod';

const directionSchema = z.enum(['N', 'E', 'S', 'W', 'U', 'D']);
const planarSchema = z.enum(['N', 'E', 'S', 'W']);

/**
 * One player turn = one action. 'skip' is only legal for paralyzed players
 * (the server auto-submits it on their behalf so the game never stalls).
 */
export const playerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), direction: directionSchema }),
  z.object({ type: z.literal('shoot'), direction: planarSchema }),
  z.object({ type: z.literal('grenade'), direction: planarSchema }),
  z.object({ type: z.literal('placeMine') }),
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
  | 'BORDER_INDESTRUCTIBLE';

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
