import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  buyBodySchema,
  createProfileBodySchema,
  displayNameBodySchema,
  equipBodySchema,
  loginBodySchema,
  upgradeProfileBodySchema,
} from '@labyrinthium/shared';
import type { ProfileRow } from '../persistence/db.js';
import { ProfileError, type ProfileService } from '../profiles/service.js';

function bearerToken(req: FastifyRequest): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

function publicProfile(service: ProfileService, profile: ProfileRow) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    username: profile.username,
    coins: profile.coins,
    avatar: service.avatarOf(profile),
  };
}

const PROFILE_ERROR_STATUS: Record<ProfileError['code'], number> = {
  BAD_CREDENTIALS: 401,
  USERNAME_TAKEN: 409,
  ALREADY_UPGRADED: 409,
  ALREADY_PURCHASED: 409,
  NOT_ENOUGH_COINS: 402,
  NOT_OWNED: 403,
  UNKNOWN_OFFER: 404,
};

/** Profile + wardrobe + shop API for the cosmetics meta-layer. */
export function registerProfileRoutes(app: FastifyInstance, profiles: ProfileService): void {
  const authed = (req: FastifyRequest, reply: FastifyReply): ProfileRow | null => {
    const profile = profiles.authenticate(bearerToken(req));
    if (!profile) void reply.code(401).send({ error: 'INVALID_TOKEN' });
    return profile;
  };

  const sendProfileError = (reply: FastifyReply, err: unknown): FastifyReply => {
    if (err instanceof ProfileError) {
      return reply.code(PROFILE_ERROR_STATUS[err.code]).send({ error: err.code, message: err.message });
    }
    throw err;
  };

  // Guest bootstrap: mint a profile with zero friction. The token is the key
  // to everything — the client keeps it in localStorage.
  app.post('/api/profile', async (req, reply) => {
    const parsed = createProfileBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const { profile, token } = profiles.createGuest(parsed.data.displayName ?? '');
    return reply.code(201).send({ token, profile: publicProfile(profiles, profile) });
  });

  app.get('/api/profile', async (req, reply) => {
    const profile = authed(req, reply);
    if (!profile) return reply;
    return {
      profile: publicProfile(profiles, profile),
      items: profiles.items(profile.id),
      collection: profiles.collection(profile.id),
    };
  });

  // Secure the guest profile behind a username+password (optional, once).
  app.post('/api/profile/upgrade', async (req, reply) => {
    const profile = authed(req, reply);
    if (!profile) return reply;
    const parsed = upgradeProfileBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    try {
      profiles.upgrade(profile.id, parsed.data.username, parsed.data.password);
    } catch (err) {
      return sendProfileError(reply, err);
    }
    return { ok: true, username: parsed.data.username };
  });

  app.post('/api/profile/login', async (req, reply) => {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    try {
      const { profile, token } = profiles.login(parsed.data.username, parsed.data.password);
      return { token, profile: publicProfile(profiles, profile) };
    } catch (err) {
      return sendProfileError(reply, err);
    }
  });

  app.put('/api/profile/equipped', async (req, reply) => {
    const profile = authed(req, reply);
    if (!profile) return reply;
    const parsed = equipBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    try {
      profiles.equip(profile.id, parsed.data.avatar);
    } catch (err) {
      return sendProfileError(reply, err);
    }
    return { ok: true, avatar: parsed.data.avatar };
  });

  app.put('/api/profile/name', async (req, reply) => {
    const profile = authed(req, reply);
    if (!profile) return reply;
    const parsed = displayNameBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    profiles.setDisplayName(profile.id, parsed.data.displayName);
    return { ok: true };
  });

  app.get('/api/shop', async (req, reply) => {
    const profile = authed(req, reply);
    if (!profile) return reply;
    return profiles.shop(profile.id);
  });

  app.post('/api/shop/buy', async (req, reply) => {
    const profile = authed(req, reply);
    if (!profile) return reply;
    const parsed = buyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    try {
      return profiles.buy(profile.id, parsed.data.offerId);
    } catch (err) {
      return sendProfileError(reply, err);
    }
  });
}
