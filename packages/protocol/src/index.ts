export type ClientMessageType =
  | "join_room"
  | "leave_room"
  | "send_message"
  | "call_invite"
  | "call_accept"
  | "call_reject"
  | "call_end"
  | "webrtc_offer"
  | "webrtc_answer"
  | "ice_candidate"
  | "sfu_producer"
  | "recording_ready"
  | "call_quality_report"
  | "join_media"
  | "leave_media"
  | "kick_user"
  | "mute_remote"
  | "end_room";

export type ServerMessageType =
  | "connected"
  | "room_joined"
  | "user_joined"
  | "user_left"
  | "message"
  | "call_invite"
  | "call_accept"
  | "call_reject"
  | "call_end"
  | "webrtc_offer"
  | "webrtc_answer"
  | "ice_candidate"
  | "sfu_producer"
  | "recording_ack"
  | "transcript_ready"
  | "summary_ready"
  | "call_state"
  | "media_participant_joined"
  | "media_participant_left"
  | "user_kicked"
  | "user_muted"
  | "cloud_recording_state"
  | "error";

/** Group media a participant can be in. Mirrors joinVoiceRoom / joinVideoRoom. */
export type MediaKind = "voice" | "video";

export interface JoinMediaPayload {
  roomId: string;
  kind: MediaKind;
}

export interface MediaParticipantPayload {
  roomId: string;
  userId: string;
  kind: MediaKind;
}

export type CallState =
  | "idle"
  | "ringing"
  | "connecting"
  | "connected"
  | "ended"
  | "rejected";

export interface ClientMessage<T = unknown> {
  type: ClientMessageType;
  payload: T;
  requestId?: string;
}

export interface ServerMessage<T = unknown> {
  type: ServerMessageType;
  payload: T;
  requestId?: string;
}

export interface JoinRoomPayload {
  roomId: string;
  /** host | publisher | subscriber | audience (live broadcast listener) */
  role?: RoomRole;
}

export type RoomRole = "host" | "publisher" | "subscriber" | "audience";

export interface RoomMemberPayload {
  roomId: string;
  userId: string;
  role?: RoomRole;
}

export interface KickUserPayload {
  roomId: string;
  targetUserId: string;
}

export interface MuteRemotePayload {
  roomId: string;
  targetUserId: string;
  kind: "audio" | "video";
  muted: boolean;
}

export interface EndRoomPayload {
  roomId: string;
}

export interface CloudRecordingStatePayload {
  roomId: string;
  state: "started" | "stopped";
  sessionId?: string;
  recordingId?: string;
}

export interface SendMessagePayload {
  roomId: string;
  text: string;
  /** Client-assigned id echoed back on delivery, for dedupe against history. */
  clientMsgId?: string;
}

export interface RoomMessagePayload {
  roomId: string;
  fromUserId: string;
  text: string;
  sentAt: number;
  clientMsgId?: string;
}

/** A message as returned by the history endpoint. */
export interface StoredMessage {
  id: string;
  roomId: string;
  fromUserId: string;
  text: string;
  clientMsgId: string | null;
  sentAt: string;
}

export interface MessageHistoryPage {
  messages: StoredMessage[];
  /** Pass as `before` to fetch the next (older) page; null when exhausted. */
  nextCursor: string | null;
}

export type CallType = "voice" | "video";

export interface CallInvitePayload {
  roomId: string;
  toUserId: string;
  callId: string;
  callType?: CallType;
}

export interface CallPeerPayload {
  callId: string;
  fromUserId: string;
  toUserId: string;
  roomId: string;
  callType?: CallType;
}

export interface SessionDescriptionInit {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string;
}

export interface IceCandidateInit {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface WebRtcPayload {
  callId: string;
  fromUserId: string;
  toUserId: string;
  sdp?: SessionDescriptionInit;
  candidate?: IceCandidateInit;
}

export interface CallStatePayload {
  callId: string;
  state: CallState;
  peerUserId: string;
  roomId: string;
}

export interface SfuProducerPayload {
  callId?: string;
  roomId: string;
  producerId: string;
  fromUserId: string;
  toUserId?: string;
  kind?: "audio" | "video";
  source?: "camera" | "screen";
}

export interface RecordingReadyPayload {
  callId?: string;
  roomId: string;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
}

export interface RecordingAckPayload {
  recordingId: string;
  roomId: string;
  callId?: string;
}

export interface TranscriptReadyPayload {
  recordingId: string;
  roomId: string;
  callId?: string;
  transcript: string;
}

export interface SummaryReadyPayload {
  recordingId: string;
  roomId: string;
  callId?: string;
  summary: string;
  transcript: string;
}

export interface CallQualityMetrics {
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPct: number | null;
  inboundBitrateKbps: number | null;
  outboundBitrateKbps: number | null;
  audioLevel: number | null;
  connectionState: string | null;
  iceState: string | null;
}

export type QualityLabel = "excellent" | "good" | "fair" | "poor";

export interface CallQualityReportPayload {
  callId?: string;
  roomId: string;
  mediaMode: "p2p" | "sfu";
  metrics: CallQualityMetrics;
  qualityScore: number;
  qualityLabel: QualityLabel;
}

export interface TokenRequest {
  appId: string;
  appSecret: string;
  userId: string;
  roomId?: string;
  role?: RoomRole;
}

export interface TokenResponse {
  token: string;
  expiresIn: number;
}

export interface TokenClaims {
  appId: string;
  userId: string;
  roomId?: string;
  role?: RoomRole;
  iat: number;
  exp: number;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceConfigResponse {
  iceServers: IceServerConfig[];
}

export interface PlatformConfig extends IceConfigResponse {
  sfuUrl: string | null;
  features: {
    chat: boolean;
    voiceP2P: boolean;
    voiceSfu: boolean;
    videoP2P: boolean;
    videoSfu: boolean;
  };
}
