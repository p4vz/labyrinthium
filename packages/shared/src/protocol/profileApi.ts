import { z } from 'zod';
import { avatarConfigSchema } from '../cosmetics/items.js';

/**
 * REST bodies for the profile/wardrobe API, shared so the web client and the
 * server validate the same shapes. Auth is a bearer token: guests get one on
 * first visit; upgrading to username+password just secures the same profile.
 */

export const createProfileBodySchema = z.object({
  displayName: z.string().trim().min(1).max(40).optional(),
});

export const upgradeProfileBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_-]+$/, 'letters, digits, _ and - only'),
  password: z.string().min(6).max(200),
});

export const loginBodySchema = z.object({
  username: z.string().trim().min(1).max(24),
  password: z.string().min(1).max(200),
});

export const equipBodySchema = z.object({
  avatar: avatarConfigSchema,
});

export const displayNameBodySchema = z.object({
  displayName: z.string().trim().min(1).max(40),
});

export const buyBodySchema = z.object({
  offerId: z.string().min(1).max(60),
});
