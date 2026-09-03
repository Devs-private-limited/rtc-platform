# Mobile SDKs (iOS & Android)

Native mobile SDKs for RTCExpress — same signaling server and token flow as the web SDK.

## Packages

| Platform | Path | Status |
|----------|------|--------|
| **Android** | `packages/mobile-android` | P2P chat + voice + video |
| **iOS** | `packages/mobile-ios` | P2P chat + voice + video |
| **Web** | `packages/sdk` | Full (P2P + SFU + recording) |

## Architecture

```
Your mobile app
    │
    ├─ POST /v1/token  (your backend, appSecret stays server-side)
    │
    ├─ WebSocket /ws?token=JWT  (signaling — chat, calls)
    │
    └─ WebRTC P2P  (voice/video media)
```

## Token flow (same as web)

1. Your **backend** calls `POST /v1/token` with `appId`, `appSecret`, `userId`
2. Mobile app receives JWT token from your API
3. SDK connects: `wss://your-server/ws?token=...`
4. `joinRoom` → chat, `callUser` → P2P call

## Feature parity

| Feature | Web SDK | Android | iOS |
|---------|---------|---------|-----|
| Chat | ✅ | ✅ | ✅ |
| 1:1 voice (P2P) | ✅ | ✅ | ✅ |
| 1:1 video (P2P) | ✅ | ✅ | ✅ |
| Group voice (SFU) | ✅ | 🔜 | 🔜 |
| Group video (SFU) | ✅ | 🔜 | 🔜 |
| Screen share | ✅ | 🔜 | 🔜 |
| Recording | ✅ | 🔜 | 🔜 |
| Flip camera | ✅ | ✅ | ✅ |

## Plan gating

Mobile apps use the same project plans as web. The server blocks:

- **Free** — chat only
- **Starter** — chat + voice
- **Pro** — chat + voice + video + recording

Set plans in the dashboard **Billing** tab.

## Production server

```
https://rtcplatform.duckdns.org
```

Use `mediaMode: "p2p"` on mobile for now (SFU group calls coming in Phase 2).

## Permissions

### Android (`AndroidManifest.xml`)

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.CAMERA" />
```

### iOS (`Info.plist`)

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Voice calls</string>
<key>NSCameraUsageDescription</key>
<string>Video calls</string>
```

## Next steps

1. Integrate Android or iOS SDK into your app
2. Add a backend endpoint that issues tokens
3. Test against https://rtcplatform.duckdns.org/demo/ with two users
4. Set project plan to **Pro** in dashboard for video calls

See platform READMEs:

- [Android SDK](../packages/mobile-android/README.md)
- [iOS SDK](../packages/mobile-ios/README.md)
