import WebSocket from 'ws';
import type { ClientMessage, ServerMessage } from '@labyrinthium/shared';

export class GameClient {
  private ws: WebSocket;
  onMessage: (msg: ServerMessage) => void = () => {};
  onClose: () => void = () => {};

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (raw) => {
      this.onMessage(JSON.parse(String(raw)) as ServerMessage);
    });
    this.ws.on('close', () => this.onClose());
  }

  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws.close();
  }
}
