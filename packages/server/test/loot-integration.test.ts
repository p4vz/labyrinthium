import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createEdgeGrid, setEdge, type CosmeticItem, type MapDocument } from '@labyrinthium/shared';
import { buildApp } from '../src/app.js';
import { TestClient } from './helpers.js';

let app: FastifyInstance;
let wsUrl: string;

beforeAll(async () => {
  app = await buildApp({ dbPath: ':memory:' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (typeof address === 'string' || !address) throw new Error('no address');
  wsUrl = `ws://127.0.0.1:${address.port}/ws`;
});

afterAll(async () => {
  await app.close();
});

function item(id: string, rarity: CosmeticItem['rarity']): CosmeticItem {
  return {
    id,
    slot: 'hat',
    templateId: 'straw-hat',
    rarity,
    paletteId: 'moss',
    name: rarity === 'rare' ? 'Gilded Straw Hat of the Deep' : 'Straw Hat',
    provenance: { mapSeed: 'loot-arena' },
  };
}

/**
 * 3×3 all-open arena with loot laid along the east wall:
 * entrance (0,0), treasure parked far away at (2,2), exit east of (2,0),
 * coins at (1,0), a common at (2,0), a rare at (2,1).
 */
function lootArena(): MapDocument {
  const edges = createEdgeGrid(3, 3, 'open');
  for (let x = 0; x < 3; x++) {
    setEdge(edges, { x, y: 0 }, 'N', 'wall');
    setEdge(edges, { x, y: 2 }, 'S', 'wall');
  }
  for (let y = 0; y < 3; y++) {
    setEdge(edges, { x: 0, y }, 'W', 'wall');
    setEdge(edges, { x: 2, y }, 'E', 'wall');
  }
  setEdge(edges, { x: 2, y: 0 }, 'E', 'exit');
  return {
    version: 1,
    levels: [
      {
        width: 3,
        height: 3,
        edges,
        features: [
          { type: 'coins', at: { x: 1, y: 0 }, amount: 7 },
          { type: 'cosmetic', at: { x: 2, y: 0 }, item: item('common-1', 'common') },
          { type: 'cosmetic', at: { x: 2, y: 1 }, item: item('rare-1', 'rare') },
        ],
      },
    ],
    entrance: { level: 0, x: 0, y: 0 },
    spawns: { treasure: { level: 0, x: 2, y: 2 }, monsters: [] },
    metadata: { name: 'loot arena', seed: 'loot-arena' },
  };
}

async function storeMap(doc: MapDocument): Promise<string> {
  const stored = await app.inject({ method: 'POST', url: '/api/maps', payload: doc });
  expect(stored.statusCode).toBe(201);
  return (stored.json() as { id: string }).id;
}

async function createProfile(name: string): Promise<{ token: string; id: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/profile', payload: { displayName: name } });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { token: string; profile: { id: string } };
  return { token: body.token, id: body.profile.id };
}

describe('loot over WebSockets, banked to profiles', () => {
  it('banks commons/coins mid-game, rares on walk-out; lootSummary and winnerless end', async () => {
    const mapId = await storeMap(lootArena());
    const { token } = await createProfile('Ariadne');

    const alice = new TestClient(wsUrl);
    await alice.ready();
    alice.send({ type: 'room.create', name: 'Ariadne', mapId, profileToken: token });
    await alice.next('session.created');
    const roomState = await alice.next('room.state');
    // the profile's avatar rides along in the lobby roster
    expect(roomState.players[0]!.avatar?.skinToneId).toBe('skin-2');
    alice.send({ type: 'room.start' });
    const started = await alice.next('game.started');
    expect(started.rules.allowLeave).toBe(true);
    expect(started.turnOrder[0]!.avatar).toBeDefined();

    // walk east: coins at (1,0), common at (2,0)
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });
    await alice.next('game.turn');
    await alice.next('game.turn');

    // commons and coins are already banked — mid-game, before any finish
    const midGame = await app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: `Bearer ${token}` },
    });
    const midBody = midGame.json() as {
      profile: { coins: number };
      items: { item: CosmeticItem }[];
      collection: { hat: { discovered: string[] } };
    };
    expect(midBody.profile.coins).toBe(7);
    expect(midBody.items.map((i) => i.item.id)).toEqual(['common-1']);
    expect(midBody.collection.hat.discovered).toContain('straw-hat');

    // grab the rare at (2,1), come back and walk out without the treasure
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'S' } });
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'N' } });
    alice.send({ type: 'game.action', action: { type: 'leave', direction: 'E' } });

    const finished = await alice.next('game.finished');
    expect(finished.winnerId).toBe(''); // sole player left: nobody won
    expect(finished.lootSummary).toHaveLength(1);
    expect(finished.lootSummary[0]).toMatchObject({ coins: 7, left: true, lostRares: 0 });
    expect(finished.lootSummary[0]!.bankedItems.map((i) => i.id).sort()).toEqual(['common-1', 'rare-1']);

    // the rare reached the profile stamped as extracted alive
    const after = await app.inject({
      method: 'GET',
      url: '/api/profile',
      headers: { authorization: `Bearer ${token}` },
    });
    const afterBody = after.json() as { items: { item: CosmeticItem }[] };
    const rare = afterBody.items.find((i) => i.item.id === 'rare-1');
    expect(rare?.item.provenance?.extractedAlive).toBe(true);
    expect(rare?.item.provenance?.mapSeed).toBe('loot-arena');

    // the winnerless finish is in the feed
    const allEvents = alice.all
      .filter((m): m is Extract<typeof m, { type: 'game.events' }> => m.type === 'game.events')
      .flatMap((m) => m.events.map((e) => e.payload.type));
    expect(allEvents).toContain('gameEndedNoWinner');
    expect(allEvents).toContain('rareLootBanked');
    alice.close();
  });

  it('anonymous players play loot maps fine and nothing is persisted for them', async () => {
    const mapId = await storeMap(lootArena());
    const alice = new TestClient(wsUrl);
    await alice.ready();
    alice.send({ type: 'room.create', name: 'Anon', mapId }); // no profileToken
    await alice.next('session.created');
    alice.send({ type: 'room.start' });
    await alice.next('game.started');

    // scoop loot, then win properly via the treasure at (2,2)
    for (const direction of ['E', 'E', 'S', 'S'] as const) {
      alice.send({ type: 'game.action', action: { type: 'move', direction } });
    }
    alice.send({ type: 'game.action', action: { type: 'pickup' } });
    for (const direction of ['N', 'N', 'E'] as const) {
      alice.send({ type: 'game.action', action: { type: 'move', direction } });
    }
    const finished = await alice.next('game.finished');
    expect(finished.winnerName).toBe('Anon');
    // loot still shows in the summary (state tracked it) — it just went nowhere
    expect(finished.lootSummary[0]!.coins).toBe(7);
    alice.close();
  });

  it('an invalid profile token degrades to anonymous play with a non-fatal error', async () => {
    const mapId = await storeMap(lootArena());
    const alice = new TestClient(wsUrl);
    await alice.ready();
    alice.send({ type: 'room.create', name: 'Stale', mapId, profileToken: 'expired-token' });
    const err = await alice.next('error');
    expect(err.code).toBe('PROFILE_TOKEN_INVALID');
    const session = await alice.next('session.created');
    expect(session.roomCode).toBeTruthy();
    const roomState = await alice.next('room.state');
    expect(roomState.players[0]!.avatar).toBeUndefined();
    alice.close();
  });

  it('allowLeave: false blocks the walk-out at the engine level', async () => {
    const mapId = await storeMap(lootArena());
    const alice = new TestClient(wsUrl);
    await alice.ready();
    alice.send({ type: 'room.create', name: 'Purist', mapId, rules: { allowLeave: false } });
    await alice.next('session.created');
    alice.send({ type: 'room.start' });
    const started = await alice.next('game.started');
    expect(started.rules.allowLeave).toBe(false);
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });
    alice.send({ type: 'game.action', action: { type: 'leave', direction: 'E' } });
    const err = await alice.next('error');
    expect(err.code).toBe('LEAVING_DISABLED');
    alice.close();
  });
});
