import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { Db } from './persistence/db.js';
import { RoomManager } from './rooms/roomManager.js';
import { registerMapRoutes } from './routes/maps.js';
import { handleConnection } from './ws/connection.js';

export interface BuildOptions {
  dbPath?: string;
  logger?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const db = new Db(opts.dbPath ?? process.env.LABYRINTHIUM_DB ?? 'data/labyrinthium.sqlite');
  const rooms = new RoomManager(db);

  await app.register(websocket);

  app.get('/health', async () => ({ ok: true }));

  registerMapRoutes(app, db);

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
