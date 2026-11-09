import { Platform, requireNativeComponent, type HostComponent, type ViewProps } from "react-native";

export type RTCVideoViewProps = ViewProps & {
  /** true renders the local camera preview; false (default) the remote video. */
  local?: boolean;
  /** Group video: show this person's camera (default: the newest remote camera). */
  userId?: string;
  /** Show a shared screen instead of a camera: this userId's, or the newest one. */
  screen?: boolean;
  /** Draw above other video, for small tiles over a big video (default: true for the self-view only). */
  overlay?: boolean;
};

/** Native video renderer for the active call. Android only for now. */
export const RTCVideoView: HostComponent<RTCVideoViewProps> =
  Platform.OS === "android"
    ? requireNativeComponent<RTCVideoViewProps>("RTCVideoView")
    : ((() => {
        throw new Error("RTCVideoView currently supports Android only");
      }) as unknown as HostComponent<RTCVideoViewProps>);
