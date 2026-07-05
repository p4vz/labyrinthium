import { z } from 'zod';
import { playerActionSchema } from '../engine/actions.js';
import { complexitySchema, sizePresetSchema } from '../map/presets.js';

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
  z.object({ type: z.literal('room.leave') }),
  z.object({ type: z.literal('room.start') }),
  z.object({ type: z.literal('game.action'), action: playerActionSchema }),
  z.object({ type: z.literal('ping') }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
