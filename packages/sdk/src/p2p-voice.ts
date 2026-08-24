import type { WebRtcPayload } from "@rtc/protocol";
import type { SignalingSend } from "./types.js";

export class P2pVoiceEngine {
  private peerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteAudio: HTMLAudioElement | null = null;

  constructor(
    private iceServers: RTCIceServer[],
    private userId: string,
    private send: SignalingSend,
    private getActiveCall: () => {
      callId: string;
      peerUserId: string;
    } | null
  ) {}

  async prepare(isCaller: boolean) {
    if (this.peerConnection) return;
    this.peerConnection = new RTCPeerConnection({ iceServers: this.iceServers });
    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this.localStream.getTracks().forEach((track) => {
      this.peerConnection!.addTrack(track, this.localStream!);
    });

    this.remoteAudio = new Audio();
    this.remoteAudio.autoplay = true;
    this.peerConnection.ontrack = (event) => {
      this.remoteAudio!.srcObject = event.streams[0];
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

  mute(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  destroy() {
    this.peerConnection?.close();
    this.peerConnection = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio = null;
    }
  }
}
