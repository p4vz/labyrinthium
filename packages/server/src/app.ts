import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db } from './persistence/db.js';
import { RoomManager } from './rooms/roomManager.js';
import { registerGameRoutes } from './routes/games.js';
import { registerMapRoutes } from './routes/maps.js';
import { handleConnection } from './ws/connection.js';

export interface BuildOptions {
  dbPath?: string;
  logger?: boolean;
  /** absolute path to the built web app; defaults to packages/web/dist if present */
  webDist?: string | null;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const db = new Db(opts.dbPath ?? process.env.LABYRINTHIUM_DB ?? 'data/labyrinthium.sqlite');
  const rooms = new RoomManager(db);

  await app.register(websocket);

  app.get('/health', async () => ({ ok: true }));

  registerMapRoutes(app, db);
  registerGameRoutes(app, db);

  // Serve the built web client when it exists (single-binary deployment).
  const here = dirname(fileURLToPath(import.meta.url));
  const defaultDist = join(here, '..', '..', 'web', 'dist');
  const webDist = opts.webDist === null ? null : (opts.webDist ?? (existsSync(defaultDist) ? defaultDist : null));
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist });
    // SPA fallback: any non-API GET renders the app shell.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'NOT_FOUND' });
    });
  }

  app.register(async (scope) => {
    scope.get('/ws', { websocket: true }, (socket) => {
      handleConnection(socket, rooms);
    });
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  // Expose for tests.
  app.decorate('rooms', rooms);
  app.decorate('db', db);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    rooms: RoomManager;
    db: Db;
  }
}
