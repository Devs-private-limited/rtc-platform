import type { CallType, IceServerConfig, RoomRole } from "@rtc/protocol";
import type { ClientMessage, ServerMessage } from "@rtc/protocol";

export type MediaMode = "p2p" | "sfu" | "auto";

export interface RTCInitOptions {
  serverUrl: string;
  appId: string;
  userId: string;
  token: string;
  /** p2p = direct WebRTC, sfu = mediasoup server, auto = use SFU when available */
  mediaMode?: MediaMode;
  /** Reconnect signaling after network drops (default true). */
  autoReconnect?: boolean;
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

export interface CallQualityEvent {
  callId?: string;
  roomId: string;
  mediaMode: "p2p" | "sfu";
  metrics: import("@rtc/protocol").CallQualityMetrics;
  score: number;
  label: import("@rtc/protocol").QualityLabel;
  at: number;
}

export interface JoinRoomOptions {
  role?: RoomRole;
}

export interface CloudRecordingSession {
  id: string;
  roomId: string;
  appId: string;
  startedBy: string;
  startedAt: string;
  endedAt: string | null;
  status: "recording" | "completed" | "failed";
  filePath: string | null;
}

export interface CdnStreamSession {
  id: string;
  roomId: string;
  appId: string;
  streamKey: string;
  rtmpPushUrl: string;
  hlsPlaybackUrl: string;
  startedBy: string;
  startedAt: string;
  endedAt: string | null;
  status: "active" | "stopped";
  mode: "webrtc_bridge" | "rtmp_push";
}

export interface RTCEvents {
  connected: [{ userId: string }];
  disconnected: [];
  reconnecting: [{ attempt: number; delayMs: number }];
  reconnected: [];
  roomJoined: [{ roomId: string; members: string[]; role?: RoomRole }];
  userJoined: [{ roomId: string; userId: string; role?: RoomRole }];
  userLeft: [{ roomId: string; userId: string }];
  userKicked: [{ roomId: string; reason?: string }];
  userMuted: [
    {
      roomId: string;
      targetUserId: string;
      kind: "audio" | "video";
      muted: boolean;
      byUserId: string;
    },
  ];
  roomEnded: [{ roomId: string }];
  broadcastJoined: [{ roomId: string }];
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
  /** Another room member joined group voice or video. */
  mediaParticipantJoined: [import("@rtc/protocol").MediaParticipantPayload];
  /** Another room member left group voice or video. */
  mediaParticipantLeft: [import("@rtc/protocol").MediaParticipantPayload];
  localStream: [{ stream: MediaStream | null }];
  remoteTrack: [RemoteTrackEvent];
  recordingStarted: [{ callId?: string; roomId: string }];
  recordingReady: [RecordingReadyEvent];
  transcriptReady: [TranscriptReadyEvent];
  summaryReady: [SummaryReadyEvent];
  callQuality: [CallQualityEvent];
  error: [{ message: string; code?: string }];
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
  serverUrl: string,
  appId?: string,
  token?: string
): Promise<import("@rtc/protocol").PlatformConfig> {
  const query = appId ? `?appId=${encodeURIComponent(appId)}` : "";
  const headers: HeadersInit = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${serverUrl}/v1/config${query}`, { headers });
  if (!res.ok) throw new Error("Failed to fetch platform config");
  return res.json();
}

export async function fetchIceConfig(
  serverUrl: string
): Promise<{ iceServers: IceServerConfig[] }> {
  return fetchPlatformConfig(serverUrl);
}

export type { ClientMessage, ServerMessage, CallType };
