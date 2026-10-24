# rtcexpress-react-native

React Native SDK for [RTCExpress](https://rtc.devsquarelabs.com): add **voice calls, video calls and in-app chat** to your app. RTCExpress hosts the signaling, TURN relay and SFU, so your app only needs a token from your backend.

- Room chat
- 1:1 voice and video calls (P2P, or through the SFU)
- Mute microphone/camera, switch camera, accept/reject/end
- Native video renderer (`RTCVideoView`, Android)
- Push device registration helper (`RTCPushClient`)

**Website:** https://rtc.devsquarelabs.com · **Docs:** https://rtc.devsquarelabs.com/docs · Also on [npm for web](https://www.npmjs.com/package/rtcexpress) and [pub.dev for Flutter](https://pub.dev/packages/rtcexpress)

## Platform support

| | Android (min SDK 24) | iOS 15+ |
|---|---|---|
| Chat, voice and video calls | ✅ | Experimental: not yet verified on devices |
| `RTCVideoView` | ✅ | Not yet |

Android is the supported platform for this release. iOS sources are included but haven't been built and tested on devices yet. Please report issues to support@devsquarelabs.com.

## Install

```bash
npm install rtcexpress-react-native
```

React Native autolinking picks up the native module. No Gradle or Podfile edits are needed.

- **Android:** the package declares the `INTERNET`, `RECORD_AUDIO`, `CAMERA` and related permissions. Ask for microphone/camera permission at runtime (`PermissionsAndroid`) before a call.
- **iOS:** add `NSMicrophoneUsageDescription` and `NSCameraUsageDescription` to `Info.plist`, then run `cd ios && pod install`.

You need an App ID. Create a free account at https://rtc.devsquarelabs.com to get one.

## Usage

Your **backend** requests a short-lived user token from RTCExpress (`POST https://api.devsquarelabs.com/v1/token` with your App ID, App Secret and the user ID). Keep the App Secret on the server, never in the app.

```tsx
import RTCExpress, { RTCVideoView } from 'rtcexpress-react-native';

const rtc = new RTCExpress();

rtc.on('roomJoined', (p) => console.log('joined', p));
rtc.on('message', (p) => console.log('message', p));
rtc.on('callInvite', (p) => console.log('incoming call', p));
rtc.on('callState', (p) => console.log('call state', p));
rtc.on('error', (p) => console.warn('rtc error', p));

const token = await myBackend.getRtcToken(); // your own endpoint

await rtc.init({
  serverUrl: 'https://api.devsquarelabs.com',
  appId: 'YOUR_APP_ID',
  userId: 'alice',
  token,
});

rtc.joinRoom('support-42');
rtc.sendMessage('Hello');

rtc.callUser('bob', true); // true = video call
rtc.acceptCall();          // recipient, after callInvite
rtc.muteMicrophone(true);
rtc.endCall();

// During a video call (Android):
<RTCVideoView local={false} style={{ flex: 1 }} />
<RTCVideoView local style={{ width: 96, height: 128 }} />

// When the screen unmounts:
rtc.destroy();
```

Events: `connected`, `disconnected`, `roomJoined`, `message`, `callInvite`, `callState`, `remoteVideo`, `diagnostics`, `error`.

## Support

Email support@devsquarelabs.com. Integration guides: https://github.com/Devs-private-limited/rtcexpress-guides

## License

MIT © Devsquare Labs
