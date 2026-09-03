# @rtc/react-native-sdk

React Native wrapper around the native Android and iOS RTC Platform SDKs.

## Install

```bash
npm install @rtc/react-native-sdk
```

### Android

In your app's `android/settings.gradle`, include the native SDK and this module:

```gradle
include ':rtcexpress-sdk'
project(':rtcexpress-sdk').projectDir = new File(rootDir, '../node_modules/@rtc/react-native-sdk/../../mobile-android/sdk')
```

Add to `MainApplication.java`:

```java
import com.rtcexpress.reactnative.RTCExpressPackage;
// ...
packages.add(new RTCExpressPackage());
```

### iOS

```bash
cd ios && pod install
```

## Usage

```typescript
import RTCExpress from '@rtc/react-native-sdk';

const rtc = new RTCExpress();

rtc.on('connected', ({ userId }) => console.log('connected', userId));
rtc.on('callInvite', (invite) => console.log('incoming', invite));

const { token } = await RTCExpress.fetchToken('https://rtc.example.com', {
  appId: 'demo',
  appSecret: 'secret',
  userId: 'user-1',
});

await rtc.init({
  serverUrl: 'https://rtc.example.com',
  appId: 'demo',
  userId: 'user-1',
  token,
  mediaMode: 'auto',
});

rtc.joinRoom('room-1');
rtc.callUser('user-2', false);
```

## Features (MVP)

- Token auth + room join/leave
- Text chat
- 1:1 voice/video calls (P2P or SFU when available)
- Mute mic/camera, switch camera
- Events via `rtc.on(event, handler)`

Group SFU on iOS requires [mediasoup-client-swift](https://github.com/VLprojects/mediasoup-client-swift) in the native iOS SDK.
