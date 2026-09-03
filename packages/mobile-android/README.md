# RTCExpress Android SDK

Kotlin library for **chat** and **P2P voice/video calls** against the RTCExpress signaling server.

## Requirements

- Android 7.0+ (API 24)
- `INTERNET`, `RECORD_AUDIO`, `CAMERA` permissions

## Add to your app

```kotlin
// settings.gradle.kts
includeBuild("../rtc-platform/packages/mobile-android") // or publish to Maven

// app/build.gradle.kts
dependencies {
    implementation(project(":sdk"))
}
```

Or copy the `sdk/` module into your Android project.

## Quick start

```kotlin
val rtc = RTCExpress(applicationContext)
rtc.setListener(object : RTCExpress.Listener {
    override fun onConnected(userId: String) {
        rtc.joinRoom("room-1")
    }
    override fun onMessage(message: RoomMessage) {
        Log.d("RTC", "${message.fromUserId}: ${message.text}")
    }
    override fun onCallInvite(invite: CallInvite) {
        rtc.acceptCall()
    }
})

// 1. Get token from YOUR backend (never ship appSecret in the app)
val token = RTCExpress.fetchToken(
    "https://rtcplatform.duckdns.org",
    TokenRequest(appId = "YOUR_APP_ID", appSecret = "SERVER_ONLY", userId = "user_123")
)

// 2. Connect
rtc.init(
    RTCInitOptions(
        serverUrl = "https://rtcplatform.duckdns.org",
        appId = "YOUR_APP_ID",
        userId = "user_123",
        token = token.token,
        mediaMode = "p2p"
    )
)

// 3. Chat
rtc.sendMessage("Hello from Android!")

// 4. Voice call
rtc.callUser("user_456", video = false)
```

## API (MVP)

| Method | Description |
|--------|-------------|
| `init(options)` | Connect to signaling |
| `joinRoom(roomId)` | Join chat room |
| `sendMessage(text)` | Send chat message |
| `callUser(peerId, video)` | Start 1:1 call |
| `acceptCall()` / `rejectCall()` / `endCall()` | Call controls |
| `muteMicrophone` / `muteCamera` / `switchCamera` | Media controls |
| `destroy()` | Cleanup |

## Plan features

Server enforces plan limits (chat / voice / video). Set the project plan in the developer dashboard.

## Roadmap

- [x] P2P voice + video
- [x] Chat
- [ ] SFU group voice/video
- [ ] Recording
- [ ] Maven Central publish
