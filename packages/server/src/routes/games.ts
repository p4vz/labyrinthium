import type { FastifyInstance } from 'fastify';
import type { Db } from '../persistence/db.js';

/** Finished-game history for the replay viewer. */
export function registerGameRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/games', async () => ({ games: db.listGames() }));

  app.get('/api/games/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const game = db.getGame(id);
    if (!game) return reply.code(404).send({ error: 'GAME_NOT_FOUND' });
    return game;
  });
}
