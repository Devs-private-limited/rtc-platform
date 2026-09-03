import type {
  CallPeerPayload,
  CallType,
  ClientMessage,
  MediaParticipantPayload,
  MessageHistoryPage,
  RoomMessagePayload,
  ServerMessage,
  SfuProducerPayload,
  WebRtcPayload,
} from "@rtc/protocol";
import { EventEmitter } from "./events.js";
import { P2pMediaEngine } from "./p2p-media.js";
import { CallRecorder } from "./recording.js";
import { QualityMonitor } from "./call-quality.js";
import { collectPeerConnectionStats } from "./call-quality.js";
import { SfuMediaEngine } from "./sfu-media.js";
import {
  DEFAULT_STUN_SERVERS,
  fetchPlatformConfig,
  fetchToken,
  type CallOptions,
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

  private p2p: P2pMediaEngine | null = null;
  private sfu: SfuMediaEngine | null = null;
  private inVoiceRoom = false;
  private inVideoRoom = false;

  private activeCall: {
    callId: string;
    peerUserId: string;
    roomId: string;
    isCaller: boolean;
    callType: CallType;
  } | null = null;

  private recorder = new CallRecorder();
  private remoteStreams = new Map<string, MediaStream>();
  private pendingRecordingAck: {
    resolve: (recordingId: string) => void;
    reject: (err: Error) => void;
    roomId: string;
  } | null = null;
  private qualityMonitor: QualityMonitor | null = null;
  private qualityMonitoringEnabled = true;

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

  getLocalStream() {
    if (this.sfu) return this.sfu.getLocalStream();
    return this.p2p?.getLocalStream() ?? null;
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

  private getP2p(video = false) {
    if (!this.p2p) {
      this.p2p = new P2pMediaEngine(
        this.iceServers,
        this.userId,
        (m) => this.send(m),
        () =>
          this.activeCall
            ? { callId: this.activeCall.callId, peerUserId: this.activeCall.peerUserId }
            : null,
        (stream) => {
          this.remoteStreams.set("p2p", stream);
          const videoTrack = stream.getVideoTracks()[0];
          if (videoTrack) {
            this.emit("remoteTrack", {
              producerId: "p2p",
              userId: this.activeCall?.peerUserId || "peer",
              kind: "video",
              source: "camera",
              stream,
            });
          }
        }
      );
    }
    this.p2p.setMediaOptions({ audio: true, video });
    return this.p2p;
  }

  private getSfu() {
    if (!this.sfuUrl) throw new Error("SFU URL not configured");
    if (!this.sfu) {
      this.sfu = new SfuMediaEngine(this.sfuUrl, this.userId, (m) => this.send(m), (info) => {
        this.remoteStreams.set(info.producerId, info.stream);
        this.emit("remoteTrack", info);
      });
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
        void this.getP2p(this.activeCall?.callType === "video").handleOffer(
          message.payload as WebRtcPayload
        );
        break;
      case "webrtc_answer":
        void this.getP2p(this.activeCall?.callType === "video").handleAnswer(
          message.payload as WebRtcPayload
        );
        break;
      case "ice_candidate":
        void this.getP2p(this.activeCall?.callType === "video").handleIceCandidate(
          message.payload as WebRtcPayload
        );
        break;
      case "sfu_producer":
        if (this.sfu) {
          void this.sfu.handleRemoteProducer(message.payload as SfuProducerPayload);
        }
        break;
      case "media_participant_joined":
        this.emit("mediaParticipantJoined", message.payload as MediaParticipantPayload);
        break;
      case "media_participant_left":
        this.emit("mediaParticipantLeft", message.payload as MediaParticipantPayload);
        break;
      case "recording_ack": {
        const payload = message.payload as {
          recordingId: string;
          roomId: string;
          callId?: string;
        };
        if (this.pendingRecordingAck && this.pendingRecordingAck.roomId === payload.roomId) {
          this.pendingRecordingAck.resolve(payload.recordingId);
          this.pendingRecordingAck = null;
        }
        break;
      }
      case "transcript_ready":
        this.emit("transcriptReady", message.payload as import("./types.js").TranscriptReadyEvent);
        break;
      case "summary_ready":
        this.emit("summaryReady", message.payload as import("./types.js").SummaryReadyEvent);
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
      void this.leaveVideoRoom();
      this.roomId = null;
    }
  }

  sendMessage(text: string) {
    if (!this.roomId) throw new Error("Join a room first");
    const clientMsgId = randomId();
    this.send({ type: "send_message", payload: { roomId: this.roomId, text, clientMsgId } });
    return clientMsgId;
  }

  /**
   * Loads stored chat history, newest first. Call after the `roomJoined` event —
   * the server only serves history to current room members.
   *
   * Page backwards with the returned `nextCursor`:
   * ```ts
   * const page = await rtc.getMessageHistory(roomId);
   * const older = await rtc.getMessageHistory(roomId, { before: page.nextCursor });
   * ```
   */
  async getMessageHistory(
    roomId: string,
    opts: { before?: string | null; limit?: number } = {}
  ): Promise<MessageHistoryPage> {
    const params = new URLSearchParams();
    if (opts.before) params.set("before", opts.before);
    if (opts.limit) params.set("limit", String(opts.limit));
    const query = params.toString();

    const res = await fetch(
      `${this.serverUrl}/v1/rooms/${encodeURIComponent(roomId)}/messages${query ? `?${query}` : ""}`,
      { headers: { Authorization: `Bearer ${this.token}` } }
    );

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `Failed to load history (${res.status})`);
    }
    return (await res.json()) as MessageHistoryPage;
  }

  async joinVoiceRoom() {
    if (!this.roomId) throw new Error("Join a room first");
    if (!this.sfuUrl) throw new Error("SFU not available. Start media-sfu service.");
    await this.getSfu().joinRoom(this.roomId, { announceToRoom: true, audio: true, video: false });
    this.inVoiceRoom = true;
    this.send({ type: "join_media", payload: { roomId: this.roomId, kind: "voice" } });
    this.emit("voiceRoomJoined", { roomId: this.roomId, mediaMode: "sfu" });
    this.emitLocalStream();
    this.startQualityMonitoring();
  }

  leaveVoiceRoom() {
    if (!this.inVoiceRoom) return;
    const roomId = this.roomId;
    if (!this.inVideoRoom) {
      this.sfu?.destroy();
      this.sfu = null;
    }
    this.inVoiceRoom = false;
    if (!this.inVideoRoom) this.stopQualityMonitoring();
    // Still in the video room means still consuming group media — the billed
    // session stays open until they leave that too.
    if (roomId && !this.inVideoRoom) {
      this.send({ type: "leave_media", payload: { roomId, kind: "voice" } });
    }
    if (roomId) this.emit("voiceRoomLeft", { roomId });
  }

  async joinVideoRoom() {
    if (!this.roomId) throw new Error("Join a room first");
    if (!this.sfuUrl) throw new Error("SFU not available. Start media-sfu service.");
    await this.getSfu().joinRoom(this.roomId, { announceToRoom: true, audio: true, video: true });
    this.inVideoRoom = true;
    this.send({ type: "join_media", payload: { roomId: this.roomId, kind: "video" } });
    this.emit("videoRoomJoined", { roomId: this.roomId, mediaMode: "sfu" });
    this.emitLocalStream();
    this.startQualityMonitoring();
  }

  leaveVideoRoom() {
    if (!this.inVideoRoom) return;
    const roomId = this.roomId;
    this.sfu?.destroy();
    this.sfu = null;
    this.inVideoRoom = false;
    this.stopQualityMonitoring();
    // Leaving video tears down the SFU transport, so any voice ends with it.
    this.inVoiceRoom = false;
    if (roomId) {
      this.send({ type: "leave_media", payload: { roomId, kind: "video" } });
      this.emit("videoRoomLeft", { roomId });
    }
    this.emit("localStream", { stream: null });
  }

  async callUser(peerUserId: string, options: CallOptions = {}) {
    const callType = options.callType || "voice";
    return this.startCall(peerUserId, callType);
  }

  async videoCallUser(peerUserId: string) {
    return this.startCall(peerUserId, "video");
  }

  private async startCall(peerUserId: string, callType: CallType) {
    if (!this.roomId) throw new Error("Join a room first");
    const callId = randomId();
    this.activeCall = { callId, peerUserId, roomId: this.roomId, isCaller: true, callType };
    this.emit("callState", {
      callId,
      state: "ringing",
      peerUserId,
      roomId: this.roomId,
      mediaMode: this.resolvedMediaMode,
      callType,
    });
    this.send({
      type: "call_invite",
      payload: { callId, roomId: this.roomId, toUserId: peerUserId, callType },
    });
  }

  async acceptCall() {
    if (!this.activeCall) throw new Error("No incoming call");
    const { callId, peerUserId, roomId, callType } = this.activeCall;
    this.send({
      type: "call_accept",
      payload: { callId, fromUserId: this.userId, toUserId: peerUserId, roomId, callType },
    });
    await this.startCallMedia(peerUserId, roomId, callId, false, callType);
  }

  rejectCall() {
    if (!this.activeCall) return;
    const { callId, peerUserId, roomId, callType } = this.activeCall;
    this.send({
      type: "call_reject",
      payload: { callId, fromUserId: this.userId, toUserId: peerUserId, roomId, callType },
    });
    this.cleanupCall("rejected");
  }

  endCall() {
    if (!this.activeCall) return;
    const { callId, peerUserId, roomId, callType } = this.activeCall;
    this.send({
      type: "call_end",
      payload: { callId, fromUserId: this.userId, toUserId: peerUserId, roomId, callType },
    });
    this.cleanupCall("ended");
  }

  muteMicrophone(muted: boolean) {
    if (this.resolvedMediaMode === "sfu" && (this.sfu || this.inVoiceRoom || this.inVideoRoom)) {
      this.sfu?.muteMicrophone(muted);
    } else {
      this.p2p?.muteMicrophone(muted);
    }
  }

  muteCamera(muted: boolean) {
    if (this.resolvedMediaMode === "sfu" && (this.sfu || this.inVideoRoom)) {
      this.sfu?.muteCamera(muted);
    } else {
      this.p2p?.muteCamera(muted);
    }
  }

  async switchCamera() {
    if (this.resolvedMediaMode === "sfu" && this.sfu) {
      await this.sfu.switchCamera();
    } else if (this.p2p) {
      await this.p2p.switchCamera();
    } else {
      throw new Error("Not in a video call");
    }
    this.emitLocalStream();
  }

  async shareScreen() {
    if (this.resolvedMediaMode === "sfu" && this.sfu) {
      await this.sfu.shareScreen({
        callId: this.activeCall?.callId,
        targetUserId: this.activeCall?.peerUserId,
        announceToRoom: this.inVideoRoom,
      });
    } else if (this.p2p) {
      await this.p2p.shareScreen();
    } else {
      throw new Error("Not in a call or video room");
    }
  }

  async stopScreenShare() {
    if (this.sfu) await this.sfu.stopScreenShare();
    else if (this.p2p) await this.p2p.stopScreenShare();
  }

  isRecording() {
    return this.recorder.isRecording();
  }

  setQualityMonitoring(enabled: boolean) {
    this.qualityMonitoringEnabled = enabled;
    if (!enabled) this.stopQualityMonitoring();
    else if (this.isInMediaSession()) this.startQualityMonitoring();
  }

  startQualityMonitoring(intervalMs = 5000) {
    if (!this.qualityMonitoringEnabled || !this.roomId) return;
    this.stopQualityMonitoring();
    this.qualityMonitor = new QualityMonitor(
      () => this.collectQualityMetrics(),
      (sample, degraded) => {
        const mediaMode = this.getActiveMediaMode();
        const event = {
          callId: this.activeCall?.callId,
          roomId: this.roomId!,
          mediaMode,
          metrics: sample.metrics,
          score: sample.score,
          label: sample.label,
          at: sample.at,
        };
        this.emit("callQuality", event);
        this.send({
          type: "call_quality_report",
          payload: {
            callId: event.callId,
            roomId: event.roomId,
            mediaMode,
            metrics: sample.metrics,
            qualityScore: sample.score,
            qualityLabel: sample.label,
          },
        });
        if (degraded) {
          this.emit("error", { message: `Call quality degraded (score ${sample.score})` });
        }
      }
    );
    this.qualityMonitor.start(intervalMs);
  }

  stopQualityMonitoring() {
    this.qualityMonitor?.stop();
    this.qualityMonitor = null;
  }

  private getActiveMediaMode(): "p2p" | "sfu" {
    if (this.sfu && (this.activeCall || this.inVoiceRoom || this.inVideoRoom)) return "sfu";
    return "p2p";
  }

  private async collectQualityMetrics() {
    if (this.sfu && (this.activeCall || this.inVoiceRoom || this.inVideoRoom)) {
      return this.sfu.collectQualityMetrics();
    }
    const pc = this.p2p?.getPeerConnection();
    if (pc) return collectPeerConnectionStats(pc);
    return null;
  }

  startRecording() {
    if (!this.isInMediaSession()) {
      throw new Error("Join a call or media room before recording");
    }
    if (!this.roomId) throw new Error("Join a room first");
    const streams = this.collectRecordingStreams();
    this.recorder.startRecording(streams);
    this.emit("recordingStarted", {
      callId: this.activeCall?.callId,
      roomId: this.roomId,
    });
  }

  async stopRecording() {
    if (!this.roomId) throw new Error("Join a room first");
    const result = await this.recorder.stopRecording();
    const url = URL.createObjectURL(result.blob);
    const payload = {
      callId: this.activeCall?.callId,
      roomId: this.roomId,
      durationMs: result.durationMs,
      sizeBytes: result.sizeBytes,
      mimeType: result.mimeType,
    };

    const ackPromise = new Promise<string>((resolve, reject) => {
      this.pendingRecordingAck = { resolve, reject, roomId: this.roomId! };
      setTimeout(() => {
        if (this.pendingRecordingAck?.roomId === this.roomId) {
          this.pendingRecordingAck.reject(new Error("Recording ack timeout"));
          this.pendingRecordingAck = null;
        }
      }, 15_000);
    });

    this.send({ type: "recording_ready", payload });
    let recordingId: string | undefined;
    try {
      recordingId = await ackPromise;
      await this.uploadRecording(recordingId, result.blob, result.mimeType);
    } catch (err) {
      this.emit("error", {
        message: err instanceof Error ? err.message : "Recording upload failed",
      });
    }

    const event = { ...payload, recordingId, blob: result.blob, url };
    this.emit("recordingReady", event);
    return event;
  }

  private async uploadRecording(recordingId: string, blob: Blob, mimeType: string) {
    const res = await fetch(`${this.serverUrl}/v1/recordings/${recordingId}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": mimeType,
      },
      body: blob,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to upload recording");
    }
  }

  private isInMediaSession() {
    return Boolean(this.activeCall) || this.inVoiceRoom || this.inVideoRoom;
  }

  private collectRecordingStreams() {
    const streams: MediaStream[] = [];
    const local = this.getLocalStream();
    if (local) streams.push(local);
    for (const stream of this.remoteStreams.values()) {
      streams.push(stream);
    }
    return streams;
  }

  private emitLocalStream() {
    const stream = this.getLocalStream();
    this.emit("localStream", { stream: stream ?? null });
  }

  private handleIncomingCall(payload: CallPeerPayload) {
    const callType = payload.callType || "voice";
    this.activeCall = {
      callId: payload.callId,
      peerUserId: payload.fromUserId,
      roomId: payload.roomId,
      isCaller: false,
      callType,
    };
    this.emit("callInvite", payload);
    this.emit("callState", {
      callId: payload.callId,
      state: "ringing",
      peerUserId: payload.fromUserId,
      roomId: payload.roomId,
      mediaMode: this.resolvedMediaMode,
      callType,
    });
  }

  private async handleCallAccepted(payload: CallPeerPayload) {
    if (!this.activeCall || this.activeCall.callId !== payload.callId) return;
    const callType = payload.callType || this.activeCall.callType;
    await this.startCallMedia(payload.fromUserId, payload.roomId, payload.callId, true, callType);
  }

  private async startCallMedia(
    peerUserId: string,
    roomId: string,
    callId: string,
    isCaller: boolean,
    callType: CallType
  ) {
    const isVideo = callType === "video";
    this.emit("callState", {
      callId,
      state: "connecting",
      peerUserId,
      roomId,
      mediaMode: this.resolvedMediaMode,
      callType,
    });

    if (this.resolvedMediaMode === "sfu") {
      const sfuRoomId = `${roomId}-call-${callId}`;
      await this.getSfu().joinRoom(sfuRoomId, {
        callId,
        targetUserId: peerUserId,
        audio: true,
        video: isVideo,
      });
      this.emitLocalStream();
      this.emit("callState", {
        callId,
        state: "connected",
        peerUserId,
        roomId,
        mediaMode: "sfu",
        callType,
      });
      this.startQualityMonitoring();
      return;
    }

    const p2p = this.getP2p(isVideo);
    if (isCaller) {
      await p2p.createOffer(peerUserId, callId);
    } else {
      await p2p.prepare(false);
    }
    this.emitLocalStream();
    p2p.onConnected(() => {
      this.emit("callState", {
        callId,
        state: "connected",
        peerUserId,
        roomId,
        mediaMode: "p2p",
        callType,
      });
      this.startQualityMonitoring();
    });
  }

  private handleCallEnded(state: "ended" | "rejected", payload: CallPeerPayload) {
    if (!this.activeCall || this.activeCall.callId !== payload.callId) return;
    this.cleanupCall(state);
  }

  private cleanupCall(state: "ended" | "rejected") {
    if (!this.activeCall) return;
    this.stopQualityMonitoring();
    const { callId, peerUserId, roomId, callType } = this.activeCall;
    this.p2p?.destroy();
    this.p2p = null;
    this.remoteStreams.clear();
    if (!this.inVoiceRoom && !this.inVideoRoom) {
      this.sfu?.destroy();
      this.sfu = null;
    }
    this.emit("callState", {
      callId,
      state,
      peerUserId,
      roomId,
      mediaMode: this.resolvedMediaMode,
      callType,
    });
    this.emit("localStream", { stream: null });
    this.activeCall = null;
  }

  destroy() {
    this.endCall();
    this.leaveVoiceRoom();
    this.leaveVideoRoom();
    this.ws?.close();
    this.ws = null;
  }
}

export { fetchToken, fetchPlatformConfig, fetchIceConfig, DEFAULT_STUN_SERVERS } from "./types.js";
export type { RTCInitOptions, RTCEvents, MediaMode, CallOptions, CallType } from "./types.js";
