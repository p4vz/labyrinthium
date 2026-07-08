import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { simpleTestMap, TestClient } from './helpers.js';

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

describe('REST map API', () => {
  it('generates valid maps on demand', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/maps/generate',
      payload: { preset: 'medium', complexity: 'advanced', seed: 'demo' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { map: unknown; seed: string };
    expect(body.seed).toBe('demo');

    const validation = await app.inject({ method: 'POST', url: '/api/maps/validate', payload: body.map });
    expect(validation.json()).toMatchObject({ ok: true, issues: [] });
  });

  it('stores, lists, fetches and deletes maps', async () => {
    const doc = simpleTestMap();
    const created = await app.inject({ method: 'POST', url: '/api/maps', payload: doc });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    const listed = await app.inject({ method: 'GET', url: '/api/maps' });
    expect((listed.json() as { maps: { id: string }[] }).maps.some((m) => m.id === id)).toBe(true);

    const fetched = await app.inject({ method: 'GET', url: '/api/maps/' + id });
    expect(fetched.statusCode).toBe(200);

    const deleted = await app.inject({ method: 'DELETE', url: '/api/maps/' + id });
    expect(deleted.statusCode).toBe(200);
    const gone = await app.inject({ method: 'GET', url: '/api/maps/' + id });
    expect(gone.statusCode).toBe(404);
  });

  it('rejects structurally broken maps with structured issues', async () => {
    const doc = simpleTestMap();
    doc.entrance = { level: 0, x: 1, y: 1 }; // not on the border
    const res = await app.inject({ method: 'POST', url: '/api/maps/validate', payload: doc });
    const body = res.json() as { ok: boolean; issues: { code: string }[] };
    expect(body.ok).toBe(false);
    expect(body.issues.map((i) => i.code)).toContain('ENTRANCE_INVALID');
  });
});

