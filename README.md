# RTC Platform

Zego-style embeddable SDK for **one-on-one chat**, **voice calls**, and **group voice** via mediasoup SFU.

## Structure

```
rtc-platform/
├── packages/
│   ├── protocol/     # Shared message types
│   ├── signaling/    # WebSocket + REST + app registry
│   ├── sdk/          # @rtc/sdk — embed in any app (npm-ready)
│   ├── media-sfu/    # mediasoup SFU service
│   └── demo/         # Integration demo
├── docker-compose.yml
```

## Quick start

```bash
cd rtc-platform
npm install
npm run dev:infra    # postgres, redis, coturn (first time)
cp packages/signaling/.env.example packages/signaling/.env
npm run dev          # signaling + SFU + demo
```

- Signaling: http://localhost:4000
- SFU: http://localhost:4100
- Demo: http://localhost:5180

## Phase 4 — SFU voice + group calls

The SDK routes voice through **mediasoup** when `SFU_URL` is configured and `mediaMode` is `auto` or `sfu`.

### Media modes

| Mode | Behavior |
|------|----------|
| `auto` | SFU when available, else P2P (default) |
| `sfu` | Always use mediasoup (falls back to P2P if SFU offline) |
| `p2p` | Direct WebRTC between peers |

### SDK — 1:1 call + group voice

```ts
import { RTCExpress } from "@rtc/sdk";

const rtc = new RTCExpress();
await rtc.init({
  serverUrl: "http://localhost:4000",
  appId: "demo-app",
  userId: "user_123",
  token,
  mediaMode: "auto", // or "sfu" | "p2p"
});

await rtc.joinRoom("room-1");
rtc.sendMessage("Hello");

// 1:1 voice — uses SFU when mediaMode resolves to sfu
await rtc.callUser("user_456");

// Group voice — all room members hear each other via SFU
await rtc.joinVoiceRoom();
rtc.leaveVoiceRoom();

rtc.getMediaMode(); // "p2p" | "sfu"
```

### Demo

1. Open http://localhost:5180 in two tabs (User A / User B panels, or two browser windows).
2. Connect both with different user IDs, same room ID.
3. **Join room** on both.
4. Try **1:1 Call** (SFU when Auto/SFU mode) or **Join group voice** for multi-user audio.

## Phase 5 — Production hardening

### Health checks

| Service | Liveness | Readiness |
|---------|----------|-----------|
| Signaling | `GET /health` | `GET /ready` (Redis + PostgreSQL when configured) |
| Media SFU | `GET /health` | `GET /ready` (mediasoup worker) |

### Production env guards

Set `NODE_ENV=production` and provide strong secrets. The server **fails fast** if:

- `JWT_SECRET` or `ADMIN_API_KEY` use dev defaults
- `DATABASE_URL` is missing (signaling)
- `ANNOUNCED_IP` is still `127.0.0.1` (media-sfu)

### Docker full stack

```bash
docker compose up -d --build
```

Starts postgres, redis, coturn, signaling, and media-sfu.

### Graceful shutdown

Both services handle `SIGTERM` / `SIGINT` — drain WebSockets, close Redis/DB, stop mediasoup worker.

### Publish SDK to npm

```bash
npm run build:sdk
npm run pack:sdk    # verify tarballs locally
# Publish @rtc/protocol first, then @rtc/sdk
npm publish -w @rtc/protocol
npm publish -w @rtc/sdk
```

## Events + webhooks

Room, message, and call activity is persisted to the `events` table (requires `DATABASE_URL`)
and pushed to registered webhook endpoints.

### Event types

| Event | Emitted when |
|-------|--------------|
| `user.joined` / `user.left` | A user joins or leaves a room (incl. disconnect) |
| `message.sent` | A room message is delivered |
| `call.ringing` | A call invite is relayed |
| `call.connected` | Callee accepts |
| `call.failed` | Callee rejects |
| `call.ended` | Either side ends the call |

### Register a webhook

```bash
curl -X POST http://localhost:4000/v1/admin/apps/demo-app/webhooks \
  -H "x-admin-key: dev-admin-key" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://your-app.com/hooks/rtc\",\"events\":[\"call.ended\",\"user.joined\"]}"
```

Returns the webhook `secret` once — store it. Deliveries are `POST`ed as:

```json
{ "type": "user.joined", "appId": "demo-app", "data": { "roomId": "room-1", "userId": "u1" },
  "eventId": "42", "createdAt": "2026-01-01T00:00:00.000Z" }
```

### Verify the signature

