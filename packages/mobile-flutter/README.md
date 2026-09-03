# rtcexpress — Flutter plugin

Flutter wrapper around the native Android and iOS RTC Platform SDKs.

## Add dependency

```yaml
dependencies:
  rtcexpress:
    path: ../packages/mobile-flutter   # or pub.dev when published
```

## Android setup

Point Gradle at the native SDK in `android/settings.gradle`:

```gradle
include ':rtcexpress-sdk'
project(':rtcexpress-sdk').projectDir = new File(settingsDir, '../../mobile-android/sdk')
```

## iOS setup

```bash
cd ios && pod install
```

## Usage

```dart
import 'package:rtcexpress/rtcexpress.dart';

final rtc = RTCExpress();

rtc.on('connected', (p) => print('connected ${p['userId']}'));
rtc.on('callInvite', (p) => print('incoming ${p['fromUserId']}'));

final tokenRes = await RTCExpress.fetchToken(
  'https://rtc.example.com',
  TokenRequest(appId: 'demo', appSecret: 'secret', userId: 'user-1'),
);

await rtc.init(RTCInitOptions(
  serverUrl: 'https://rtc.example.com',
  appId: 'demo',
  userId: 'user-1',
  token: tokenRes['token'] as String,
));

await rtc.joinRoom('room-1');
await rtc.callUser('user-2');
```

## MVP features

- Token auth, room join, chat
- 1:1 voice/video (P2P or SFU on Android)
- Mute, switch camera, call accept/reject/end
- Event stream via `rtc.on(event, handler)`

Run the example: `cd example && flutter run`
