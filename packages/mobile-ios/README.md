# RTCExpress iOS SDK

Swift package for **chat** and **P2P voice/video calls** against the RTCExpress signaling server.

## Requirements

- iOS 15+
- Microphone and camera usage descriptions in `Info.plist`

## Install (Swift Package Manager)

In Xcode: **File → Add Package Dependencies**

```
https://github.com/Devs-private-limited/rtc-platform
```

Select package path: `packages/mobile-ios`

Or locally:

```swift
.package(path: "../rtc-platform/packages/mobile-ios")
```

## Quick start

```swift
import RTCExpress

final class RoomController: RTCExpressDelegate {
    let rtc = RTCExpress()

    func start() async {
        rtc.delegate = self

        // 1. Token from YOUR backend — never embed appSecret in the app
        let token = try await TokenClient.fetchToken(
            serverUrl: "https://rtcplatform.duckdns.org",
            request: TokenRequest(appId: "YOUR_APP_ID", appSecret: "SERVER_ONLY", userId: "user_123")
        )

        // 2. Connect
        rtc.initClient(RTCInitOptions(
            serverUrl: "https://rtcplatform.duckdns.org",
            appId: "YOUR_APP_ID",
            userId: "user_123",
            token: token.token,
            mediaMode: "p2p"
        ))
    }

    func rtcExpress(_ rtc: RTCExpress, didConnect userId: String) {
        try? rtc.joinRoom("room-1")
    }

    func rtcExpress(_ rtc: RTCExpress, didReceive message: RoomMessage) {
        print("\(message.fromUserId): \(message.text)")
    }

    func rtcExpress(_ rtc: RTCExpress, didReceive invite: CallInvite) {
        try? rtc.acceptCall()
    }
}
```

## API (MVP)

| Method | Description |
|--------|-------------|
| `initClient(options)` | Connect to signaling |
| `joinRoom(roomId)` | Join chat room |
| `sendMessage(text)` | Send chat message |
| `callUser(peerId, video:)` | Start 1:1 call |
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
- [ ] CocoaPods / SPM registry publish
