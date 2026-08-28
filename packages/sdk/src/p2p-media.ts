import type { WebRtcPayload } from "@rtc/protocol";
import type { SignalingSend } from "./types.js";

export interface P2pMediaOptions {
  audio?: boolean;
  video?: boolean;
}

export type OnRemoteStream = (stream: MediaStream) => void;

export class P2pMediaEngine {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private mediaOptions: P2pMediaOptions = { audio: true, video: false };

  constructor(
    private iceServers: RTCIceServer[],
    private userId: string,
    private send: SignalingSend,
    private getActiveCall: () => {
      callId: string;
      peerUserId: string;
    } | null,
    private onRemoteStream?: OnRemoteStream
  ) {}

  setMediaOptions(options: P2pMediaOptions) {
    this.mediaOptions = { audio: options.audio !== false, video: options.video === true };
  }

  async prepare(isCaller: boolean) {
    if (this.peerConnection) return;
    this.peerConnection = new RTCPeerConnection({ iceServers: this.iceServers });
    this.localStream = await navigator.mediaDevices.getUserMedia({
      audio: this.mediaOptions.audio,
      video: this.mediaOptions.video,
    });
    this.localStream.getTracks().forEach((track) => {
      this.peerConnection!.addTrack(track, this.localStream!);
    });

    this.remoteAudio = new Audio();
    this.remoteAudio.autoplay = true;
    this.peerConnection.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      if (event.track.kind === "video") {
        this.onRemoteStream?.(stream);
      } else if (this.remoteAudio) {
        this.remoteAudio.srcObject = stream;
      }
      this.onRemoteStream?.(stream);
    };

    this.peerConnection.onicecandidate = (event) => {
      const call = this.getActiveCall();
      if (!event.candidate || !call) return;
      this.send({
        type: "ice_candidate",
        payload: {
          callId: call.callId,
          fromUserId: this.userId,
          toUserId: call.peerUserId,
          candidate: event.candidate.toJSON(),
        },
      });
    };

    if (!isCaller) {
      // callee waits for offer
    }
  }

  getLocalStream() {
    return this.localStream;
  }

  async createOffer(peerUserId: string, callId: string) {
    await this.prepare(true);
    const offer = await this.peerConnection!.createOffer();
    await this.peerConnection!.setLocalDescription(offer);
    this.send({
      type: "webrtc_offer",
      payload: {
        callId,
        fromUserId: this.userId,
        toUserId: peerUserId,
        sdp: offer,
      },
    });
  }

  async handleOffer(payload: WebRtcPayload) {
    if (!payload.sdp) return;
    await this.prepare(false);
    await this.peerConnection!.setRemoteDescription(payload.sdp);
    const answer = await this.peerConnection!.createAnswer();
    await this.peerConnection!.setLocalDescription(answer);
    this.send({
      type: "webrtc_answer",
      payload: {
        callId: payload.callId,
        fromUserId: this.userId,
        toUserId: payload.fromUserId,
        sdp: answer,
      },
    });
  }

  async handleAnswer(payload: WebRtcPayload) {
    if (!payload.sdp || !this.peerConnection) return;
    await this.peerConnection.setRemoteDescription(payload.sdp);
  }

  async handleIceCandidate(payload: WebRtcPayload) {
    if (!payload.candidate || !this.peerConnection) return;
    await this.peerConnection.addIceCandidate(payload.candidate);
  }

  onConnected(callback: () => void) {
    if (!this.peerConnection) return;
    this.peerConnection.onconnectionstatechange = () => {
      if (this.peerConnection?.connectionState === "connected") callback();
    };
  }

  async shareScreen() {
    if (!this.peerConnection) throw new Error("Not in call");
    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = this.screenStream.getVideoTracks()[0];
    screenTrack.onended = () => void this.stopScreenShare();

    const sender = this.peerConnection.getSenders().find((s) => s.track?.kind === "video");
    if (sender) {
      await sender.replaceTrack(screenTrack);
    } else {
      this.peerConnection.addTrack(screenTrack, this.screenStream);
    }
  }

  async stopScreenShare() {
    if (!this.peerConnection || !this.localStream) return;
    const cameraTrack = this.localStream.getVideoTracks()[0];
    const sender = this.peerConnection.getSenders().find((s) => s.track?.kind === "video");
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
  }

  muteMicrophone(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  muteCamera(muted: boolean) {
    this.localStream?.getVideoTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  destroy() {
    this.peerConnection?.close();
    this.peerConnection = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
  }
}

export { P2pMediaEngine as P2pVoiceEngine };
