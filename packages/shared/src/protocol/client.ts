import { z } from 'zod';
import { playerActionSchema } from '../engine/actions.js';
import { complexitySchema, sizePresetSchema } from '../map/presets.js';

/** House rules chosen at room creation (checkboxes on the create screen). */
export const gameRulesSchema = z
  .object({
    /** everyone hears everyone's moves and the GM's replies (classic table rules) */
    openInformation: z.boolean(),
    /** seconds per turn, 0 = untimed */
    turnTimerSeconds: z.number().int().min(0).max(600),
    /** a shot player drops ALL gear, not just the treasure */
    dropAllOnShot: z.boolean(),
    /** grenades may breach the outer wall */
    allowBorderGrenade: z.boolean(),
    /** dropped treasure drifts on rivers */
    treasureDrifts: z.boolean(),
    /** twice the starting grenades/bullets/mines */
    doubleAmmo: z.boolean(),
  })
  .partial();

export type GameRules = z.infer<typeof gameRulesSchema>;

export const botDifficultySchema = z.enum(['easy', 'medium', 'hard', 'expert']);
export type BotDifficulty = z.infer<typeof botDifficultySchema>;

/**
 * Client -> server messages. The server validates every inbound frame
 * against this schema; anything else is answered with an error message.
 */
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('session.resume'),
    token: z.string().min(1),
    lastAckedSeq: z.number().int().min(-1),
  }),
  z.object({
    type: z.literal('room.create'),
    name: z.string().min(1).max(40),
    preset: sizePresetSchema.optional(),
    complexity: complexitySchema.optional(),
    seed: z.string().max(120).optional(),
    mapId: z.string().optional(),
    rules: gameRulesSchema.optional(),
  }),
  z.object({
    type: z.literal('room.addBot'),
    difficulty: botDifficultySchema,
  }),
  // Aquarium mode: spin up a bots-only game and watch it as an observer.
  z.object({
    type: z.literal('room.createBotMatch'),
    bots: z.array(botDifficultySchema).min(2).max(8),
    preset: sizePresetSchema.optional(),
    complexity: complexitySchema.optional(),
    seed: z.string().max(120).optional(),
    mapId: z.string().optional(),
    rules: gameRulesSchema.optional(),
  }),
  z.object({
    type: z.literal('room.join'),
    roomCode: z.string().min(4).max(8),
    name: z.string().min(1).max(40),
  }),
  z.object({
    type: z.literal('room.spectate'),
    roomCode: z.string().min(4).max(8),
  }),
  // Observers (and the host) can freeze the action.
  z.object({ type: z.literal('room.pause'), paused: z.boolean() }),
  z.object({ type: z.literal('room.leave') }),
  z.object({ type: z.literal('room.start') }),
  z.object({ type: z.literal('game.action'), action: playerActionSchema }),
  // The player's hand-drawn belief maps, shared ONLY with spectators.
  z.object({ type: z.literal('maps.sync'), maps: z.unknown() }),
  z.object({ type: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
