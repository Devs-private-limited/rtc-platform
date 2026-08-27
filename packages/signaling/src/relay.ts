import type { WebSocket } from "ws";
import type { Redis } from "ioredis";
import type { ServerMessage } from "@rtc/protocol";
import type { PresenceStore } from "./store/types.js";
import { RELAY_CHANNEL } from "./store/redis.js";

interface RelayMessage {
  targetUserId: string;
  message: ServerMessage;
  fromInstance: string;
}

export class MessageRelay {
  constructor(
    private instanceId: string,
    private sockets: Map<string, WebSocket>,
    private presence: PresenceStore,
    private publisher: Redis | null,
    private subscriber: Redis | null,
    private send: (ws: WebSocket, message: ServerMessage) => void
  ) {}

  async start() {
    if (!this.subscriber) return;
    await this.subscriber.subscribe(RELAY_CHANNEL);
    this.subscriber.on("message", (channel: string, raw: string) => {
      if (channel !== RELAY_CHANNEL) return;
      try {
        const data = JSON.parse(raw) as RelayMessage;
        if (data.fromInstance === this.instanceId) return;
        const ws = this.sockets.get(data.targetUserId);
        if (ws) this.send(ws, data.message);
      } catch {
        // ignore malformed relay payloads
      }
    });
  }

  async sendToUser(userId: string, message: ServerMessage): Promise<boolean> {
    const local = this.sockets.get(userId);
    if (local) {
      this.send(local, message);
      return true;
    }

    const instance = await this.presence.getInstance(userId);
    if (!instance) return false;

    if (this.publisher) {
      const payload: RelayMessage = {
        targetUserId: userId,
        message,
        fromInstance: this.instanceId,
      };
      await this.publisher.publish(RELAY_CHANNEL, JSON.stringify(payload));
      return true;
    }

    return false;
  }

  async stop() {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(RELAY_CHANNEL);
    }
  }
}
