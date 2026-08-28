# Quick Start — First Call in 5 Minutes

## Prerequisites

```bash
cd rtc-platform
npm install
npm run dev:infra
cp packages/signaling/.env.example packages/signaling/.env
npm run dev
```

Services:
- Signaling: http://localhost:4000
- SFU: http://localhost:4100
- RTC Demo: http://localhost:5180
- **Developer Dashboard**: http://localhost:5181

## Step 1 — Create a project

1. Open http://localhost:5181
2. Sign in with admin key: `dev-admin-key`
3. Click **Create project** — save **App ID** and **App Secret**

## Step 2 — Get a token (server-side)

```bash
curl -X POST http://localhost:4000/v1/token \
  -H "Content-Type: application/json" \
  -d '{"appId":"YOUR_APP_ID","appSecret":"YOUR_APP_SECRET","userId":"user_a"}'
```

Never expose `appSecret` in frontend code.

## Step 3 — Integrate the SDK

```ts
import { RTCExpress } from "@rtc/sdk";

const rtc = new RTCExpress();
await rtc.init({
  serverUrl: "http://localhost:4000",
  appId: "YOUR_APP_ID",
  userId: "user_a",
  token,
  mediaMode: "auto",
});

await rtc.joinRoom("room-1");
rtc.sendMessage("Hello!");
await rtc.callUser("user_b");
```

Or use the demo at http://localhost:5180 (panels for User A / User B).

## Step 4 — Register a webhook

In the dashboard → your project → **Webhooks**:
- URL: `https://webhook.site/your-id` (or your server)
- Events: `call.connected`, `call.ended`, `message.sent`
- Save the **webhook secret** — used to verify `X-RTC-Signature`

## Step 5 — Verify in dashboard

- **Overview** — messages, call minutes, event counts
- **Events** — live event log
- **Deliveries** — webhook delivery status

## Publish SDK (when ready)

```bash
npm run build:sdk
npm publish -w @rtc/protocol
npm publish -w @rtc/sdk
```

## Production deploy

```bash
npm run dev:stack   # full stack via Docker Compose
```

Set strong `JWT_SECRET` and `ADMIN_API_KEY` in production. Set `ANNOUNCED_IP` to your server's public IP for SFU.
