import { DeviceEventEmitter, Platform, NativeModules, NativeEventEmitter, requireNativeComponent, type EmitterSubscription, type HostComponent, type ViewProps } from "react-native";
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

export type RTCVideoViewProps = ViewProps & {
  /** true renders the local camera preview; false (default) the remote video. */
  local?: boolean;
};

/** Native video renderer for the active call. Android only for now. */
export const RTCVideoView: HostComponent<RTCVideoViewProps> =
  Platform.OS === "android"
    ? requireNativeComponent<RTCVideoViewProps>("RTCVideoView")
    : ((() => {
        throw new Error("RTCVideoView currently supports Android only");
      }) as unknown as HostComponent<RTCVideoViewProps>);

export interface RTCInitOptions {
  serverUrl: string;
  appId: string;
  userId: string;
  token: string;
  mediaMode?: MediaMode;
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

  muteMicrophone(muted: boolean): void {
    Native.muteMicrophone(muted);
  }

  muteCamera(muted: boolean): void {
    Native.muteCamera(muted);
  }

  switchCamera(): void {
    Native.switchCamera();
  }

  destroy(): void {
    Native.destroy();
    for (const sub of this.subs) sub.remove();
    this.subs = [];
  }
}

export default RTCExpress;
