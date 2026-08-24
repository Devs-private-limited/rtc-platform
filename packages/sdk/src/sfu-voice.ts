import * as mediasoupClient from "mediasoup-client";
import type { SfuProducerPayload } from "@rtc/protocol";
import type { SignalingSend } from "./types.js";

type Device = mediasoupClient.types.Device;
type Transport = mediasoupClient.types.Transport;
type Producer = mediasoupClient.types.Producer;
type Consumer = mediasoupClient.types.Consumer;

export class SfuVoiceEngine {
  private device: Device | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private producer: Producer | null = null;
  private consumers = new Map<string, Consumer>();
  private remoteAudios = new Map<string, HTMLAudioElement>();
  private roomId: string | null = null;

  constructor(
    private sfuUrl: string,
    private userId: string,
    private sendSignal: SignalingSend
  ) {}

  async joinRoom(
    roomId: string,
    options?: { callId?: string; targetUserId?: string; announceToRoom?: boolean }
  ) {
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
    await this.startMic(base, roomId, options);
    await this.consumeExisting(base, roomId);
  }

  async handleRemoteProducer(payload: SfuProducerPayload) {
    if (!this.roomId || payload.roomId !== this.roomId) return;
    if (payload.fromUserId === this.userId) return;
    if (this.consumers.has(payload.producerId)) return;
    await this.consumeProducer(this.sfuUrl.replace(/\/$/, ""), this.roomId, payload.producerId);
  }

  private async createSendTransport(base: string, roomId: string, options?: { callId?: string; targetUserId?: string; announceToRoom?: boolean }) {
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

        this.sendSignal({
          type: "sfu_producer",
          payload: {
            roomId,
            producerId,
            toUserId: options?.targetUserId,
            callId: options?.callId,
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

  private async startMic(
    _base: string,
    _roomId: string,
    _options?: { callId?: string; targetUserId?: string }
  ) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const track = stream.getAudioTracks()[0];
    this.producer = await this.sendTransport!.produce({ track });
  }

  private async consumeExisting(base: string, roomId: string) {
    const res = await fetch(
      `${base}/v1/rooms/${encodeURIComponent(roomId)}/producers?peerId=${encodeURIComponent(this.userId)}`
    );
    const { producers } = await res.json();
    for (const item of producers as { producerId: string }[]) {
      await this.consumeProducer(base, roomId, item.producerId);
    }
  }

  private async consumeProducer(base: string, roomId: string, producerId: string) {
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
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = stream;
    this.remoteAudios.set(producerId, audio);
  }

  mute(muted: boolean) {
    if (this.producer) {
      if (muted) void this.producer.pause();
      else void this.producer.resume();
    }
  }

  destroy() {
    for (const consumer of this.consumers.values()) consumer.close();
    this.consumers.clear();
    this.producer?.close();
    this.producer = null;
    this.sendTransport?.close();
    this.recvTransport?.close();
    this.sendTransport = null;
    this.recvTransport = null;
    this.device = null;
    for (const audio of this.remoteAudios.values()) {
      audio.srcObject = null;
    }
    this.remoteAudios.clear();
    this.roomId = null;
  }
}
