import { Platform, requireNativeComponent, type HostComponent, type ViewProps } from "react-native";

export type RTCVideoViewProps = ViewProps & {
  /** true renders the local camera preview; false (default) the remote video. */
  local?: boolean;
  /** Group video: show this person's camera (default: the newest remote camera). */
  userId?: string;
};

/** Native video renderer for the active call. Android only for now. */
export const RTCVideoView: HostComponent<RTCVideoViewProps> =
  Platform.OS === "android"
    ? requireNativeComponent<RTCVideoViewProps>("RTCVideoView")
    : ((() => {
        throw new Error("RTCVideoView currently supports Android only");
      }) as unknown as HostComponent<RTCVideoViewProps>);
