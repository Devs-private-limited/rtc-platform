# Uptime monitor

A Cloudflare Worker (`rtcexpress-uptime-monitor`) that checks the production
backend every 5 minutes and emails the operator on state changes.

| Check | URL | Healthy when |
|---|---|---|
| Signaling API | `https://api.devsquarelabs.com/ready` | HTTP 200 and `"ready": true` |
| Media SFU | `https://api.devsquarelabs.com/sfu/ready` | HTTP 200 and `"ready": true` |

- **DOWN** email after 2 consecutive failures (about 10 minutes), so a single blip doesn't alert.
- **RECOVERED** email when it responds again, with how long it was down.
- One **Monitoring started** email per check the first time it runs (or after the KV state is cleared).
- Timeout per check: 10 seconds.

Emails come from `monitor@devsquarelabs.com` through Cloudflare Email Routing and go to
`devsquare67@gmail.com`. The destination must be a **verified destination address** in
Email Routing (Dashboard → Email → Email Routing → Destination addresses).

State is kept in the KV namespace `rtcexpress-uptime-state`
(`d966f9f95aaa42089477ae129aa3213d`), one key per check (`state:signaling`, `state:sfu`),
and only written when something changes.

## Commands

Run from this folder after `npx wrangler login`:

```sh
npx wrangler deploy                      # deploy changes
npx wrangler tail                        # watch live runs
npx wrangler kv key list --namespace-id d966f9f95aaa42089477ae129aa3213d --remote
npx wrangler kv key get state:signaling --namespace-id d966f9f95aaa42089477ae129aa3213d --remote
```

To change the alert address, update `ALERT_TO` and `send_email.destination_address` in
`wrangler.jsonc` (verify the new address in Email Routing first), then deploy.

## Limits

This only proves the HTTP readiness endpoints answer from Cloudflare's network. It does
not prove calls or media work across real networks, and it does not watch TURN
(coturn). It runs entirely on the Workers free plan.
