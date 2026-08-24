import type {
  CallPeerPayload,
  ClientMessage,
  RoomMessagePayload,
  ServerMessage,
  SfuProducerPayload,
  WebRtcPayload,
} from "@rtc/protocol";
import { EventEmitter } from "./events.js";
import { P2pVoiceEngine } from "./p2p-voice.js";
import { SfuVoiceEngine } from "./sfu-voice.js";
import {
  DEFAULT_STUN_SERVERS,
  fetchPlatformConfig,
  fetchToken,
  type MediaMode,
  type RTCInitOptions,
  type RTCEvents,
} from "./types.js";

function wsUrl(serverUrl: string, token: string) {
  const base = serverUrl.replace(/^http/, "ws");
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}

function randomId() {
  return crypto.randomUUID();
}

export class RTCExpress extends EventEmitter {
  private serverUrl = "";
  private appId = "";
  private userId = "";
  private token = "";
  private ws: WebSocket | null = null;
  private roomId: string | null = null;

  private mediaModePref: MediaMode = "auto";
  private resolvedMediaMode: MediaMode = "p2p";
  private sfuUrl: string | null = null;
  private iceServers: RTCIceServer[] = DEFAULT_STUN_SERVERS;

  private p2p: P2pVoiceEngine | null = null;
  private sfu: SfuVoiceEngine | null = null;
  private inVoiceRoom = false;

  private activeCall: {
    callId: string;
    peerUserId: string;
    roomId: string;
    isCaller: boolean;
  } | null = null;

  static fetchToken = fetchToken;
  static fetchPlatformConfig = fetchPlatformConfig;
  static fetchIceConfig = fetchPlatformConfig;

  async init(options: RTCInitOptions) {
    this.serverUrl = options.serverUrl.replace(/\/$/, "");
    this.appId = options.appId;
    this.userId = options.userId;
    this.token = options.token;
    this.mediaModePref = options.mediaMode || "auto";

    try {
      const config = await fetchPlatformConfig(this.serverUrl);
      this.iceServers = config.iceServers;
      this.sfuUrl = config.sfuUrl;
      this.resolvedMediaMode = this.resolveMediaMode(config.features.voiceSfu);
    } catch {
      this.iceServers = DEFAULT_STUN_SERVERS;
      this.resolvedMediaMode = this.mediaModePref === "sfu" ? "p2p" : this.mediaModePref;
    }

    await this.connect();
  }

  private resolveMediaMode(voiceSfuAvailable: boolean): MediaMode {
    if (this.mediaModePref === "p2p") return "p2p";
    if (this.mediaModePref === "sfu") return voiceSfuAvailable && this.sfuUrl ? "sfu" : "p2p";
    return voiceSfuAvailable && this.sfuUrl ? "sfu" : "p2p";
  }

  getMediaMode() {
    return this.resolvedMediaMode;
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl(this.serverUrl, this.token));