Each delivery carries an `X-RTC-Signature` header — HMAC-SHA256 of the raw body using your secret.
Failed deliveries retry up to 3 times with backoff; every attempt is logged to `webhook_deliveries`.

```js
import { createHmac, timingSafeEqual } from "crypto";

const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-rtc-signature"]));
```

## Call sessions

Each 1:1 call is recorded as a row in `call_sessions`, driven by the same `call.*` events.
This is the record voice billing is derived from.

| Status | Meaning |
|--------|---------|
| `ringing` | Invite sent, not yet answered |
| `connected` | Callee accepted, call in progress |
| `ended` | Either side hung up |
| `rejected` | Callee declined |
| `abandoned` | Connection dropped without a hangup |

**Billable duration runs from answer to hangup** — time spent ringing is excluded.
If a socket drops mid-call the session is closed automatically with
`end_reason = disconnected`, so a lost connection can't leave a call billing forever.

```bash
curl "http://localhost:4000/v1/admin/apps/demo-app/calls?status=ended" \
  -H "x-admin-key: dev-admin-key"

curl http://localhost:4000/v1/admin/apps/demo-app/calls/stats \
  -H "x-admin-key: dev-admin-key"
# { "totalCalls": 3, "connectedCalls": 2, "totalDurationSeconds": 5,
#   "participantSeconds": 10, "participantMinutes": 0.17, ... }
```

`participantSeconds` is the exact figure to bill on; `participantMinutes` is the same value
as fractional minutes. Group (SFU) voice is not yet tracked as sessions — see the roadmap.

## Phase 3 — App registry + infrastructure

### 1. Start infrastructure

```bash
npm run dev:infra
```

Starts **PostgreSQL**, **Redis**, and **coturn**.

### 2. Configure signaling

```bash
cp packages/signaling/.env.example packages/signaling/.env
```

Key variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL app registry |
| `ADMIN_API_KEY` | Create new customer apps |
| `REDIS_URL` | Multi-instance signaling |
| `SFU_URL` | mediasoup service URL for clients |

### 3. Register a new app (like Zego App ID)

```bash
curl -X POST http://localhost:4000/v1/admin/apps \
  -H "x-admin-key: dev-admin-key" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"My Product\"}"
```

Returns `appId` + `appSecret` (store the secret securely).

### 4. Build publishable SDK

```bash
npm run build:sdk
```

Output: `packages/sdk/dist` (ESM + CJS + types). See `packages/sdk/README.md` for integration guide.

## Demo credentials (auto-seeded)

| Key | Value |
|-----|-------|
| App ID | `demo-app` |
| App Secret | `demo-secret` |
| Admin key | `dev-admin-key` |

## API overview

| Endpoint | Description |
|----------|-------------|
| `POST /v1/token` | Issue user JWT |
| `GET /v1/config` | ICE/TURN + SFU URL + feature flags |
| `POST /v1/admin/apps` | Register new app |
| `GET /v1/admin/apps` | List apps |
| `POST /v1/admin/apps/:appId/webhooks` | Register webhook endpoint |
| `GET /v1/admin/apps/:appId/webhooks` | List webhooks |
| `DELETE /v1/admin/apps/:appId/webhooks/:id` | Remove webhook |
| `GET /v1/admin/apps/:appId/events` | Call/message event log (`?type=&limit=`) |
| `GET /v1/admin/apps/:appId/usage` | Event counts per type |
| `GET /v1/admin/apps/:appId/calls` | Call history (`?status=&userId=&limit=`) |
| `GET /v1/admin/apps/:appId/calls/stats` | Call totals + participant minutes |
| `GET /v1/admin/apps/:appId/calls/:callId` | Single call detail |
| `WS /ws?token=` | Signaling (chat, calls, SFU producer discovery) |
| `POST /v1/rooms/:id/join` | SFU — join media room |

## Architecture

```
Customer App → @rtc/sdk
                 ├─ WebSocket → Signaling (chat + call setup + sfu_producer)
                 ├─ WebRTC P2P → Voice (mediaMode: p2p)
                 └─ mediasoup SFU → 1:1 + group voice (mediaMode: sfu)

Signaling → PostgreSQL (apps) + Redis (rooms/relay)
media-sfu → mediasoup router/transports/producers
```

## Roadmap status

| Phase | Status |
|-------|--------|
| P2P chat + voice | Done |
| Redis multi-node | Done |
| TURN + ICE API | Done |
| PostgreSQL app registry | Done |
| SDK npm packaging | Done |
| mediasoup SFU service | Done |
| SDK ↔ SFU voice path | Done |
| Group voice (SFU) | Done |
| Production hardening | Done |
| npm publish + cloud deploy | Next |
