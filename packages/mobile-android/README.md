# RTCExpress Android SDK

Kotlin library for chat and WebRTC calls against the RTC Platform signaling server.

**Website:** https://rtc.devsquarelabs.com · **Android guide:** https://rtc.devsquarelabs.com/sdk/android · **Tutorial:** https://rtc.devsquarelabs.com/tutorials/android-voice-calling · **For AI tools:** https://rtc.devsquarelabs.com/llms-full.txt

## Features

- WebSocket signaling (chat, 1:1 calls)
- P2P voice + video
- **SFU group voice + video** (mediasoup via `haiyangwu/mediasoup-client`)
- Chat history (`GET /v1/rooms/:id/messages`)
- Local call recording (microphone)
- Incoming call notifier hook for push integration
- Call busy handling

## Setup

```kotlin
dependencies {
    implementation("com.devsquarelabs:rtcexpress-android:0.1.5") // Maven Central
}
```

Permissions in your app `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
```

## Usage

```kotlin
val token = RTCExpress.fetchToken(serverUrl, TokenRequest(appId, appSecret, userId))

val rtc = RTCExpress(applicationContext)
rtc.setListener(object : RTCExpress.Listener {
    override fun onCallInvite(invite: CallInvite) { /* show ring UI */ }
    override fun onRemoteVideo(track: VideoTrack) { /* attach to SurfaceViewRenderer */ }
})
rtc.setIncomingCallNotifier { invite, display ->
    // Foreground incoming call — for background use FCM (see docs/PUSH.md)
}
rtc.init(RTCInitOptions(serverUrl, appId, userId, token.token, mediaMode = "auto"))
rtc.joinRoom("room-1")

// 1:1 call
rtc.callUser("user_b", video = true)

// Group SFU
rtc.joinVoiceRoom()
rtc.joinVideoRoom()

// History
val page = rtc.getMessageHistory("room-1")

// Recording (local mic during call)
rtc.startRecording()
val result = rtc.stopRecording()
```

## API

| Method | Description |
|--------|-------------|
| `init(options)` | Connect signaling; fetch SFU config |
| `joinRoom(roomId)` | Join chat room |
| `sendMessage(text)` | Send chat message |
| `getMessageHistory(roomId)` | Paginated chat history |
| `callUser(peerId, video)` | Start 1:1 call (P2P or SFU) |
| `acceptCall` / `rejectCall` / `endCall` | Call controls |
| `joinVoiceRoom` / `leaveVoiceRoom` | Group voice (SFU) |
| `joinVideoRoom` / `leaveVideoRoom` | Group video (SFU) |
| `startRecording` / `stopRecording` | Local mic recording |
| `muteMicrophone` / `muteCamera` / `switchCamera` | Media controls |

Group calls: `Listener.onMediaParticipant(roomId, userId, joined)` tells you who joined or left, and `Listener.onAudioLevels(levels)` gives loudness 0.0–1.0 per user about 3 times a second (use it to highlight who is speaking). For one video tile per person, set `CallVideoView.userId = "bob"`; without `userId` the view shows the newest remote camera.

## Media modes

| `mediaMode` | Behavior |
|-------------|----------|
| `p2p` | Direct WebRTC between peers |
| `sfu` | Always use mediasoup SFU |
| `auto` | SFU when server provides `sfuUrl` |

## Calls in the background

Calls keep working when the user goes to another app or turns the screen off. During a call the SDK shows an **"Ongoing call" notification** with a timer (tap it to go back to the app, or press **Hang up**), the same way WhatsApp does. Android requires this notification for an app to keep using the microphone/camera in the background. It's on by default; turn it off with `RTCInitOptions(..., ongoingCallNotification = false)` if your app has its own.

Publishing on Google Play (target Android 14+): the SDK declares foreground services of type `microphone`, `camera` and `mediaProjection`, so fill in the "Foreground service permissions" form in Play Console (reasons: "ongoing voice/video call" and "screen sharing during a call").
Custom notification icon: `OngoingCallService.smallIcon = R.drawable.ic_call` (default: your app icon).

## Screen sharing

Share the phone's screen in a 1:1 call or a group call (plan with screen sharing, Pro or higher; calls must go through the media server: `mediaMode = "auto"` or `"sfu"`). Android shows its own "Start recording or casting?" dialog first, and a notification while sharing.

```kotlin
// 1. Ask Android (from your Activity)
val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    if (result.resultCode == Activity.RESULT_OK && result.data != null) rtc.startScreenShare(result.data!!)
}
rtc.checkCanShareScreen()                       // throws a clear message if not in a call
launcher.launch(rtc.createScreenShareIntent())

// 2. Stop (also stops by itself when the user taps "Stop" in Android's own controls)
rtc.stopScreenShare()

// 3. Others: listener.onScreenShare(userId, active). Show their screen big:
CallVideoView(context).apply { screen = true; userId = "bob" }   // userId optional: newest screen
```

Cameras keep showing in their own views while someone shares, so you can show the screen big and the cameras small.

## Push notifications

To ring the phone when your app is closed, you need **your own Firebase project**: add your app to it, upload its service-account key in the RTCExpress portal, and register each device. See [docs/PUSH.md](../../docs/PUSH.md) for the full steps and FCM + ConnectionService integration.

Register the device after `init()` (the SDK stores an installation ID and calls the API on a background thread):

```kotlin
FirebaseMessaging.getInstance().token.addOnSuccessListener { rtc.registerPushDevice(it) }
// on logout:
rtc.unregisterPushDevice()
```

Use `PushClient(context).registerDevice(serverUrl, rtcToken, fcmToken)` from `onNewToken()`. Unanswered calls also produce a **missed-call** notification (`type: rtc_missed_call`); see [docs/PUSH.md](../../docs/PUSH.md#missed-calls).

## Roadmap

- [x] P2P voice + video
- [x] Chat + history
- [x] SFU group voice/video
- [x] Local recording
- [x] Incoming call hooks
- [ ] Maven Central publish
- [ ] Two-party mixed recording (use web or cloud recording)
