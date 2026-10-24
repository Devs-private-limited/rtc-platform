# Move the platform to api.devsquarelabs.com

Today the website (rtc.devsquarelabs.com, on Cloudflare) calls the backend at
`rtcplatform.duckdns.org` for signup, login, the portal API, and `/demo/`. This
runbook moves the backend to `api.devsquarelabs.com` **without breaking** released
mobile demo apps, which still have the duckdns hostname built in.

Expect about one minute of downtime while containers restart. Restarting signaling
ends active calls, so do this during a quiet period.

## 1. Cloudflare DNS

Dashboard → `devsquarelabs.com` → DNS → Records → **Add record**:

| Type | Name | IPv4 address | Proxy status |
|---|---|---|---|
| A | `api` | `8.229.83.181` (the VM's static IP) | **DNS only (grey cloud)** |

It **must be DNS only**. Cloudflare's proxy carries HTTP/WebSocket traffic, but not the
TURN traffic (UDP/TCP 3478 and 49160–49200) or the WebRTC media ports (UDP 40000–40100)
that browsers send straight to the VM. Caddy also needs direct port 80/443 access to get its
Let's Encrypt certificate.

Check that it resolves: `nslookup api.devsquarelabs.com 1.1.1.1` should return `8.229.83.181`.

## 2. On the VM

```sh
cd ~/rtc-platform
git status --short            # stop if there are local changes you need to keep
git pull --ff-only origin main
nano .env.production
```

Change or add:

```
DOMAIN=api.devsquarelabs.com
LEGACY_DOMAIN=rtcplatform.duckdns.org
```

Leave `PUBLIC_IP` and `PUBLIC_WEBSITE_URL=https://rtc.devsquarelabs.com` as they are.

Recreate everything that reads `DOMAIN` (Caddy, coturn realm, signaling SFU/TURN/HLS URLs,
media-sfu's signaling URL), then rebuild the demo assets:

```sh
sudo docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Only configuration changed, so no image rebuild is needed. `up -d` recreates just the
containers whose settings changed. The demo uses relative URLs, so it needs no rebuild either.

## 3. Verify

```sh
curl -fsS https://api.devsquarelabs.com/ready        # new hostname, ready:true
curl -fsS https://rtcplatform.duckdns.org/ready      # old hostname still works
```

Then open `https://api.devsquarelabs.com/demo/` on two devices and make a call. If a call
connects only on the same Wi-Fi, check that the `api` record is DNS only (step 1).

## 4. Point the website at the new hostname

In `rtc-express-website/src/config.ts`, change the default:

```ts
import.meta.env.VITE_API_URL || "https://api.devsquarelabs.com"
```

Build and deploy the website. Then check that signup, login, the contact form, and
"Try the live demo" all work on the live site.

## 5. Later

- Update `rtc-demo-app/src/config.ts`, `rtc-flutter-demo/lib/demo_config.dart`,
  `apps/rn-test-app/src/config.ts`, and `packages/mobile-flutter/example/lib/main.dart` to the new
  hostname in their next release.
- Customers' projects receive the new `serverUrl` automatically from the portal (it reads `DOMAIN`).
- Keep `LEGACY_DOMAIN` set until no released app uses duckdns, then remove it.

## Rollback

Set `DOMAIN=rtcplatform.duckdns.org`, clear `LEGACY_DOMAIN`, and run the same `up -d` command.
The website keeps working the whole time, because its build still points at duckdns until step 4.

---

# Make devsquarelabs.com (the root domain) load

Right now `devsquarelabs.com` and `www.devsquarelabs.com` have no DNS records, so they fail.
Until there's a company page, redirect them to RTCExpress:

1. DNS → add **A** `@` → `192.0.2.1`, **Proxied (orange cloud)**. Do the same for `www`.
   The IP is a placeholder: Cloudflare answers the request before it reaches any server.
2. Rules → **Redirect Rules** → Create rule:
   - When: hostname equals `devsquarelabs.com` **or** hostname equals `www.devsquarelabs.com`
   - Then: Static redirect to `https://rtc.devsquarelabs.com`, status **301**, preserve query string.
3. Check: `curl -sI https://devsquarelabs.com` should return `301` with
   `location: https://rtc.devsquarelabs.com/`.

Email routing (the MX records for support@devsquarelabs.com) is not affected.
