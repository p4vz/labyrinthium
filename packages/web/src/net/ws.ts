import type { ClientMessage, ServerMessage } from '@labyrinthium/shared';
import { loadSession, useGameStore } from '../state/gameStore.js';

/**
 * Singleton WebSocket connection with auto-reconnect. On (re)connect, if a
 * stored session exists, it resumes it — the server replays the missed
 * visible-event tail.
 */
let socket: WebSocket | null = null;
let retryDelay = 500;
let intentionallyClosed = false;

/**
 * An in-browser game master (the tutorial) can claim the outbound channel:
 * messages it handles never touch the socket, everything else flows on.
 */
let localHandler: ((msg: ClientMessage) => boolean) | null = null;

export function setLocalHandler(handler: ((msg: ClientMessage) => boolean) | null): void {
  localHandler = handler;
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function connect(): void {
  intentionallyClosed = false;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  socket = new WebSocket(wsUrl());
  socket.onopen = () => {
    retryDelay = 500;
    useGameStore.getState().setConnected(true);
    const session = loadSession();
    if (session) {
      send({
        type: 'session.resume',
        token: session.token,
        lastAckedSeq: useGameStore.getState().lastAckedSeq,
      });
    }
  };
  socket.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as ServerMessage;
    useGameStore.getState().handleMessage(msg);
  };
  socket.onclose = () => {
    useGameStore.getState().setConnected(false);
    socket = null;
    if (!intentionallyClosed) {
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 8000);
    }
  };
  socket.onerror = () => {
    socket?.close();
  };
}

export function send(msg: ClientMessage): void {
  if (localHandler?.(msg)) return;
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  } else {
    useGameStore.getState().handleMessage({
      type: 'error',
      code: 'DISCONNECTED',
      message: 'not connected to the server yet',
    });
  }
}

export function disconnect(): void {
  intentionallyClosed = true;
  socket?.close();
  socket = null;
}
