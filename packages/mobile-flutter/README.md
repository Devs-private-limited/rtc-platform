# rtcexpress

Flutter plugin for [RTCExpress](https://rtc.devsquarelabs.com): add **voice calls, video calls and in-app chat** to your Flutter app. RTCExpress hosts the signaling, TURN relay and SFU, so your app only needs a token from your backend.

- Room chat with history
- 1:1 voice and video calls (P2P, or SFU on Android)
- Mute microphone/camera, switch camera, accept/reject/end
- Native video renderer widget (`RTCVideoView`, Android)
- Android supported; iOS experimental (see below)
- Events via `rtc.on(event, handler)`

**Website:** https://rtc.devsquarelabs.com · **Docs:** https://rtc.devsquarelabs.com/docs · **Web SDK:** [`rtcexpress` on npm](https://www.npmjs.com/package/rtcexpress)

## Platform support

| | Android (min SDK 24) | iOS 15+ |
|---|---|---|
| Chat, voice and video calls | ✅ | Experimental: not yet verified on devices |
| Chat history (`getHistory`) | ✅ | Not yet |
| `RTCVideoView` widget | ✅ | Not yet |

Android is the supported platform for this release. iOS sources are included but haven't been built and tested on devices yet. Please report issues to support@devsquarelabs.com.

## Install

```bash
flutter pub add rtcexpress
```

You need an App ID. Create a free account at https://rtc.devsquarelabs.com to get one.

### Android

The plugin declares `INTERNET`, `RECORD_AUDIO`, `CAMERA` and related permissions. Request microphone and camera permissions at runtime (for example with [`permission_handler`](https://pub.dev/packages/permission_handler)) before starting a call.

### iOS

Add usage descriptions to `ios/Runner/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Used for voice calls</string>
<key>NSCameraUsageDescription</key>
<string>Used for video calls</string>
```

Then run `cd ios && pod install`.

## Usage

Your **backend** requests a short-lived user token from RTCExpress (`POST https://api.devsquarelabs.com/v1/token` with your App ID, App Secret and the user ID). Keep the App Secret on the server, never in the app.

```dart
import 'package:rtcexpress/rtcexpress.dart';

final rtc = RTCExpress();

rtc.on('roomJoined', (p) => print('joined ${p['roomId']}'));
rtc.on('message', (p) => print('${p['fromUserId']}: ${p['text']}'));
rtc.on('callInvite', (p) => print('incoming call from ${p['fromUserId']}'));
rtc.on('callState', (p) => print('call ${p['state']}'));
rtc.on('error', (p) => print('error ${p['message']}'));

final token = await myBackend.getRtcToken(); // your own endpoint

await rtc.init(RTCInitOptions(
  serverUrl: 'https://api.devsquarelabs.com',
  appId: 'YOUR_APP_ID',
  userId: 'alice',
  token: token,
));

await rtc.joinRoom('support-42');
await rtc.sendMessage('Hello');

await rtc.callUser('bob', video: true); // caller
await rtc.acceptCall();                 // recipient, after callInvite
await rtc.muteMicrophone(true);
await rtc.endCall();
```

Show video during a call (Android):

```dart
SizedBox(height: 240, child: RTCVideoView());            // remote
SizedBox(width: 96, height: 128, child: RTCVideoView(local: true)); // self view
```

### Events

`connected`, `disconnected`, `roomJoined`, `message`, `callInvite`, `callState`, `remoteVideo`, `diagnostics`, `error`

## Example

See [`example/`](example/lib/main.dart). It reads its App ID and a test token (from the console's Token tools) via `--dart-define`.

## Support

Email support@devsquarelabs.com. Integration guides: https://github.com/Devs-private-limited/rtcexpress-guides
