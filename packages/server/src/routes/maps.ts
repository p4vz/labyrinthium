import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  complexitySchema,
  generateMap,
  mapDocumentSchema,
  sizePresetSchema,
  validateMap,
} from '@labyrinthium/shared';
import type { Db } from '../persistence/db.js';

const generateBodySchema = z.object({
  preset: sizePresetSchema.default('medium'),
  complexity: complexitySchema.default('classic'),
  seed: z.string().max(120).optional(),
});

/** Map editor backend: CRUD + validate + generate. */
export function registerMapRoutes(app: FastifyInstance, db: Db): void {
  app.post('/api/maps', async (req, reply) => {
    const parsed = mapDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_DOCUMENT', issues: parsed.error.issues });
    }
    const id = randomUUID();
    db.saveMap(id, parsed.data.metadata.name ?? 'untitled', parsed.data);
    return reply.code(201).send({ id });
  });

  app.get('/api/maps', async () => ({ maps: db.listMaps() }));

  app.get('/api/maps/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const found = db.getMap(id);
    if (!found) return reply.code(404).send({ error: 'MAP_NOT_FOUND' });
    return found;
  });

  app.put('/api/maps/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!db.getMap(id)) return reply.code(404).send({ error: 'MAP_NOT_FOUND' });
    const parsed = mapDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_DOCUMENT', issues: parsed.error.issues });
    }
    db.saveMap(id, parsed.data.metadata.name ?? 'untitled', parsed.data);
    return { id };
  });

  app.delete('/api/maps/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!db.deleteMap(id)) return reply.code(404).send({ error: 'MAP_NOT_FOUND' });
    return { deleted: id };
  });

  // Same checker the generator uses — structured issues for editor highlighting.
  app.post('/api/maps/validate', async (req, reply) => {
    const parsed = mapDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_DOCUMENT', issues: parsed.error.issues });
    }
    return validateMap(parsed.data);
  });

  app.post('/api/maps/generate', async (req, reply) => {
    const parsed = generateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'INVALID_REQUEST', issues: parsed.error.issues });
    }
    const seed = parsed.data.seed ?? randomUUID().slice(0, 8);
    const map = generateMap({ preset: parsed.data.preset, complexity: parsed.data.complexity, seed });
    return { map, seed };
  });
}
