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
| npm publish + production hardening | Next |
