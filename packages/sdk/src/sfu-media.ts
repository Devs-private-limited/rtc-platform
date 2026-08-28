import * as mediasoupClient from "mediasoup-client";
import type { SfuProducerPayload } from "@rtc/protocol";
import type { SignalingSend } from "./types.js";

type Device = mediasoupClient.types.Device;
type Transport = mediasoupClient.types.Transport;
type Producer = mediasoupClient.types.Producer;
type Consumer = mediasoupClient.types.Consumer;
type MediaKind = mediasoupClient.types.MediaKind;

export type MediaSource = "camera" | "screen" | "microphone";

export interface MediaJoinOptions {
  callId?: string;
  targetUserId?: string;
  announceToRoom?: boolean;
  audio?: boolean;
  video?: boolean;
}

export interface RemoteTrackInfo {
  producerId: string;
  userId: string;
  kind: MediaKind;
  source?: MediaSource;
  stream: MediaStream;
}

export type OnRemoteTrack = (info: RemoteTrackInfo) => void;

export class SfuMediaEngine {
  private device: Device | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producers = new Map<string, Producer>();
  private consumers = new Map<string, Consumer>();
  private remoteAudios = new Map<string, HTMLAudioElement>();
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private roomId: string | null = null;
  private producerMeta = new Map<string, { source: MediaSource; kind: MediaKind }>();
  private pendingProduceSource: MediaSource = "microphone";

  constructor(
    private sfuUrl: string,
    private userId: string,
    private sendSignal: SignalingSend,
    private onRemoteTrack?: OnRemoteTrack
  ) {}

