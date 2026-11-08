## 0.1.2

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
