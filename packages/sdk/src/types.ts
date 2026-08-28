import type { CallType, IceServerConfig } from "@rtc/protocol";
import type { ClientMessage, ServerMessage } from "@rtc/protocol";

export type MediaMode = "p2p" | "sfu" | "auto";

export interface RTCInitOptions {
  serverUrl: string;
  appId: string;
  userId: string;
  token: string;
  /** p2p = direct WebRTC, sfu = mediasoup server, auto = use SFU when available */
  mediaMode?: MediaMode;
}

export interface CallOptions {
  callType?: CallType;
}

export interface RemoteTrackEvent {
  producerId: string;
  userId: string;
  kind: "audio" | "video";
  source?: "camera" | "screen" | "microphone";
  stream: MediaStream;
}

export interface RecordingReadyEvent {
  recordingId?: string;
  callId?: string;
  roomId: string;
  blob: Blob;
  url: string;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
}

export interface TranscriptReadyEvent {
  recordingId: string;
  roomId: string;
  callId?: string;
  transcript: string;
}

export interface SummaryReadyEvent {
  recordingId: string;
  roomId: string;
  callId?: string;
  summary: string;
  transcript: string;
}

export interface RTCEvents {
  connected: [{ userId: string }];
  disconnected: [];
  roomJoined: [{ roomId: string; members: string[] }];
  userJoined: [{ roomId: string; userId: string }];
  userLeft: [{ roomId: string; userId: string }];
  message: [import("@rtc/protocol").RoomMessagePayload];
  callInvite: [import("@rtc/protocol").CallPeerPayload];
  callState: [
    {
      callId: string;
      state: import("@rtc/protocol").CallState;
      peerUserId: string;
      roomId: string;
      mediaMode?: MediaMode;
      callType?: CallType;
    },
  ];
  voiceRoomJoined: [{ roomId: string; mediaMode: MediaMode }];
  voiceRoomLeft: [{ roomId: string }];
  videoRoomJoined: [{ roomId: string; mediaMode: MediaMode }];
  videoRoomLeft: [{ roomId: string }];
  localStream: [{ stream: MediaStream | null }];
  remoteTrack: [RemoteTrackEvent];
  recordingStarted: [{ callId?: string; roomId: string }];
  recordingReady: [RecordingReadyEvent];
  transcriptReady: [TranscriptReadyEvent];
  summaryReady: [SummaryReadyEvent];
  error: [{ message: string }];
}

export const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export type SignalingSend = (message: ClientMessage) => void;

export async function fetchToken(
  serverUrl: string,
  request: import("@rtc/protocol").TokenRequest
): Promise<import("@rtc/protocol").TokenResponse> {
  const res = await fetch(`${serverUrl}/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to fetch token");
  }
  return res.json();
}

export async function fetchPlatformConfig(
  serverUrl: string
): Promise<import("@rtc/protocol").PlatformConfig> {
  const res = await fetch(`${serverUrl}/v1/config`);
  if (!res.ok) throw new Error("Failed to fetch platform config");
  return res.json();
}

export async function fetchIceConfig(
  serverUrl: string
): Promise<{ iceServers: IceServerConfig[] }> {
  return fetchPlatformConfig(serverUrl);
}

export type { ClientMessage, ServerMessage, CallType };
