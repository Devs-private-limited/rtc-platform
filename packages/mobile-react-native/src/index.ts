import { DeviceEventEmitter, Platform, NativeModules, NativeEventEmitter, type EmitterSubscription } from "react-native";
export { RTCPushClient, type PushDeviceRegistration } from './push';

const LINKING_ERROR =
  "The package 'rtcexpress-react-native' doesn't seem to be linked. Run pod install (iOS) and rebuild.";

const Native = NativeModules.RTCExpress
  ? NativeModules.RTCExpress
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

const emitter = Platform.OS === "android" ? DeviceEventEmitter : new NativeEventEmitter(Native);

export type MediaMode = "p2p" | "sfu" | "auto";

export { RTCVideoView, type RTCVideoViewProps } from "./video";

export interface RTCInitOptions {
  serverUrl: string;
  appId: string;
  userId: string;
  token: string;
  mediaMode?: MediaMode;
  /**
   * Android: show an "Ongoing call" notification (tap = back to the app, Hang up button) so calls keep
   * working while the user is in another app or the screen is off. Default true.
   */
  ongoingCallNotification?: boolean;
}

export interface TokenRequest {
  appId: string;
  appSecret: string;
  userId: string;
  roomId?: string;
  role?: string;
}

export interface TokenResponse {
  token: string;
  expiresIn: number;
}

export type RTCEventName =
  | "connected"
  | "disconnected"
  | "roomJoined"
  | "message"
  | "callInvite"
  | "callState"
  | "remoteVideo"
  | "groupMedia"
  /** { roomId, userId, joined } when someone joins or leaves group voice/video. */
  | "mediaParticipant"
  /** { [userId]: 0..1 } about 3 times a second in SFU calls (you included): highlight who is speaking. */
  | "audioLevels"
  /** { userId, active, local, cancelled? } when someone (or this phone: local=true) starts/stops sharing their screen. */
  | "screenShare"
  | "diagnostics"
  | "error";

export class RTCExpress {
  private subs: EmitterSubscription[] = [];

  static async fetchToken(serverUrl: string, request: TokenRequest): Promise<TokenResponse> {
    return Native.fetchToken(serverUrl, request);
  }

  on(event: RTCEventName, handler: (payload: unknown) => void) {
    const sub = emitter.addListener(event, handler);
    this.subs.push(sub);
    return () => sub.remove();
  }

  async init(options: RTCInitOptions): Promise<void> {
    await Native.init(options);
  }

  joinRoom(roomId: string): void {
    Native.joinRoom(roomId);
  }

  sendMessage(text: string, clientMsgId = ""): void {
    if (Platform.OS === "android") Native.sendMessage(text, clientMsgId);
    else Native.sendMessage(text);
  }

  callUser(peerUserId: string, video = false): void {
    Native.callUser(peerUserId, video);
  }

  acceptCall(): void {
    Native.acceptCall();
  }

  rejectCall(): void {
    Native.rejectCall();
  }

  endCall(): void {
    Native.endCall();
  }

  /** Join group voice in the current room (Android; plan must include group voice). Errors arrive as "error" events. */
  joinVoiceRoom(): void {
    Native.joinVoiceRoom();
  }

  leaveVoiceRoom(): void {
    Native.leaveVoiceRoom();
  }

  /** Join group video in the current room (Android; plan must include group video). RTCVideoView shows the newest remote camera. */
  joinVideoRoom(): void {
    Native.joinVideoRoom();
  }

  leaveVideoRoom(): void {
    Native.leaveVideoRoom();
  }

  muteMicrophone(muted: boolean): void {
    Native.muteMicrophone(muted);
  }

  muteCamera(muted: boolean): void {
    Native.muteCamera(muted);
  }

  switchCamera(): void {
    Native.switchCamera();
  }

  /**
   * Android: share this phone's screen in the current call / group call (plan must include screen
   * sharing). Android first shows its own "Start recording or casting?" dialog. Listen to
   * "screenShare" for the result and "error" for problems. Show others' screens with
   * <RTCVideoView screen />.
   */
  startScreenShare(): void {
    if (Platform.OS !== "android") throw new Error("Screen sharing on iOS is not supported yet");
    Native.startScreenShare();
  }

  stopScreenShare(): void {
    if (Platform.OS === "android") Native.stopScreenShare();
  }

  destroy(): void {
    Native.destroy();
    for (const sub of this.subs) sub.remove();
    this.subs = [];
  }
}

export default RTCExpress;

// Ready-made call screens (UI kit).
export { useRTCCall, type RTCCall, type RTCCallController, type CallPhase, type CallEndReason, type UseRTCCallOptions } from "./ui/useRTCCall";
export { useRTCGroupCall, type RTCGroupCall, type RTCGroupCallController } from "./ui/useRTCGroupCall";
export { CallScreen, type CallScreenProps } from "./ui/CallScreen";
export { GroupCallScreen, type GroupCallScreenProps } from "./ui/GroupCallScreen";
export { OngoingCallBar, type OngoingCallBarProps } from "./ui/OngoingCallBar";
export { CallAvatar, CallButton, MinimizeButton } from "./ui/parts";
export { requestCallPermissions } from "./ui/permissions";
export { defaultCallTheme, defaultCallLabels, type RTCCallTheme, type RTCCallLabels } from "./ui/theme";
