import type {
  Consumer,
  MediaKind,
  PlainTransport,
  Producer,
  Router,
  RtpCapabilities,
  Transport,
  WebRtcTransport,
  Worker,
} from "mediasoup/types";

/** Most cameras on at once in one room (group video). */
export const MAX_CAMERAS = Math.max(2, Number(process.env.SFU_MAX_CAMERAS) || 8);
/** Extra sending room for a shared screen (text must stay readable). */
export const SCREEN_BITRATE = 1_200_000;
const AUDIO_BITRATE = 100_000;
/** How long a peer may stay unreachable before its media is removed. */
const DISCONNECT_GRACE_MS = 30_000;

/**
 * Camera bitrate per sender by how many cameras are on: everyone receives every other camera, so
 * bigger calls send smaller video (phones show small tiles anyway). Keeps group video affordable.
 */
export function cameraBitrate(cameras: number) {
  if (cameras <= 2) return 1_000_000; // 1:1: about 720p
  if (cameras <= 4) return 600_000; // about 480p/360p tiles
  return 350_000; // 5-8 people: about 360p/240p tiles
}

/** Refused because the room already has the most cameras allowed. */
export class CameraLimitError extends Error {
  constructor(max: number) {
    super(`This video call already has ${max} cameras on, the most allowed, so you joined without your camera. Leave and join again to turn it on after someone leaves.`);
    this.name = "CameraLimitError";
  }
}