describe('full game over WebSockets', () => {
  it('two players race for the treasure; private and public events differ; the winner is announced', async () => {
    // Store a hand-built map so the run is fully scripted. Secret-GM rules:
    // this test asserts the whisper variant's privacy guarantees.
    const stored = await app.inject({ method: 'POST', url: '/api/maps', payload: simpleTestMap() });
    const { id: mapId } = stored.json() as { id: string };

    const alice = new TestClient(wsUrl);
    const bob = new TestClient(wsUrl);
    await alice.ready();
    await bob.ready();

    alice.send({ type: 'room.create', name: 'Alice', mapId, rules: { openInformation: false } });
    const aliceSession = await alice.next('session.created');
    bob.send({ type: 'room.join', roomCode: aliceSession.roomCode, name: 'Bob' });
    const bobSession = await bob.next('session.created');

    alice.send({ type: 'room.start' });
    const aliceStart = await alice.next('game.started');
    const bobStart = await bob.next('game.started');
    expect(aliceStart.yourPlayerId).toBe(aliceSession.playerId);
    expect(bobStart.yourPlayerId).toBe(bobSession.playerId);
    // Players learn dimensions + entrance, nothing else about the map.
    expect(aliceStart.levelSizes).toEqual([{ width: 3, height: 3 }]);
    expect(aliceStart.entrance).toMatchObject({ x: 0, y: 0 });

    const turn1 = await alice.next('game.turn');
    expect(turn1.activePlayerId).toBe(aliceSession.playerId);

    // Alice: E (finds treasure), Bob: S; Alice: pickup + E; Bob: N; Alice: E -> exits.
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });
    const aliceMoved = await alice.next('game.events');
    const types = aliceMoved.events.map((e) => e.payload.type);
    expect(types).toEqual(expect.arrayContaining(['moved', 'treasureHere']));

    await bob.next('game.turn');
    bob.send({ type: 'game.action', action: { type: 'move', direction: 'S' } });
    await bob.next('game.events');

    await alice.next('game.turn');
    alice.send({ type: 'game.action', action: { type: 'pickup' } }); // the action...
    const picked = await alice.next('game.events');
    expect(picked.events.map((e) => e.payload.type)).toContain('treasurePickedUp');
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } }); // ...then the move
    await alice.next('game.events');

    await bob.next('game.turn');
    bob.send({ type: 'game.action', action: { type: 'move', direction: 'N' } });
    await bob.next('game.events');

    await alice.next('game.turn');
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });

    const aliceFinish = await alice.next('game.finished');
    const bobFinish = await bob.next('game.finished');
    expect(aliceFinish.winnerId).toBe(aliceSession.playerId);
    expect(bobFinish.winnerName).toBe('Alice');
    expect(bobFinish.mapReveal.levels).toHaveLength(1); // the reveal

    // Visibility: Bob never saw Alice's private movement events.
    const bobEventTypes = bob.all
      .filter((m): m is Extract<typeof m, { type: 'game.events' }> => m.type === 'game.events')
      .flatMap((m) => m.events)
      .map((e) => `${e.visibility.kind}:${e.payload.type}`);
    expect(bobEventTypes.every((t) => !t.startsWith('private:') || !t.includes('treasurePickedUp'))).toBe(true);
    const bobSawAliceMoves = bob.all
      .filter((m): m is Extract<typeof m, { type: 'game.events' }> => m.type === 'game.events')
      .flatMap((m) => m.events)
      .some((e) => e.visibility.kind === 'private' && e.visibility.playerId !== bobSession.playerId);
    expect(bobSawAliceMoves).toBe(false);

    alice.close();
    bob.close();
  });

  it('shots are heard publicly but only the victim learns they were hit (secret rules)', async () => {
    const stored = await app.inject({ method: 'POST', url: '/api/maps', payload: simpleTestMap() });
    const { id: mapId } = stored.json() as { id: string };

    const alice = new TestClient(wsUrl);
    const bob = new TestClient(wsUrl);
    await alice.ready();
    await bob.ready();

    alice.send({ type: 'room.create', name: 'Alice', mapId, rules: { openInformation: false } });
    const aliceSession = await alice.next('session.created');
    bob.send({ type: 'room.join', roomCode: aliceSession.roomCode, name: 'Bob' });
    const bobSession = await bob.next('session.created');
    alice.send({ type: 'room.start' });
    await alice.next('game.started');
    await bob.next('game.started');

    // Alice steps east onto the treasure and lifts it; Bob shoots her.
    await alice.next('game.turn');
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });
    await alice.next('game.events');
    await bob.next('game.turn');
    bob.send({ type: 'game.action', action: { type: 'endTurn' } }); // Bob bides his time
    await bob.next('game.events'); // ...and hears himself announced
    await alice.next('game.turn');
    alice.send({ type: 'game.action', action: { type: 'pickup' } });
    await alice.next('game.events');
    alice.send({ type: 'game.action', action: { type: 'endTurn' } });
    await alice.next('game.events'); // her own end-turn announcement
    await bob.next('game.turn');
    bob.send({ type: 'game.action', action: { type: 'shoot', direction: 'E' } });

    const bobEvents = (await bob.next('game.events')).events.map((e) => e.payload.type);
    expect(bobEvents).toEqual(expect.arrayContaining(['shotFired', 'screamHeard']));
    expect(bobEvents).not.toContain('youWereShot');

    const aliceEvents = (await alice.next('game.events')).events;
    const aliceTypes = aliceEvents.map((e) => e.payload.type);
    expect(aliceTypes).toContain('youWereShot');
    expect(aliceTypes).toContain('treasureDropped');

    // Alice is paralyzed: once Bob ends his turn, hers is auto-skipped and
    // control comes straight back to him.
    bob.drain('game.turn'); // clear stale turn announcements
    bob.send({ type: 'game.action', action: { type: 'endTurn' } });
    const t1 = await bob.next('game.turn');
    expect(t1.activePlayerId).toBe(aliceSession.playerId); // her turn opens...
    const t2 = await bob.next('game.turn');
    expect(t2.activePlayerId).toBe(bobSession.playerId); // ...and is skipped at once

    alice.close();
    bob.close();
  });

  it('a disconnected player can resume by token and receives the missed event tail', async () => {
    const stored = await app.inject({ method: 'POST', url: '/api/maps', payload: simpleTestMap() });
    const { id: mapId } = stored.json() as { id: string };

    const alice = new TestClient(wsUrl);
    const bob = new TestClient(wsUrl);
    await alice.ready();
    await bob.ready();

    alice.send({ type: 'room.create', name: 'Alice', mapId });
    const aliceSession = await alice.next('session.created');
    bob.send({ type: 'room.join', roomCode: aliceSession.roomCode, name: 'Bob' });
    const bobSession = await bob.next('session.created');
    alice.send({ type: 'room.start' });
    await alice.next('game.started');
    await bob.next('game.started');
    await alice.next('game.turn');

    // Bob drops off the face of the earth.
    bob.close();
    await new Promise((r) => setTimeout(r, 100));

    // Alice keeps playing: her move + a public shot Bob must catch up on.
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'S' } });
    await alice.next('game.events');

    // Bob reconnects with his session token.
    const bob2 = new TestClient(wsUrl);
    await bob2.ready();
    bob2.send({ type: 'session.resume', token: bobSession.sessionToken, lastAckedSeq: -1 });
    const resumed = await bob2.next('session.created');
    expect(resumed.playerId).toBe(bobSession.playerId);
    await bob2.next('room.state');
    await bob2.next('game.started');

    // It's Bob's turn now (Alice already moved) — he can act immediately.
    const turn = await bob2.next('game.turn');
    expect(turn.activePlayerId).toBe(bobSession.playerId);
    bob2.send({ type: 'game.action', action: { type: 'move', direction: 'S' } });
    const events = await bob2.next('game.events');
    expect(events.events.map((e) => e.payload.type)).toContain('moved');

    alice.close();
    bob2.close();
  });

  it('spectators see public events only, and finished games are replayable via the API', async () => {
    const stored = await app.inject({ method: 'POST', url: '/api/maps', payload: simpleTestMap() });
    const { id: mapId } = stored.json() as { id: string };

    const alice = new TestClient(wsUrl);
    const bob = new TestClient(wsUrl);
    const watcher = new TestClient(wsUrl);
    await alice.ready();
    await bob.ready();
    await watcher.ready();

    alice.send({ type: 'room.create', name: 'Alice', mapId, rules: { openInformation: false } });
    const aliceSession = await alice.next('session.created');
    bob.send({ type: 'room.join', roomCode: aliceSession.roomCode, name: 'Bob' });
    await bob.next('session.created');

    watcher.send({ type: 'room.spectate', roomCode: aliceSession.roomCode });
    await watcher.next('room.state');

    alice.send({ type: 'room.start' });
    await alice.next('game.started');
    const watcherStart = await watcher.next('game.started');
    expect(watcherStart.yourPlayerId).toBe(''); // spectators have no identity

    // Alice: E (treasure) -> pickup+E; Bob makes noise; Alice walks out.
    await alice.next('game.turn');
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });
    await alice.next('game.events');
    await bob.next('game.turn');
    bob.send({ type: 'game.action', action: { type: 'shoot', direction: 'S' } });
    await bob.next('game.events');
    bob.send({ type: 'game.action', action: { type: 'move', direction: 'S' } }); // the shot kept his turn open
    await bob.next('game.events');
    await alice.next('game.turn');
    alice.send({ type: 'game.action', action: { type: 'pickup' } });
    await alice.next('game.events');
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });
    await alice.next('game.events');
    await bob.next('game.turn');
    bob.send({ type: 'game.action', action: { type: 'move', direction: 'N' } });
    await bob.next('game.events');
    await alice.next('game.turn');
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });

    const watcherFinish = await watcher.next('game.finished');
    expect(watcherFinish.winnerName).toBe('Alice');

    // Spectator only ever received public events.
    const watcherEvents = watcher.all
      .filter((m): m is Extract<typeof m, { type: 'game.events' }> => m.type === 'game.events')
      .flatMap((m) => m.events);
    expect(watcherEvents.length).toBeGreaterThan(0); // heard the shot at least
    expect(watcherEvents.every((e) => e.visibility.kind === 'public')).toBe(true);

    // The finished game is in the history API with its full action log.
    const list = await app.inject({ method: 'GET', url: '/api/games' });
    const games = (list.json() as { games: { id: string; winnerId: string }[] }).games;
    expect(games.length).toBeGreaterThan(0);
    const record = await app.inject({ method: 'GET', url: '/api/games/' + games[0]!.id });
    const body = record.json() as { actions: unknown[]; map: { levels: unknown[] }; seed: string };
    expect(body.actions.length).toBeGreaterThan(0);
    expect(body.map.levels).toHaveLength(1);

    alice.close();
    bob.close();
    watcher.close();
  });

  it('open information (default): everyone hears every move and every GM reply', async () => {
    const stored = await app.inject({ method: 'POST', url: '/api/maps', payload: simpleTestMap() });
    const { id: mapId } = stored.json() as { id: string };

    const alice = new TestClient(wsUrl);
    const bob = new TestClient(wsUrl);
    await alice.ready();
    await bob.ready();
    alice.send({ type: 'room.create', name: 'Alice', mapId });
    const aliceSession = await alice.next('session.created');
    bob.send({ type: 'room.join', roomCode: aliceSession.roomCode, name: 'Bob' });
    await bob.next('session.created');
    alice.send({ type: 'room.start' });
    const started = await bob.next('game.started');
    expect(started.rules.openInformation).toBe(true);

    await alice.next('game.turn');
    alice.send({ type: 'game.action', action: { type: 'move', direction: 'E' } });

    // Bob hears the declaration AND the GM's reply to Alice.
    const bobEvents = (await bob.next('game.events')).events;
    const types = bobEvents.map((e) => e.payload.type);
    expect(types).toContain('actionAnnounced');
    expect(types).toContain('moved'); // Alice's private observation, delivered to Bob
    expect(types).toContain('treasureHere'); // even the loot call-out is table-public
    const announce = bobEvents.find((e) => e.payload.type === 'actionAnnounced');
    expect(announce?.payload).toMatchObject({ playerName: 'Alice', action: 'move', direction: 'E' });

    alice.close();
    bob.close();
  });

  it('AI bots join, play legally, and a medium bot wins while the host idles', async () => {
    process.env.BOT_DELAY_MS = '1';
    const stored = await app.inject({ method: 'POST', url: '/api/maps', payload: simpleTestMap() });
    const { id: mapId } = stored.json() as { id: string };

    const host = new TestClient(wsUrl);
    await host.ready();
    host.send({ type: 'room.create', name: 'Idle Ida', mapId });
    const session = await host.next('session.created');
    host.send({ type: 'room.addBot', difficulty: 'medium' });
    await host.next('room.playerJoined');
    // room.state is broadcast on create AND on addBot — wait for the roster with the bot.
    let roomState = await host.next('room.state');
    while (roomState.players.length < 2) roomState = await host.next('room.state');
    expect(roomState.players.some((p) => p.isBot)).toBe(true);

    host.send({ type: 'room.start' });
    await host.next('game.started');

    // The host only ever bumps the western border; the bot must win.
    const finished = new Promise<{ winnerName: string }>((resolve) => {
      const poll = async (): Promise<void> => {
        for (;;) {
          const msg = await host.next('game.finished', 30000);
          resolve(msg);
          return;
        }
      };
      void poll();
    });
    const idle = async (): Promise<void> => {
      for (let i = 0; i < 500; i++) {
        const turn = await host.next('game.turn', 30000).catch(() => null);
        if (!turn) return;
        if (turn.activePlayerId === session.playerId) {
          // Bumping the border no longer ends a turn — pass explicitly.
          host.send({ type: 'game.action', action: { type: 'endTurn' } });
        }
      }
    };
    void idle();

    const result = await finished;
    expect(result.winnerName).toContain('medium');

    host.close();
    delete process.env.BOT_DELAY_MS;
  }, 40000);

  it('the turn timer skips players who stall', async () => {
    const stored = await app.inject({ method: 'POST', url: '/api/maps', payload: simpleTestMap() });
    const { id: mapId } = stored.json() as { id: string };

    const alice = new TestClient(wsUrl);
    const bob = new TestClient(wsUrl);
    await alice.ready();
    await bob.ready();
    alice.send({ type: 'room.create', name: 'Alice', mapId, rules: { turnTimerSeconds: 1 } });
    const aliceSession = await alice.next('session.created');
    bob.send({ type: 'room.join', roomCode: aliceSession.roomCode, name: 'Bob' });
    const bobSession = await bob.next('session.created');
    alice.send({ type: 'room.start' });
    await bob.next('game.started');

    // Alice stalls; the clock fires; the turn passes to Bob.
    const events = await bob.next('game.events', 5000);
    expect(events.events.some((e) => e.payload.type === 'turnTimedOut')).toBe(true);
    let turn = await bob.next('game.turn', 5000);
    while (turn.activePlayerId !== bobSession.playerId) {
      turn = await bob.next('game.turn', 5000);
    }
    expect(turn.activePlayerId).toBe(bobSession.playerId);

    alice.close();
    bob.close();
  }, 15000);

  it('bot matches: bots-only game starts instantly with the caller observing', async () => {
    process.env.BOT_DELAY_MS = '1';
    const stored = await app.inject({ method: 'POST', url: '/api/maps', payload: simpleTestMap() });
    const { id: mapId } = stored.json() as { id: string };

    const watcher = new TestClient(wsUrl);
    await watcher.ready();
    watcher.send({ type: 'room.createBotMatch', bots: ['medium', 'medium'], mapId });

    const started = await watcher.next('game.started');
    expect(started.yourPlayerId).toBe(''); // we are the observer
    expect(started.turnOrder).toHaveLength(2);
    expect(started.turnOrder.every((p) => p.name.includes('Bot'))).toBe(true);

    const reveal = await watcher.next('spectate.reveal');
    expect(reveal.map.levels).toHaveLength(1); // the unlocked truth

    // The bots' own belief maps stream in as they explore.
    const botMap = await watcher.next('spectate.maps', 20000);
    expect(botMap.playerName).toContain('Bot');

    const finished = await watcher.next('game.finished', 30000);
    expect(finished.winnerName).toContain('Bot');

    watcher.close();
    delete process.env.BOT_DELAY_MS;
  }, 40000);

  it('rejects out-of-turn actions with a protocol error', async () => {
    const stored = await app.inject({ method: 'POST', url: '/api/maps', payload: simpleTestMap() });
    const { id: mapId } = stored.json() as { id: string };

    const alice = new TestClient(wsUrl);
    const bob = new TestClient(wsUrl);
    await alice.ready();
    await bob.ready();
    alice.send({ type: 'room.create', name: 'Alice', mapId });
    const aliceSession = await alice.next('session.created');
    bob.send({ type: 'room.join', roomCode: aliceSession.roomCode, name: 'Bob' });
    await bob.next('session.created');
    alice.send({ type: 'room.start' });
    await bob.next('game.started');

    bob.send({ type: 'game.action', action: { type: 'move', direction: 'E' } }); // Alice's turn!
    const err = await bob.next('error');
    expect(err.code).toBe('NOT_YOUR_TURN');

    alice.close();
    bob.close();
  });
});
