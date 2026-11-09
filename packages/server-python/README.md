# rtcexpress-server

Python server SDK for [RTCExpress](https://rtc.devsquarelabs.com): create the short-lived user tokens your apps need for **voice calls, video calls and in-app chat**.

Your App Secret must stay on your server. This package runs there: your backend signs the user in, decides which room they may join, and returns a token. The browser or mobile app passes that token to a client SDK ([Web](https://www.npmjs.com/package/rtcexpress), [React Native](https://www.npmjs.com/package/rtcexpress-react-native), [Flutter](https://pub.dev/packages/rtcexpress), Android).

- Python 3.8 or newer, no dependencies (standard library only)
- Type hints included

## Install

```bash
pip install rtcexpress-server
```

## Usage

```python
import os
from rtcexpress_server import RTCExpressServer

rtc = RTCExpressServer(
    app_id=os.environ["RTC_APP_ID"],
    app_secret=os.environ["RTC_APP_SECRET"],
)

result = rtc.create_token("alice", room_id="support-42")
print(result.token, result.expires_in)
```

### Example with FastAPI

```python
from fastapi import Depends, FastAPI

app = FastAPI()

@app.post("/api/rtc-token")
def rtc_token(user=Depends(current_user)):  # your own login check
    # Calling app: no room_id. One fixed room (support chat, meeting): room_id="support-42", after checking access.
    result = rtc.create_token(user.id)
    return {"token": result.token, "expiresIn": result.expires_in}
```

It works the same in Django or Flask. `create_token` is a normal (blocking) call; in async code you can run it with `await asyncio.to_thread(rtc.create_token, user_id)`.

### `RTCExpressServer(app_id, app_secret, server_url=..., timeout=10.0)`

| Argument | Required | Description |
|---|---|---|
| `app_id` | yes | Your project's App ID, from the [customer console](https://rtc.devsquarelabs.com/portal). |
| `app_secret` | yes | Your App Secret. Load it from an environment variable or secret store. |
| `server_url` | no | Defaults to `https://api.devsquarelabs.com`. |
| `timeout` | no | Request timeout in seconds. Defaults to 10. |

### `rtc.create_token(user_id, room_id=None, role=None)`

Returns a `TokenResponse` with `token` and `expires_in` (seconds, currently one hour).

- `user_id`: your own ID for the user. Each device in a call needs its own.
- `room_id`: limits the token to one room. Use it for a single fixed room (a support chat, one meeting); leave it out for calling apps.

**Calling apps (users call their contacts):** create the token WITHOUT a room (`create_token(user_id)`, one per user). After `init`, the app joins one room per contact named from both user IDs sorted (`dm_alice__bob`); to call, join that room again and call. Scoping a token to one contact's room means the user can be called only by that contact.
- `role`: `"host"`, `"publisher"`, `"subscriber"` or `"audience"`, for broadcast-style rooms.

### Errors

Failures raise `RTCExpressError` with a `status`:

| Status | Meaning |
|---|---|
| `401` | Wrong App ID or App Secret. |
| `400` | Missing or invalid values. |
| `429` | Too many token requests from your server (30 a minute per IP). Reuse a token until it is close to expiry. |
| `0` | RTCExpress could not be reached (network error or timeout). |

```python
from rtcexpress_server import RTCExpressError

try:
    rtc.create_token("alice")
except RTCExpressError as err:
    if err.status == 401:
        ...  # check RTC_APP_ID / RTC_APP_SECRET
    raise
```

## Links

- Website and pricing: https://rtc.devsquarelabs.com
- Docs: https://rtc.devsquarelabs.com/docs
- Node.js server SDK: `npm install rtcexpress-server`
- Support: support@devsquarelabs.com

## License

MIT © Devsquare Labs
