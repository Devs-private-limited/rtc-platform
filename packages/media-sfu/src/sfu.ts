import type {
  Consumer,
  MediaKind,
  Producer,
  Router,
  Transport,
  WebRtcTransport,
  Worker,
} from "mediasoup/node/lib/types.js";

export interface Peer {
  id: string;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

export class SfuRoom {
  router: Router;
  peers = new Map<string, Peer>();

  constructor(router: Router) {
    this.router = router;
  }

  getOrCreatePeer(peerId: string): Peer {
    if (!this.peers.has(peerId)) {
      this.peers.set(peerId, {
        id: peerId,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
      });
    }
    return this.peers.get(peerId)!;
  }
}

export class SfuManager {
  private worker: Worker | null = null;
  private rooms = new Map<string, SfuRoom>();

  async start() {
    const mediasoup = await import("mediasoup");
    this.worker = await mediasoup.createWorker({
      rtcMinPort: 40000,
      rtcMaxPort: 40100,
      logLevel: "warn",
    });
    this.worker.on("died", () => {
      console.error("mediasoup worker died");
      process.exit(1);
    });
  }

  async getOrCreateRoom(roomId: string) {
    if (!this.worker) throw new Error("SFU worker not started");
    if (!this.rooms.has(roomId)) {
      const router = await this.worker.createRouter({
        mediaCodecs: [
          {
            kind: "audio",
            mimeType: "audio/opus",
            clockRate: 48000,
            channels: 2,
          },
        ],
      });
      this.rooms.set(roomId, new SfuRoom(router));
    }
    return this.rooms.get(roomId)!;
  }

  getRoom(roomId: string) {
    return this.rooms.get(roomId) || null;
  }

  async createTransport(roomId: string, peerId: string) {
    const room = await this.getOrCreateRoom(roomId);
    const peer = room.getOrCreatePeer(peerId);
    const transport = await room.router.createWebRtcTransport({
      listenIps: [{ ip: "0.0.0.0", announcedIp: process.env.ANNOUNCED_IP || "127.0.0.1" }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
    peer.transports.set(transport.id, transport);
    return transport;
  }

  getTransport(roomId: string, peerId: string, transportId: string): Transport | null {
    const room = this.getRoom(roomId);
    if (!room) return null;
    const peer = room.peers.get(peerId);
    return peer?.transports.get(transportId) || null;
  }

  async produce(
    roomId: string,
    peerId: string,
    transportId: string,
    kind: MediaKind,
    rtpParameters: Parameters<WebRtcTransport["produce"]>[0]["rtpParameters"]
  ) {
    const transport = this.getTransport(roomId, peerId, transportId) as WebRtcTransport | null;
    if (!transport) throw new Error("Transport not found");
    const producer = await transport.produce({ kind, rtpParameters });
    const room = this.getRoom(roomId)!;
    const peer = room.getOrCreatePeer(peerId);
    peer.producers.set(producer.id, producer);
    return producer;
  }

  async consume(
    roomId: string,
    peerId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: Parameters<Router["canConsume"]>[1]
  ) {
    const room = this.getRoom(roomId);
    if (!room) throw new Error("Room not found");
    if (!room.router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error("Cannot consume");
    }
    const transport = this.getTransport(roomId, peerId, transportId) as WebRtcTransport | null;
    if (!transport) throw new Error("Transport not found");

    const producer = [...room.peers.values()]
      .flatMap((p) => [...p.producers.values()])
      .find((p) => p.id === producerId);
    if (!producer) throw new Error("Producer not found");

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: false,
    });
    const peer = room.getOrCreatePeer(peerId);
    peer.consumers.set(consumer.id, consumer);
    return consumer;
  }

  listProducers(roomId: string, excludePeerId?: string) {
    const room = this.getRoom(roomId);
    if (!room) return [];
    const items: { producerId: string; peerId: string; kind: MediaKind }[] = [];
    for (const [peerId, peer] of room.peers) {
      if (peerId === excludePeerId) continue;
      for (const producer of peer.producers.values()) {
        items.push({ producerId: producer.id, peerId, kind: producer.kind });
      }
    }
    return items;
  }
}
