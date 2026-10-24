# RTCExpress Web SDK

Add **voice calls, video calls and in-app chat** to any web app. RTCExpress handles signaling, TURN relay and group media (SFU) for you, with a simple flat monthly price.

- 1:1 voice and video (peer-to-peer, or through the SFU)
- Group voice and video rooms
- Text chat with history, presence, screen sharing, recording
- Auto-reconnect, roles and moderator controls, call quality metrics

**Website:** https://rtc.devsquarelabs.com · **Docs:** https://rtc.devsquarelabs.com/docs · **Live demo:** https://api.devsquarelabs.com/demo/

## Install

```bash
npm install rtcexpress
```

You need an App ID and App Secret. Create a free account at https://rtc.devsquarelabs.com to get them.

## Quick integration

```ts
import { RTCExpress } from "@rtc/sdk";

// 1. Your backend requests a token from the RTC signaling server
const { token } = await RTCExpress.fetchToken("https://api.devsquarelabs.com", {
  appId: "your-app-id",
  appSecret: "your-app-secret", // server-side only
  userId: "user_123",
});

// 2. Initialize SDK in your frontend
const rtc = new RTCExpress();
await rtc.init({
  serverUrl: "https://api.devsquarelabs.com",
  appId: "your-app-id",
  userId: "user_123",
  token,
  mediaMode: "auto", // "p2p" | "sfu" | "auto"
});

// 3. Join a room and chat
rtc.on("message", ({ fromUserId, text }) => {
  console.log(fromUserId, text);
});

await rtc.joinRoom("support-room-42");
rtc.sendMessage("Hello");

// 4. Voice call
rtc.on("callInvite", ({ fromUserId }) => {
  // show incoming call UI
});

await rtc.callUser("user_456");
await rtc.acceptCall();
rtc.muteMicrophone(true);
await rtc.endCall();

// Group voice (SFU) — all room members hear each other
await rtc.joinVoiceRoom();
rtc.leaveVoiceRoom();
rtc.getMediaMode(); // "p2p" | "sfu"
```

## Server setup (your backend)

Never expose `appSecret` in client code. Your server calls:

```http
POST https://api.devsquarelabs.com/v1/token
Content-Type: application/json

{
  "appId": "...",
  "appSecret": "...",
  "userId": "user_123",
  "roomId": "optional"
}
```

Returns `{ "token": "...", "expiresIn": 3600 }`.

## Events

| Event | Payload |
|-------|---------|
| `connected` | `{ userId }` |
| `roomJoined` | `{ roomId, members }` |
| `userJoined` | `{ roomId, userId }` |
| `userLeft` | `{ roomId, userId }` |
| `message` | `{ roomId, fromUserId, text, sentAt }` |
| `callInvite` | `{ callId, fromUserId, toUserId, roomId }` |
| `callState` | `{ callId, state, peerUserId, roomId, mediaMode? }` |
| `voiceRoomJoined` | `{ roomId, mediaMode }` |
| `voiceRoomLeft` | `{ roomId }` |
| `error` | `{ message }` |

## Platform config

On `init()`, the SDK loads `GET /v1/config` for ICE/TURN servers, SFU URL, and feature flags (`voiceSfu`, `voiceP2P`, `chat`).

## Browser requirements

- HTTPS (or localhost) for `getUserMedia`
- Modern browsers with WebRTC support

## Support

Email support@devsquarelabs.com. Integration guides: https://github.com/Devs-private-limited/rtcexpress-guides

## License

MIT © Devsquare Labs
