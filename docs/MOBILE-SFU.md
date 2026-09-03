# Mobile SFU integration

## Status

| Platform | Group voice/video (SFU) | 1:1 via SFU | Dependency |
|----------|-------------------------|-------------|------------|
| **Web** | ✅ Full | ✅ | `mediasoup-client` (JS) |
| **Android** | ✅ Full | ✅ | `io.github.haiyangwu:mediasoup-client:3.4.0` |
| **iOS** | 🔜 REST + signaling only | 🔜 P2P works; SFU needs Swift package | [mediasoup-client-swift](https://github.com/VLprojects/mediasoup-client-swift) |

## Android (ready)

Set `mediaMode` to `"auto"` or `"sfu"` in `RTCInitOptions`:

```kotlin
rtc.init(
    RTCInitOptions(
        serverUrl = "https://rtcplatform.duckdns.org",
        appId = "demo-app",
        userId = "user_a",
        token = token,
        mediaMode = "auto"
    )
)
rtc.joinRoom("room-1")
rtc.joinVoiceRoom()   // group voice via SFU
rtc.joinVideoRoom()   // group video via SFU
```

SFU API calls include `Authorization: Bearer <JWT>` (same token as signaling).

## iOS (add mediasoup-client-swift)

1. Add to `Package.swift`:

```swift
.package(url: "https://github.com/VLprojects/mediasoup-client-swift.git", branch: "master")
```

2. Replace `SfuMediaEngine.swift` transport/produce/consume logic using the [VLprojects example](https://github.com/VLprojects/mediasoup-client-swift).

3. Until then, use **P2P** for 1:1 calls on iOS:

```swift
RTCInitOptions(..., mediaMode: "p2p")
```

Group calls on iOS require the Mediasoup Swift package — `joinVoiceRoom()` validates SFU auth then returns an error with setup instructions.

## Server requirements

- `SFU_URL` configured on signaling server
- `JWT_SECRET` shared between signaling and media-sfu (Phase A)
- GCP firewall: UDP `40000-40100` for mediasoup

## Cross-platform group call

| Client A | Client B | Works? |
|----------|----------|--------|
| Web | Web | ✅ |
| Android | Android | ✅ |
| Web | Android | ✅ |
| iOS | Web | ❌ until iOS SFU package added |
| iOS | Android | ❌ until iOS SFU package added |
