import type { WebSocket } from 'ws';
import {
  clientMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from '@labyrinthium/shared';
import { RoomError, type Room, type RoomPlayer } from '../rooms/room.js';
import type { RoomManager } from '../rooms/roomManager.js';

interface ConnectionState {
  room: Room | null;
  player: RoomPlayer | null;
  spectating: Room | null;
}

export function handleConnection(socket: WebSocket, rooms: RoomManager): void {
  const conn: ConnectionState = { room: null, player: null, spectating: null };

  const send = (msg: ServerMessage): void => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  socket.on('message', (raw: Buffer | string) => {
    let msg: ClientMessage;
    try {
      const parsed = clientMessageSchema.safeParse(JSON.parse(String(raw)));
      if (!parsed.success) {
        send({ type: 'error', code: 'BAD_MESSAGE', message: parsed.error.issues[0]?.message ?? 'invalid message' });
        return;
      }
      msg = parsed.data;
    } catch {
      send({ type: 'error', code: 'BAD_JSON', message: 'message is not valid JSON' });
      return;
    }

    try {
      dispatch(msg);
    } catch (err) {
      if (err instanceof RoomError) {
        send({ type: 'error', code: err.code, message: err.message });
      } else {
        console.error('unexpected error handling message', err);
        send({ type: 'error', code: 'INTERNAL', message: 'internal server error' });
      }
    }
  });

  socket.on('close', () => {
    if (conn.player) {
      conn.player.send = null;
      conn.room?.broadcast({ type: 'room.playerLeft', playerId: conn.player.id });
      conn.room?.broadcast(conn.room.roomStateMessage());
    }
    conn.spectating?.spectators.delete(send);
  });

  function dispatch(msg: ClientMessage): void {
    switch (msg.type) {
      case 'ping':
        send({ type: 'pong' });
        return;

      case 'room.create': {
        const room = rooms.createRoom({
          ...(msg.preset !== undefined ? { preset: msg.preset } : {}),
          ...(msg.complexity !== undefined ? { complexity: msg.complexity } : {}),
          ...(msg.seed !== undefined ? { seed: msg.seed } : {}),
          ...(msg.mapId !== undefined ? { mapId: msg.mapId } : {}),
          ...(msg.rules !== undefined ? { rules: msg.rules } : {}),
        });
        const { player } = rooms.join(room.code, msg.name);
        bind(room, player);
        send({
          type: 'session.created',
          playerId: player.id,
          sessionToken: player.sessionToken,
          roomCode: room.code,
        });
        room.broadcast(room.roomStateMessage());
        return;
      }

      case 'room.join': {
        const { room, player } = rooms.join(msg.roomCode, msg.name);
        bind(room, player);
        send({
          type: 'session.created',
          playerId: player.id,
          sessionToken: player.sessionToken,
          roomCode: room.code,
        });
        room.broadcast({ type: 'room.playerJoined', playerId: player.id, name: player.name });
        room.broadcast(room.roomStateMessage());
        return;
      }

      case 'session.resume': {
        const found = rooms.resume(msg.token);
        if (!found) throw new RoomError('SESSION_NOT_FOUND', 'unknown session token');
        bind(found.room, found.player);
        send({
          type: 'session.created',
          playerId: found.player.id,
          sessionToken: found.player.sessionToken,
          roomCode: found.room.code,
        });
        send(found.room.roomStateMessage());
        if (found.room.phase !== 'lobby') {
          send(found.room.gameStartedMessage(found.player.id));
          const tail = found.room.eventsSince(found.player.id, msg.lastAckedSeq);
          if (tail.length > 0) send({ type: 'game.events', events: tail });
          if (found.room.state && found.room.phase === 'inProgress') {
            const active = found.room.state.players[found.room.state.turnIndex]!;
            send({
              type: 'game.turn',
              activePlayerId: active.id,
              turnNumber: found.room.state.turnNumber,
              canAct: !found.room.state.actedThisTurn,
            });
          }
        }
        found.room.broadcast({ type: 'room.playerReconnected', playerId: found.player.id });
        return;
      }

      case 'room.spectate': {
        const room = rooms.get(msg.roomCode);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', `no room ${msg.roomCode}`);
        conn.spectating?.spectators.delete(send);
        conn.spectating = room;
        room.spectators.add(send);
        send(room.roomStateMessage());
        if (room.phase !== 'lobby') {
          send(room.gameStartedMessage(''));
          // Observers see everything: the true map, live positions, and
          // every player's hand-drawn map so far.
          send({ type: 'spectate.reveal', map: room.map });
          const live = room.spectatorStateMessage();
          if (live) send(live);
          for (const [playerId, maps] of room.beliefMaps) {
            const p = room.players.find((x) => x.id === playerId);
            send({ type: 'spectate.maps', playerId, playerName: p?.name ?? '?', maps });
          }
          const tail = room.eventsSince('', -1);
          if (tail.length > 0) send({ type: 'game.events', events: tail });
          if (room.state && room.phase === 'inProgress') {
            const active = room.state.players[room.state.turnIndex]!;
            send({
              type: 'game.turn',
              activePlayerId: active.id,
              turnNumber: room.state.turnNumber,
              canAct: !room.state.actedThisTurn,
            });
          }
        }
        return;
      }

      case 'room.createBotMatch': {
        // Aquarium mode: a bots-only game with this connection observing.
        const room = rooms.createRoom({
          ...(msg.preset !== undefined ? { preset: msg.preset } : {}),
          ...(msg.complexity !== undefined ? { complexity: msg.complexity } : {}),
          ...(msg.seed !== undefined ? { seed: msg.seed } : {}),
          ...(msg.mapId !== undefined ? { mapId: msg.mapId } : {}),
          ...(msg.rules !== undefined ? { rules: msg.rules } : {}),
        });
        for (const difficulty of msg.bots) room.addBot(difficulty);
        conn.spectating?.spectators.delete(send);
        conn.spectating = room;
        room.spectators.add(send);
        room.start(); // delivers game.started + reveal + live state to us
        send(room.roomStateMessage());
        return;
      }

      case 'maps.sync': {
        requireRoom();
        conn.room!.handleMapsSync(conn.player!.id, msg.maps);
        return;
      }

      case 'room.leave': {
        if (conn.player) {
          conn.player.send = null;
          conn.room?.broadcast({ type: 'room.playerLeft', playerId: conn.player.id });
          conn.room?.broadcast(conn.room.roomStateMessage());
        }
        conn.room = null;
        conn.player = null;
        return;
      }

      case 'room.addBot': {
        requireRoom();
        if (conn.player!.id !== conn.room!.hostId) {
          throw new RoomError('NOT_HOST', 'only the host can add AI players');
        }
        const bot = conn.room!.addBot(msg.difficulty);
        conn.room!.broadcast({ type: 'room.playerJoined', playerId: bot.id, name: bot.name });
        conn.room!.broadcast(conn.room!.roomStateMessage());
        return;
      }

      case 'room.start': {
        requireRoom();
        if (conn.player!.id !== conn.room!.hostId) {
          throw new RoomError('NOT_HOST', 'only the host can start the game');
        }
        conn.room!.start();
        conn.room!.broadcast(conn.room!.roomStateMessage());
        return;
      }

      case 'game.action': {
        requireRoom();
        conn.room!.handleAction(conn.player!.id, msg.action);
        return;
      }
    }
  }

  function bind(room: Room, player: RoomPlayer): void {
    conn.room = room;
    conn.player = player;
    player.send = send;
  }

  function requireRoom(): void {
    if (!conn.room || !conn.player) throw new RoomError('NO_ROOM', 'join a room first');
  }
}
