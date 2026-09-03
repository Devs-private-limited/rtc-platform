# RTCExpress iOS SDK

Swift package for chat and WebRTC calls against the RTC Platform signaling server.

## Features

- WebSocket signaling (chat, 1:1 calls)
- P2P voice + video
- Chat history (`GET /v1/rooms/:id/messages`)
- Local call recording (microphone)
- Incoming call notifier hook for PushKit/CallKit
- Call busy handling
- SFU group calls — **requires** [mediasoup-client-swift](https://github.com/VLprojects/mediasoup-client-swift) (see [docs/MOBILE-SFU.md](../../docs/MOBILE-SFU.md))

## Setup

Add to your Xcode project via Swift Package Manager:

```
File → Add Package Dependencies → path: packages/mobile-ios
```

Or in `Package.swift`:

```swift
.package(path: "../mobile-ios")
```

`Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Voice calls</string>
<key>NSCameraUsageDescription</key>
<string>Video calls</string>
```

## Usage

```swift
let token = try await TokenClient.fetchToken(serverUrl: url, request: TokenRequest(...))

let rtc = RTCExpress()
rtc.delegate = self
rtc.incomingCallNotifier = self
rtc.initClient(RTCInitOptions(serverUrl: url, appId: appId, userId: userId, token: token.token, mediaMode: "p2p"))
rtc.joinRoom("room-1")

try rtc.callUser("user_b", video: true)

let page = try await rtc.getMessageHistory("room-1")

try rtc.startRecording()
let result = try rtc.stopRecording()
```

## API

| Method | Description |
|--------|-------------|
| `initClient(options)` | Connect signaling |
| `joinRoom` | Join chat room |
| `sendMessage` | Send chat |
| `getMessageHistory` | Paginated history |
| `callUser` / `acceptCall` / `rejectCall` / `endCall` | 1:1 P2P calls |
| `joinVoiceRoom` / `joinVideoRoom` | Group SFU (needs mediasoup-swift) |
| `startRecording` / `stopRecording` | Local mic recording |

## Push / background calls

See [docs/PUSH.md](../../docs/PUSH.md) for PushKit + CallKit.

## SFU on iOS

Use `mediaMode: "p2p"` for 1:1 today. For group SFU, follow [docs/MOBILE-SFU.md](../../docs/MOBILE-SFU.md).

## Roadmap

- [x] P2P voice + video
- [x] Chat + history
- [x] Local recording
- [x] Incoming call hooks
- [ ] SFU via mediasoup-client-swift
- [ ] CocoaPods / SPM registry publish
