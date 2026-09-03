# RTCExpress Android SDK

Kotlin library for chat and WebRTC calls against the RTC Platform signaling server.

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
    implementation(project(":sdk")) // or Maven when published
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

## Media modes

| `mediaMode` | Behavior |
|-------------|----------|
| `p2p` | Direct WebRTC between peers |
| `sfu` | Always use mediasoup SFU |
| `auto` | SFU when server provides `sfuUrl` |

## Push notifications

See [docs/PUSH.md](../../docs/PUSH.md) for FCM + ConnectionService integration.

## Roadmap

- [x] P2P voice + video
- [x] Chat + history
- [x] SFU group voice/video
- [x] Local recording
- [x] Incoming call hooks
- [ ] Maven Central publish
- [ ] Two-party mixed recording (use web or cloud recording)
