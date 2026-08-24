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
  | "sfu_producer";

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
  | "call_state"
  | "error";

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
}

export interface SendMessagePayload {
  roomId: string;
  text: string;
}

export interface RoomMessagePayload {
  roomId: string;
  fromUserId: string;
  text: string;
  sentAt: number;
}

export interface CallInvitePayload {
  roomId: string;
  toUserId: string;
  callId: string;
}

export interface CallPeerPayload {
  callId: string;
  fromUserId: string;
  toUserId: string;
  roomId: string;
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
}

export interface TokenRequest {
  appId: string;
  appSecret: string;
  userId: string;
  roomId?: string;
}

export interface TokenResponse {
  token: string;
  expiresIn: number;
}

export interface TokenClaims {
  appId: string;
  userId: string;
  roomId?: string;
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
  };
}
