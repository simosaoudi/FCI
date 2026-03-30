import { Injectable, signal } from '@angular/core';
import { Client, IMessage } from '@stomp/stompjs';
import * as SockJSNS from 'sockjs-client';
import { TrafficSnapshot } from '../models';

@Injectable({ providedIn: 'root' })
export class TrafficWsService {
  private client: Client | null = null;

  readonly connected = signal(false);
  readonly lastMessage = signal<TrafficSnapshot | null>(null);
  readonly snapshotsByTlsId = signal<Record<string, TrafficSnapshot>>({});

  connect(): void {
    if (this.client) return;

    const SockJSAny = (SockJSNS as unknown as { default?: any })?.default ?? (SockJSNS as unknown as any);
    const socketFactory = () => new SockJSAny('/ws');

    const client = new Client({
      webSocketFactory: socketFactory,
      reconnectDelay: 2000,
      heartbeatIncoming: 0,
      heartbeatOutgoing: 20000
    });

    client.onConnect = () => {
      this.connected.set(true);
      client.subscribe('/topic/traffic', (msg: IMessage) => {
        try {
          const parsed = JSON.parse(msg.body) as TrafficSnapshot;
          this.lastMessage.set(parsed);
          if (parsed?.tlsId) {
            this.snapshotsByTlsId.update((prev) => ({ ...prev, [parsed.tlsId]: parsed }));
          }
        } catch {
          // ignore parse errors
        }
      });
    };

    client.onWebSocketClose = () => {
      this.connected.set(false);
    };

    client.activate();
    this.client = client;
  }

  disconnect(): void {
    if (!this.client) return;
    this.client.deactivate();
    this.client = null;
    this.connected.set(false);
  }
}
