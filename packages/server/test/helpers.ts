import WebSocket from 'ws';
import type { ClientMessage, MapDocument, ServerMessage } from '@labyrinthium/shared';
import { createEdgeGrid, setEdge } from '@labyrinthium/shared';

/** Tiny promise-based WS test client with an inbox you can await on. */
export class TestClient {
  private ws: WebSocket;
  private inbox: ServerMessage[] = [];
  private waiters: { match: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  readonly all: ServerMessage[] = [];
  private opened: Promise<void>;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.opened = new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      this.all.push(msg);
      const waiter = this.waiters.find((w) => w.match(msg));
      if (waiter) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(msg);
      } else {
        this.inbox.push(msg);
      }
    });
  }

  async ready(): Promise<void> {
    await this.opened;
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Await the next message of a given type (checks buffered ones first). */
  async next<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const buffered = this.inbox.findIndex((m) => m.type === type);
    if (buffered >= 0) {
      return this.inbox.splice(buffered, 1)[0] as Extract<ServerMessage, { type: T }>;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${type}; saw: ${this.all.map((m) => m.type).join(',')}`)),
        timeoutMs,
      );
      this.waiters.push({
        match: (m) => m.type === type,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }

  /** All buffered messages of a type, consumed. */
  drain<T extends ServerMessage['type']>(type: T): Extract<ServerMessage, { type: T }>[] {
    const out = this.inbox.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[];
    this.inbox = this.inbox.filter((m) => m.type !== type);
    return out;
  }

  close(): void {
    this.ws.close();
  }
}

/** 3×3 all-open arena: entrance (0,0), treasure (1,0), exit east of (2,0). */
export function simpleTestMap(): MapDocument {
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
    levels: [{ width: 3, height: 3, edges, features: [] }],
    entrance: { level: 0, x: 0, y: 0 },
    spawns: { treasure: { level: 0, x: 1, y: 0 }, monsters: [] },
    metadata: { name: 'integration arena' },
  };
}
