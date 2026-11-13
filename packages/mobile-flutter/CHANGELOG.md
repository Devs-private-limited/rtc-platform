## 0.1.7

- Docs only: API documentation comments for every public class and method, and the repository link now points to the package source. No code changes.

## 0.1.6

- Calls survive a short network drop (Wi-Fi off, switching networks): the call waits up to 30 s and continues when the network is back. Your side gets a `callState` event with `reconnecting`, the other side gets `peerReconnecting` (`{roomId, userId, reconnecting}`) so you can show "Reconnecting…". If the network doesn't come back within 30 s, the call ends on both sides.
- Android: fixed a crash when the video connection was rebuilt after a network drop.

## 0.1.5

- Android: ready for Google Play's 16 KB page size rule (Android 15+). The media library is now `com.devsquarelabs:mediasoup-client-android:3.4.0.1`, rebuilt with 16 KB pages; nothing changes in your code.

## 0.1.4

- New `remoteMediaState` event (`{roomId, userId, audioMuted, videoOff}`): show "muted" / "camera off" for the other people in a call or group. Your own `muteMicrophone` / `muteCamera` are sent to them automatically.
- Android: fixed "WebRTC native library missing" on P2P calls, a crash when someone stopped sharing their screen, and the "Ongoing call" timer start.
- Android: small video tiles can be drawn on top of a big video (screen share with cameras), shared screens show whole.

## 0.1.3

- Group video: when a call already has the most cameras (8), you join with audio only and get an error event saying why, instead of the join failing.
- Video quality in group calls now follows the number of cameras (set by the media server), so bigger calls use less data.

## 0.1.2

- Android: screen sharing in calls (`startScreenShare()` / `stopScreenShare()`, `screenShare` event, `RTCVideoView(screen: true)`), the same way as the web SDK. Needs a plan with screen sharing.
- `RTCVideoView(userId: ...)` shows one person's camera in group video.
- Android: calls keep working in other apps and with the screen off. An "Ongoing call" notification with a timer and a Hang up button is shown during calls (turn off with `ongoingCallNotification: false`).

## 0.1.1

- Android: calls now use the same media mode as your plan (P2P on Free, SFU when the plan includes it), so calls no longer fail with "SFU request failed".
- Android: a call ends on both sides when one phone hangs up, loses its connection or the app is closed while ringing.
- Android: clear error when a call type is not included in your plan, instead of a call stuck on "ringing".
- Android: video in SFU calls shows correctly.

## 0.1.0

- First public release. Android supported; iOS experimental (not yet verified on devices).
- Room chat with history, 1:1 voice and video calls (P2P, SFU on Android).
- Mute microphone/camera, switch camera, accept/reject/end calls.
- `RTCVideoView` native video renderer (Android).
- Native Android and iOS SDK sources bundled; no extra Gradle or CocoaPods setup.
