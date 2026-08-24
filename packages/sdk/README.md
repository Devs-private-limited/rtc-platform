# @rtc/sdk

Embeddable SDK for real-time **1:1 chat**, **voice calls**, and **group voice** (mediasoup SFU).

## Install

```bash
npm install @rtc/sdk
```

For local monorepo development, link from `packages/sdk` after `npm run build`.

## Quick integration

```ts
import { RTCExpress } from "@rtc/sdk";

// 1. Your backend requests a token from the RTC signaling server
const { token } = await RTCExpress.fetchToken("https://signal.yourdomain.com", {
  appId: "your-app-id",
  appSecret: "your-app-secret", // server-side only
  userId: "user_123",
});

// 2. Initialize SDK in your frontend
const rtc = new RTCExpress();
await rtc.init({
  serverUrl: "https://signal.yourdomain.com",
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
POST /v1/token
Content-Type: application/json

{
  "appId": "...",
  "appSecret": "...",
  "userId": "user_123",
  "roomId": "optional"
}
```

Returns `{ "token": "...", "expiresIn": 3600 }`.

## Register a new app (admin)

```http
POST /v1/admin/apps
x-admin-key: your-admin-key
Content-Type: application/json

{ "name": "My Mobile App" }
```

Response includes `appId` and `appSecret` (shown once).

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