/** Would one more camera from `peerId` go over the limit? (A peer replacing its own camera is fine.) */
export function cameraLimitReached(cameraPeers: Iterable<string>, peerId: string, max = MAX_CAMERAS) {
  const others = new Set(cameraPeers);
  others.delete(peerId);
  return others.size >= max;
}

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
  private shuttingDown = false;

  constructor(private announcedIp: string) {}

  isReady() {
    return Boolean(this.worker) && !this.shuttingDown;
  }

  async start() {
    const mediasoup = await import("mediasoup");
    this.worker = await mediasoup.createWorker({
      rtcMinPort: 40000,
      rtcMaxPort: 40100,
      logLevel: "warn",
    });
    this.worker.on("died", () => {
      console.error("mediasoup worker died");
      if (!this.shuttingDown) process.exit(1);
    });
  }

  async stop() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    for (const room of this.rooms.values()) {
      for (const peer of room.peers.values()) {
        for (const consumer of peer.consumers.values()) consumer.close();
        for (const producer of peer.producers.values()) producer.close();
        for (const transport of peer.transports.values()) transport.close();
      }
      room.router.close();
    }
    this.rooms.clear();

    if (this.worker) {
      this.worker.close();
      this.worker = null;
    }
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
          {
            kind: "video",
            mimeType: "video/VP8",
            clockRate: 90000,
          },
          {
            kind: "video",
            mimeType: "video/H264",
            clockRate: 90000,
            parameters: {
              "packetization-mode": 1,
              "profile-level-id": "42e01f",
              "level-asymmetry-allowed": 1,
            },
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
      listenIps: [{ ip: "0.0.0.0", announcedIp: this.announcedIp }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });
    peer.transports.set(transport.id, transport);
    // Someone left (closed the connection) or lost the network for good: remove their media, so
    // the camera count and others' video quality follow who is really in the call.
    let lost: ReturnType<typeof setTimeout> | null = null;
    transport.on("dtlsstatechange", (state) => {
      if (state === "closed" || state === "failed") this.dropTransport(roomId, peerId, transport.id);
    });
    transport.on("icestatechange", (state) => {
      if (lost) clearTimeout(lost);
      lost = null;
      if (state === "disconnected") {
        lost = setTimeout(() => {
          if (transport.iceState === "disconnected") this.dropTransport(roomId, peerId, transport.id);
        }, DISCONNECT_GRACE_MS);
        lost.unref?.();
      }
    });
    transport.observer.on("close", () => {
      if (lost) clearTimeout(lost);
    });
    return transport;
  }

  /** Close one transport (and everything on it); forget the peer when nothing is left. */
  dropTransport(roomId: string, peerId: string, transportId: string) {
    const room = this.getRoom(roomId);
    const peer = room?.peers.get(peerId);
    const transport = peer?.transports.get(transportId);
    if (!room || !peer || !transport) return;
    if (!transport.closed) transport.close();
    peer.transports.delete(transportId);
    for (const [id, producer] of peer.producers) if (producer.closed) peer.producers.delete(id);
    for (const [id, consumer] of peer.consumers) if (consumer.closed) peer.consumers.delete(id);
    if (peer.transports.size === 0) room.peers.delete(peerId);
    this.applyBitrates(room);
  }

  /** Peers with a camera on right now. */
  cameraPeers(room: SfuRoom) {
    const ids: string[] = [];
    for (const [peerId, peer] of room.peers) {
      for (const producer of peer.producers.values()) {
        const source = (producer.appData as { source?: string })?.source;
        if (!producer.closed && producer.kind === "video" && source === "camera") {
          ids.push(peerId);
          break;
        }
      }
    }
    return ids;
  }

  /** Tell every sender how much it may send now (the browser/phone lowers its video to fit). */
  applyBitrates(room: SfuRoom) {
    const perCamera = cameraBitrate(this.cameraPeers(room).length);
    for (const peer of room.peers.values()) {
      for (const transport of peer.transports.values()) {
        if (transport.closed) continue;
        let camera = false;
        let screen = false;
        for (const producer of peer.producers.values()) {
          const appData = producer.appData as { source?: string; transportId?: string };
          if (producer.closed || appData.transportId !== transport.id || producer.kind !== "video") continue;
          if (appData.source === "screen") screen = true;
          else camera = true;
        }
        if (!camera && !screen) continue;
        const max = AUDIO_BITRATE + (camera ? perCamera : 0) + (screen ? SCREEN_BITRATE : 0);
        transport.setMaxIncomingBitrate(max).catch(() => {});
      }
    }
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
    rtpParameters: Parameters<WebRtcTransport["produce"]>[0]["rtpParameters"],
    source?: "camera" | "screen" | "microphone"
  ) {
    const transport = this.getTransport(roomId, peerId, transportId) as WebRtcTransport | null;
    if (!transport) throw new Error("Transport not found");
    const room = this.getRoom(roomId)!;
    const finalSource = source || (kind === "audio" ? "microphone" : "camera");
    if (kind === "video" && finalSource === "camera" && cameraLimitReached(this.cameraPeers(room), peerId)) {
      throw new CameraLimitError(MAX_CAMERAS);
    }
    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData: { source: finalSource, transportId },
    });
    const peer = room.getOrCreatePeer(peerId);
    peer.producers.set(producer.id, producer);
    producer.observer.on("close", () => {
      peer.producers.delete(producer.id);
      this.applyBitrates(room);
    });
    this.applyBitrates(room);
    return producer;
  }

  async consume(
    roomId: string,
    peerId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities
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
    consumer.observer.on("close", () => peer.consumers.delete(consumer.id));
    return consumer;
  }

  listProducers(roomId: string, excludePeerId?: string) {
    const room = this.getRoom(roomId);
    if (!room) return [];
    const items: { producerId: string; peerId: string; kind: MediaKind; source: string }[] = [];
    for (const [peerId, peer] of room.peers) {
      if (peerId === excludePeerId) continue;
      for (const producer of peer.producers.values()) {
        const source = (producer.appData as { source?: string })?.source || (producer.kind === "audio" ? "microphone" : "camera");
        items.push({ producerId: producer.id, peerId, kind: producer.kind, source });
      }
    }
    return items;
  }

  /** The owner stopped this media (e.g. screen share). Its consumers close on the server too. */
  closeProducer(roomId: string, peerId: string, producerId: string) {
    const peer = this.getRoom(roomId)?.peers.get(peerId);
    const producer = peer?.producers.get(producerId);
    if (!peer || !producer) return false;
    producer.close();
    peer.producers.delete(producerId);
    return true;
  }

  async createPlainConsumers(
    roomId: string,
    opts: { videoProducerId: string; audioProducerId?: string }
  ) {
    const room = this.getRoom(roomId);
    if (!room) return null;

    const findProducer = (id: string): Producer | null => {
      for (const peer of room.peers.values()) {
        const producer = peer.producers.get(id);
        if (producer) return producer;
      }
      return null;
    };

    if (!findProducer(opts.videoProducerId)) return null;

    const videoTransport = await room.router.createPlainTransport({
      listenIp: { ip: "127.0.0.1", announcedIp: "127.0.0.1" },
      rtcpMux: false,
      comedia: true,
    });

    const videoConsumer = await videoTransport.consume({
      producerId: opts.videoProducerId,
      rtpCapabilities: room.router.rtpCapabilities,
      paused: false,
    });
    await videoConsumer.resume();

    let audioTransport: PlainTransport | null = null;
    let audioConsumer: Consumer | null = null;

    if (opts.audioProducerId && findProducer(opts.audioProducerId)) {
      audioTransport = await room.router.createPlainTransport({
        listenIp: { ip: "127.0.0.1", announcedIp: "127.0.0.1" },
        rtcpMux: false,
        comedia: true,
      });
      audioConsumer = await audioTransport.consume({
        producerId: opts.audioProducerId,
        rtpCapabilities: room.router.rtpCapabilities,
        paused: false,
      });
      await audioConsumer.resume();
    }

    const consumers: Consumer[] = [videoConsumer];
    if (audioConsumer) consumers.push(audioConsumer);

    return {
      transport: videoTransport,
      videoTransport,
      audioTransport,
      consumers,
      videoConsumer,
      audioConsumer,
    };
  }
}