  async joinRoom(roomId: string, options: MediaJoinOptions = {}) {
    const audio = options.audio !== false;
    const video = options.video === true;
    this.roomId = roomId;
    const base = this.sfuUrl.replace(/\/$/, "");

    const joinRes = await fetch(`${base}/v1/rooms/${encodeURIComponent(roomId)}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peerId: this.userId }),
    });
    if (!joinRes.ok) throw new Error("Failed to join SFU room");
    const { rtpCapabilities } = await joinRes.json();

    this.device = new mediasoupClient.Device();
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });

    await this.createSendTransport(base, roomId, options);
    await this.createRecvTransport(base, roomId);
    if (audio || video) {
      await this.publishCameraMic(base, roomId, options, { audio, video });
    }
    await this.consumeExisting(base, roomId);
  }

  async handleRemoteProducer(payload: SfuProducerPayload) {
    if (!this.roomId || payload.roomId !== this.roomId) return;
    if (payload.fromUserId === this.userId) return;
    if (this.consumers.has(payload.producerId)) return;
    await this.consumeProducer(
      this.sfuUrl.replace(/\/$/, ""),
      this.roomId,
      payload.producerId,
      payload.fromUserId,
      payload.kind,
      payload.source
    );
  }

  async shareScreen(options?: { callId?: string; targetUserId?: string; announceToRoom?: boolean }) {
    if (!this.sendTransport || !this.roomId) throw new Error("Not in SFU room");
    if (this.screenStream) await this.stopScreenShare();

    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const track = this.screenStream.getVideoTracks()[0];
    track.onended = () => void this.stopScreenShare();

    this.pendingProduceSource = "screen";
    const producer = await this.sendTransport.produce({ track });
    this.producers.set("screen", producer);
    this.producerMeta.set(producer.id, { source: "screen", kind: "video" });
  }

  async stopScreenShare() {
    const producer = this.producers.get("screen");
    producer?.close();
    this.producers.delete("screen");
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
  }

  muteMicrophone(muted: boolean) {
    const producer = this.producers.get("microphone");
    if (producer) {
      if (muted) void producer.pause();
      else void producer.resume();
    }
    this.localStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  muteCamera(muted: boolean) {
    const producer = this.producers.get("camera");
    if (producer) {
      if (muted) void producer.pause();
      else void producer.resume();
    }
    this.localStream?.getVideoTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }

  getLocalStream() {
    return this.localStream;
  }

  private async createSendTransport(
    base: string,
    roomId: string,
    options: MediaJoinOptions
  ) {
    const res = await fetch(`${base}/v1/rooms/${encodeURIComponent(roomId)}/transports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peerId: this.userId }),
    });
    const transportInfo = await res.json();

    this.sendTransport = this.device!.createSendTransport({
      id: transportInfo.id,
      iceParameters: transportInfo.iceParameters,
      iceCandidates: transportInfo.iceCandidates,
      dtlsParameters: transportInfo.dtlsParameters,
    });

    this.sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        await fetch(
          `${base}/v1/rooms/${encodeURIComponent(roomId)}/transports/${transportInfo.id}/connect`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ peerId: this.userId, dtlsParameters }),
          }
        );
        callback();
      } catch (error) {
        errback(error as Error);
      }
    });

    this.sendTransport.on("produce", async ({ kind, rtpParameters }, callback, errback) => {
      try {
        const produceRes = await fetch(
          `${base}/v1/rooms/${encodeURIComponent(roomId)}/transports/${transportInfo.id}/produce`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ peerId: this.userId, kind, rtpParameters }),
          }
        );
        const { producerId } = await produceRes.json();
        callback({ id: producerId });

        const source = this.pendingProduceSource;

        this.sendSignal({
          type: "sfu_producer",
          payload: {
            roomId,
            producerId,
            toUserId: options?.targetUserId,
            callId: options?.callId,
            kind,
            source: source === "microphone" ? undefined : source,
          },
        });
      } catch (error) {
        errback(error as Error);
      }
    });
  }

  private async createRecvTransport(base: string, roomId: string) {
    const res = await fetch(`${base}/v1/rooms/${encodeURIComponent(roomId)}/transports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peerId: this.userId }),
    });
    const transportInfo = await res.json();

    this.recvTransport = this.device!.createRecvTransport({
      id: transportInfo.id,
      iceParameters: transportInfo.iceParameters,
      iceCandidates: transportInfo.iceCandidates,
      dtlsParameters: transportInfo.dtlsParameters,
    });

    this.recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
      try {
        await fetch(
          `${base}/v1/rooms/${encodeURIComponent(roomId)}/transports/${transportInfo.id}/connect`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ peerId: this.userId, dtlsParameters }),
          }
        );
        callback();
      } catch (error) {
        errback(error as Error);
      }
    });
  }

  private async publishCameraMic(
    _base: string,
    _roomId: string,
    _options: MediaJoinOptions,
    media: { audio: boolean; video: boolean }
  ) {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: media.audio,
      video: media.video,
    });

    if (media.audio) {
      const track = this.localStream.getAudioTracks()[0];
      if (track) {
        this.pendingProduceSource = "microphone";
        const producer = await this.sendTransport!.produce({ track });
        this.producers.set("microphone", producer);
        this.producerMeta.set(producer.id, { source: "microphone", kind: "audio" });
      }
    }

    if (media.video) {
      const track = this.localStream.getVideoTracks()[0];
      if (track) {
        this.pendingProduceSource = "camera";
        const producer = await this.sendTransport!.produce({ track });
        this.producers.set("camera", producer);
        this.producerMeta.set(producer.id, { source: "camera", kind: "video" });
      }
    }
  }

  private async consumeExisting(base: string, roomId: string) {
    const res = await fetch(
      `${base}/v1/rooms/${encodeURIComponent(roomId)}/producers?peerId=${encodeURIComponent(this.userId)}`
    );
    const { producers } = await res.json();
    for (const item of producers as { producerId: string; peerId: string; kind: MediaKind }[]) {
      await this.consumeProducer(base, roomId, item.producerId, item.peerId, item.kind);
    }
  }

  private async consumeProducer(
    base: string,
    roomId: string,
    producerId: string,
    fromUserId: string,
    kind?: MediaKind,
    source?: "camera" | "screen"
  ) {
    if (!this.recvTransport || !this.device || this.consumers.has(producerId)) return;

    const res = await fetch(
      `${base}/v1/rooms/${encodeURIComponent(roomId)}/transports/${this.recvTransport.id}/consume`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          peerId: this.userId,
          producerId,
          rtpCapabilities: this.device.rtpCapabilities,
        }),
      }
    );
    if (!res.ok) return;
    const data = await res.json();

    const consumer = await this.recvTransport.consume({
      id: data.consumerId,
      producerId: data.producerId,
      kind: data.kind,
      rtpParameters: data.rtpParameters,
    });
    this.consumers.set(producerId, consumer);

    const stream = new MediaStream([consumer.track]);
    const trackKind = kind || data.kind;

    if (trackKind === "video") {
      this.onRemoteTrack?.({
        producerId,
        userId: fromUserId,
        kind: "video",
        source: source || "camera",
        stream,
      });
    } else {
      const audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = stream;
      this.remoteAudios.set(producerId, audio);
      this.onRemoteTrack?.({
        producerId,
        userId: fromUserId,
        kind: "audio",
        source: "microphone",
        stream,
      });
    }
  }

  async collectQualityMetrics(): Promise<import("@rtc/protocol").CallQualityMetrics | null> {
    if (!this.recvTransport) return null;
    const stats = await this.recvTransport.getStats();
    let jitterMs: number | null = null;
    let packetLossPct: number | null = null;
    let inboundBitrateKbps: number | null = null;

    for (const report of stats.values()) {
      if (report.type === "inbound-rtp" && (report as { kind?: string }).kind === "audio") {
        const inbound = report as {
          jitter?: number;
          packetsLost?: number;
          packetsReceived?: number;
          bitrate?: number;
        };
        if (inbound.jitter != null) jitterMs = Math.round(inbound.jitter);
        if (inbound.packetsLost != null && inbound.packetsReceived != null) {
          const total = inbound.packetsLost + inbound.packetsReceived;
          packetLossPct = total > 0 ? Math.round((inbound.packetsLost / total) * 1000) / 10 : 0;
        }
        if (inbound.bitrate != null) inboundBitrateKbps = Math.round(inbound.bitrate / 1000);
      }
    }

    return {
      rttMs: null,
      jitterMs,
      packetLossPct,
      inboundBitrateKbps,
      outboundBitrateKbps: null,
      audioLevel: null,
      connectionState: this.recvTransport.connectionState,
      iceState: this.recvTransport.iceConnectionState ?? null,
    };
  }

  destroy() {
    for (const consumer of this.consumers.values()) consumer.close();
    this.consumers.clear();
    for (const producer of this.producers.values()) producer.close();
    this.producers.clear();
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    for (const audio of this.remoteAudios.values()) audio.srcObject = null;
    this.remoteAudios.clear();
    this.producerMeta.clear();
    this.roomId = null;
  }
}

// Backward-compatible alias
export { SfuMediaEngine as SfuVoiceEngine };
