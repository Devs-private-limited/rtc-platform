# rtcexpress-react-native

React Native SDK for [RTCExpress](https://rtc.devsquarelabs.com): add **voice calls, video calls and in-app chat** to your app. RTCExpress hosts the signaling, TURN relay and SFU, so your app only needs a token from your backend.

- Room chat
- 1:1 voice and video calls (P2P, or through the SFU)
- Mute microphone/camera, switch camera, accept/reject/end
- Native video renderer (`RTCVideoView`, Android)
- Push device registration helper (`RTCPushClient`)
- **Ready-made call screens** (`CallScreen`, `GroupCallScreen`): incoming, ringing, in-call and group call UI in a few lines

**Website:** https://rtc.devsquarelabs.com · **Docs:** https://rtc.devsquarelabs.com/docs · Also on [npm for web](https://www.npmjs.com/package/rtcexpress) and [pub.dev for Flutter](https://pub.dev/packages/rtcexpress) · **For AI tools:** https://rtc.devsquarelabs.com/llms-full.txt

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

// Group voice/video in the current room (Android; Pro plan or higher):
rtc.joinVideoRoom();       // or joinVoiceRoom()
rtc.on('mediaParticipant', (p) => console.log(p.userId, p.joined ? 'joined' : 'left'));
rtc.on('audioLevels', (levels) => setSpeaking(levels)); // { alice: 0.8, bob: 0.1 }, ~3x a second
<RTCVideoView userId="bob" style={{ flex: 1 }} />    // one tile per person
rtc.leaveVideoRoom();

// When the screen unmounts:
rtc.destroy();
```

Events: `connected`, `disconnected`, `roomJoined`, `message`, `callInvite`, `callState`, `remoteVideo`, `groupMedia`, `mediaParticipant` (`{ roomId, userId, joined }`), `audioLevels` (`{ [userId]: 0..1 }`, highlight who is speaking), `diagnostics`, `error`.

## Ready-made call screens (UI kit)

Don't want to design call screens yourself? Use the built-in ones. No extra packages needed.

```tsx
import RTCExpress, { useRTCCall, CallScreen } from 'rtcexpress-react-native';

const rtc = new RTCExpress(); // init + joinRoom as shown above

export default function App() {
  const call = useRTCCall(rtc);

  return (
    <View style={{ flex: 1 }}>
      <Button title="Voice call Bob" onPress={() => call.startCall('bob')} />
      <Button title="Video call Bob" onPress={() => call.startCall('bob', { video: true })} />

      {/* Last in your root view: covers the app while a call is ringing or active */}
      <CallScreen controller={call} />
    </View>
  );
}
```

What you get:

- **Incoming call:** caller name, Answer / Decline, the phone vibrates while it rings.
- **Outgoing call:** "Ringing…", then "Connecting…".
- **In call:** timer, Mute, Camera on/off and Flip (video), End. Video calls show the other person full screen and you in a small corner window. "speaking" shows when the other person talks (paid plans).
- **After the call:** "Call ended", "Call declined", "Missed call" or "Call failed" with the reason, for 1.5 seconds.
- Microphone/camera permission is asked for you before calling or answering (Android).
- **Screen sharing** (Android, Pro plan): a **Share** button in calls. When the other person shares, their screen shows big and the cameras small at the bottom; group calls show the screen big with everyone in a row below it. A red "You're sharing your screen" label shows while you share.
- **Minimize:** the Android back button (or the ⌄ arrow) hides the call screen while the call continues, so people can use the rest of your app. Add the ongoing-call bar to get back:

```tsx
<View style={{ flex: 1 }}>
  <OngoingCallBar call={call} group={group} />   {/* green "Bob · 1:23 · Tap to return" bar */}
  <YourNavigation />
  <CallScreen controller={call} />
</View>
```

**Group calls** (group voice needs Starter, group video needs Pro) in the room you joined:

```tsx
import { useRTCGroupCall, GroupCallScreen } from 'rtcexpress-react-native';

const group = useRTCGroupCall(rtc, myUserId);

<Button title="Start group video" onPress={() => group.join('video')} /> // or 'voice'
<GroupCallScreen controller={group} userId={myUserId} title="Family" />
{group.error && <Text>{group.error}</Text>} // e.g. plan doesn't include group calls
```

One tile per person (camera or initials), a green frame around whoever is speaking, people count + timer, and Mute / Camera / Flip / Leave.

**Make it yours:**

```tsx
<CallScreen
  controller={call}
  displayName={(userId) => contacts[userId]?.name ?? userId}
  theme={{ background: '#111827', accept: '#10b981' }}
  labels={{ answer: 'Accept', hangUp: 'Hang up' }} // any text, e.g. another language
/>
```

`useRTCCall(rtc, { onCallEnded })` lets you save each call in your own call history: `call.endReason` is `ended`, `declined`, `missed`, `cancelled` or `failed`.

Want your own design instead? Use only the hook: `call.call` has `peerUserId`, `video`, `direction`, `phase` (`ringing` / `connecting` / `connected` / `ended`), `connectedAt`, and the controller has `accept`, `decline`, `hangUp`, `toggleMute`, `toggleCamera` and `switchCamera`. `CallAvatar` and `CallButton` are exported too.

Note: the screens show calls while your app is open. To ring a phone when the app is closed, also set up push (see "Incoming calls when the app is closed" in the docs).

## Screen sharing (Android)

The call screens above already have a Share button. Without the UI kit:

```tsx
rtc.startScreenShare();    // Android asks "Start recording or casting?" first
rtc.stopScreenShare();
rtc.on('screenShare', (p) => {}); // { userId, active, local, cancelled? }

// Someone shares: their screen big, cameras small
<RTCVideoView screen userId={p.userId} style={{ flex: 1 }} />
<RTCVideoView style={{ width: 96, height: 128 }} />        // their camera
<RTCVideoView local style={{ width: 96, height: 128 }} />  // you
```

Needs a plan with screen sharing (Pro or higher) and calls through the media server (`mediaMode: 'auto'`, the default). Browser users of the web SDK see a phone's shared screen, and phones see a browser's shared screen.

## Calls in the background (Android)

Calls keep working when the user goes to another app or turns the screen off. During a call the SDK shows an **"Ongoing call" notification** with a timer (tap it to go back to the app, or press **Hang up**), the same way WhatsApp does. Android requires this notification for an app to keep using the microphone/camera in the background. It's on by default; turn it off with `ongoingCallNotification: false` in `rtc.init()` if your app has its own.

Publishing on Google Play (target Android 14+): the SDK declares foreground services of type `microphone`, `camera` and `mediaProjection`, so fill in the "Foreground service permissions" form in Play Console (reasons: "ongoing voice/video call" and "screen sharing during a call").

## Support

Email support@devsquarelabs.com. Integration guides: https://github.com/Devs-private-limited/rtcexpress-guides

## License

MIT © Devsquare Labs
