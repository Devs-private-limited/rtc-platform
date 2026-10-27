# rtcexpress-server

Node.js server SDK for [RTCExpress](https://rtc.devsquarelabs.com): create the short-lived user tokens your apps need for **voice calls, video calls and in-app chat**.

Your App Secret must stay on your server. This package runs there: your backend signs the user in, decides which room they may join, and returns a token. The browser or mobile app passes that token to a client SDK ([Web](https://www.npmjs.com/package/rtcexpress), [React Native](https://www.npmjs.com/package/rtcexpress-react-native), [Flutter](https://pub.dev/packages/rtcexpress), Android).

- Node.js 18 or newer, no dependencies
- ESM and CommonJS, TypeScript types included

## Install

```bash
npm install rtcexpress-server
```

## Usage

```ts
import { RTCExpressServer } from 'rtcexpress-server';

const rtc = new RTCExpressServer({
  appId: process.env.RTC_APP_ID!,
  appSecret: process.env.RTC_APP_SECRET!,
});

// Example with Express: only signed-in users get a token, for one room.
app.post('/api/rtc-token', requireLogin, async (req, res) => {
  const { token, expiresIn } = await rtc.createToken({
    userId: req.user.id,
    roomId: req.body.roomId, // check the user may join this room first
  });
  res.json({ token, expiresIn });
});
```

CommonJS works too: `const { RTCExpressServer } = require('rtcexpress-server');`

### `new RTCExpressServer(options)`

| Option | Required | Description |
|---|---|---|
| `appId` | yes | Your project's App ID, from the [customer console](https://rtc.devsquarelabs.com/portal). |
| `appSecret` | yes | Your App Secret. Load it from an environment variable or secret store. |
| `serverUrl` | no | Defaults to `https://api.devsquarelabs.com`. |
| `timeoutMs` | no | Request timeout. Defaults to 10000. |

### `rtc.createToken({ userId, roomId?, role? })`

Returns `{ token, expiresIn }`, where `expiresIn` is in seconds (currently one hour).

- `userId`: your own ID for the user. Each device in a call needs its own.
- `roomId`: limits the token to one room. Recommended.
- `role`: `host`, `publisher`, `subscriber` or `audience`, for broadcast-style rooms.

### Errors

Failures throw `RTCExpressError` with a `status`:

| Status | Meaning |
|---|---|
| `401` | Wrong App ID or App Secret. |
| `400` | Missing or invalid values. |
| `429` | Too many token requests from your server (30 a minute per IP). Reuse a token until it is close to expiry. |
| `0` | RTCExpress could not be reached (network error or timeout). |

```ts
import { RTCExpressError } from 'rtcexpress-server';

try {
  await rtc.createToken({ userId: 'alice' });
} catch (err) {
  if (err instanceof RTCExpressError && err.status === 401) {
    // check RTC_APP_ID / RTC_APP_SECRET
  }
  throw err;
}
```

## Links

- Website and pricing: https://rtc.devsquarelabs.com
- Docs: https://rtc.devsquarelabs.com/docs
- Python server SDK: `pip install rtcexpress-server`
- Support: support@devsquarelabs.com

## License

MIT © Devsquare Labs