      socket.onopen = () => {
        this.ws = socket;
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data) as ServerMessage;
        this.handleServerMessage(message);
        if (message.type === "connected") {
          resolve();
        }
      };

      socket.onerror = () => reject(new Error("WebSocket connection failed"));

      socket.onclose = () => {
        this.ws = null;
        this.emit("disconnected");
      };
    });
  }

  private send(message: ClientMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to signaling server");
    }
    this.ws.send(JSON.stringify(message));
  }

  private getP2p() {
    if (!this.p2p) {
      this.p2p = new P2pVoiceEngine(this.iceServers, this.userId, (m) => this.send(m), () =>
        this.activeCall
          ? { callId: this.activeCall.callId, peerUserId: this.activeCall.peerUserId }
          : null
      );
    }
    return this.p2p;
  }

  private getSfu() {
    if (!this.sfuUrl) throw new Error("SFU URL not configured");
    if (!this.sfu) {
      this.sfu = new SfuVoiceEngine(this.sfuUrl, this.userId, (m) => this.send(m));
    }
    return this.sfu;
  }

  private handleServerMessage(message: ServerMessage) {
    switch (message.type) {
      case "connected":
        this.emit("connected", message.payload as { userId: string });
        break;
      case "room_joined": {
        const payload = message.payload as { roomId: string; members: string[] };
        this.roomId = payload.roomId;
        this.emit("roomJoined", payload);
        break;
      }
      case "user_joined":
        this.emit("userJoined", message.payload as { roomId: string; userId: string });
        break;
      case "user_left":
        this.emit("userLeft", message.payload as { roomId: string; userId: string });
        break;
      case "message":
        this.emit("message", message.payload as RoomMessagePayload);
        break;
      case "call_invite":
        this.handleIncomingCall(message.payload as CallPeerPayload);
        break;
      case "call_accept":
        void this.handleCallAccepted(message.payload as CallPeerPayload);
        break;
      case "call_reject":
        this.handleCallEnded("rejected", message.payload as CallPeerPayload);
        break;
      case "call_end":
        this.handleCallEnded("ended", message.payload as CallPeerPayload);
        break;
      case "webrtc_offer":
        void this.getP2p().handleOffer(message.payload as WebRtcPayload);
        break;
      case "webrtc_answer":
        void this.getP2p().handleAnswer(message.payload as WebRtcPayload);
        break;
      case "ice_candidate":
        void this.getP2p().handleIceCandidate(message.payload as WebRtcPayload);
        break;
      case "sfu_producer":
        if (this.sfu) {
          void this.sfu.handleRemoteProducer(message.payload as SfuProducerPayload);
        }
        break;
      case "error":
        this.emit("error", message.payload as { message: string });
        break;
    }
  }

  joinRoom(roomId: string) {
    this.send({ type: "join_room", payload: { roomId } });
  }

  leaveRoom(roomId: string) {
    this.send({ type: "leave_room", payload: { roomId } });
    if (this.roomId === roomId) {
      void this.leaveVoiceRoom();
      this.roomId = null;
    }
  }

  sendMessage(text: string) {
    if (!this.roomId) throw new Error("Join a room first");
    this.send({ type: "send_message", payload: { roomId: this.roomId, text } });
  }

  /** Join group voice in the current room (SFU). All room members hear each other. */
  async joinVoiceRoom() {
    if (!this.roomId) throw new Error("Join a room first");
    if (!this.sfuUrl) throw new Error("SFU not available. Start media-sfu service.");
    await this.getSfu().joinRoom(this.roomId, { announceToRoom: true });
    this.inVoiceRoom = true;
    this.emit("voiceRoomJoined", { roomId: this.roomId, mediaMode: "sfu" });
  }

  leaveVoiceRoom() {
    if (!this.inVoiceRoom) return;
    const roomId = this.roomId;
    this.sfu?.destroy();
    this.sfu = null;
    this.inVoiceRoom = false;
    if (roomId) this.emit("voiceRoomLeft", { roomId });
  }

  async callUser(peerUserId: string) {
    if (!this.roomId) throw new Error("Join a room first");
    const callId = randomId();
    this.activeCall = { callId, peerUserId, roomId: this.roomId, isCaller: true };
    this.emit("callState", {
      callId,
      state: "ringing",
      peerUserId,
      roomId: this.roomId,
      mediaMode: this.resolvedMediaMode,
    });
    this.send({
      type: "call_invite",
      payload: { callId, roomId: this.roomId, toUserId: peerUserId },
    });
  }

  async acceptCall() {
    if (!this.activeCall) throw new Error("No incoming call");
    const { callId, peerUserId, roomId } = this.activeCall;
    this.send({
      type: "call_accept",
      payload: { callId, fromUserId: this.userId, toUserId: peerUserId, roomId },
    });
    await this.startCallMedia(peerUserId, roomId, callId, false);
  }

  rejectCall() {
    if (!this.activeCall) return;
    const { callId, peerUserId, roomId } = this.activeCall;
    this.send({
      type: "call_reject",
      payload: { callId, fromUserId: this.userId, toUserId: peerUserId, roomId },
    });
    this.cleanupCall("rejected");
  }

  endCall() {
    if (!this.activeCall) return;
    const { callId, peerUserId, roomId } = this.activeCall;
    this.send({
      type: "call_end",
      payload: { callId, fromUserId: this.userId, toUserId: peerUserId, roomId },
    });
    this.cleanupCall("ended");
  }

  muteMicrophone(muted: boolean) {
    if (this.resolvedMediaMode === "sfu" && (this.sfu || this.inVoiceRoom)) {
      this.sfu?.mute(muted);
    } else {
      this.p2p?.mute(muted);
    }
  }

  private handleIncomingCall(payload: CallPeerPayload) {
    this.activeCall = {
      callId: payload.callId,
      peerUserId: payload.fromUserId,
      roomId: payload.roomId,
      isCaller: false,
    };
    this.emit("callInvite", payload);
    this.emit("callState", {
      callId: payload.callId,
      state: "ringing",
      peerUserId: payload.fromUserId,
      roomId: payload.roomId,
      mediaMode: this.resolvedMediaMode,
    });
  }

  private async handleCallAccepted(payload: CallPeerPayload) {
    if (!this.activeCall || this.activeCall.callId !== payload.callId) return;
    await this.startCallMedia(payload.fromUserId, payload.roomId, payload.callId, true);
  }

  private async startCallMedia(
    peerUserId: string,
    roomId: string,
    callId: string,
    isCaller: boolean
  ) {
    this.emit("callState", {
      callId,
      state: "connecting",
      peerUserId,
      roomId,
      mediaMode: this.resolvedMediaMode,
    });

    if (this.resolvedMediaMode === "sfu") {
      const sfuRoomId = `${roomId}-call-${callId}`;
      await this.getSfu().joinRoom(sfuRoomId, {
        callId,
        targetUserId: peerUserId,
      });
      this.emit("callState", {
        callId,
        state: "connected",
        peerUserId,
        roomId,
        mediaMode: "sfu",
      });
      return;
    }

    const p2p = this.getP2p();
    if (isCaller) {
      await p2p.createOffer(peerUserId, callId);
    } else {
      await p2p.prepare(false);
    }
    p2p.onConnected(() => {
      this.emit("callState", {
        callId,
        state: "connected",
        peerUserId,
        roomId,
        mediaMode: "p2p",
      });
    });
  }

  private handleCallEnded(state: "ended" | "rejected", payload: CallPeerPayload) {
    if (!this.activeCall || this.activeCall.callId !== payload.callId) return;
    this.cleanupCall(state);
  }

  private cleanupCall(state: "ended" | "rejected") {
    if (!this.activeCall) return;
    const { callId, peerUserId, roomId } = this.activeCall;
    this.p2p?.destroy();
    this.p2p = null;
    if (!this.inVoiceRoom) {
      this.sfu?.destroy();
      this.sfu = null;
    }
    this.emit("callState", { callId, state, peerUserId, roomId, mediaMode: this.resolvedMediaMode });
    this.activeCall = null;
  }

  destroy() {
    this.endCall();
    this.leaveVoiceRoom();
    this.ws?.close();
    this.ws = null;
  }
}

export { fetchToken, fetchPlatformConfig, fetchIceConfig, DEFAULT_STUN_SERVERS } from "./types.js";
export type { RTCInitOptions, RTCEvents, MediaMode } from "./types.js";
