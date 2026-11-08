# Dodo Payments setup

Status and next steps live in the workspace README (`E:\projects\README.md`, "Payments"). This file holds the exact values to enter in Dodo.

## Account

- Business name: RTCExpress · website `rtc.devsquarelabs.com` · Individual account
- Fees: ~4% + $0.40, +1.5% for international cards, +0.5% for subscriptions
- Payouts: INR to an Indian bank account (avoid the $25 USD SWIFT fee)

## Products (create in Test Mode first, then again in Live Mode)

Same for all four: **Brand** RTCExpress · **Tax Category** SaaS · **Pricing Type** Subscription · currency USD · no trial · image `marketing/assets/rtcexpress-logo-512.png` · leave Tax Inclusive, Localized Pricing, Purchasing Power Parity and Pay What You Want unticked · skip Credits and Entitlements.

| Name | Price | Repeat every | Test product ID |
|---|---|---|---|
| RTCExpress Starter (Monthly) | 9 | 1 Month | `pdt_0NqUeuNICKI797gGObwLU` |
| RTCExpress Starter (Yearly) | 90 | 1 Year | `pdt_0NqUtn11KpaySfPBB0yLj` |
| RTCExpress Pro (Monthly) | 29 | 1 Month | `pdt_0NqUuBaYs6N33vgVRyUHq` |
| RTCExpress Pro (Yearly) | 290 | 1 Year | `pdt_0NqUuWje0uqaMeMsgP2GO` |

Test IDs were read from a screenshot (25 Oct 2026). Letters like I/l/1 and O/0 can be misread, so copy the exact IDs from Dodo (or list them via the API) before relying on them.

Descriptions:

- **Starter (Monthly):** Chat plus 1:1 and group voice calling for one RTCExpress project: 100,000 chat messages and 30,000 voice participant minutes each paid month, webhooks and email support. Billed monthly, cancel anytime.
- **Starter (Yearly):** Chat plus 1:1 and group voice calling for one RTCExpress project: 1,200,000 chat messages and 360,000 voice participant minutes for the year, usable any time, webhooks and email support. Billed yearly (2 months free), cancel anytime.
- **Pro (Monthly):** Chat, voice and video calling (group video up to 8 cameras) with screen sharing for one RTCExpress project: 500,000 chat messages, 50,000 voice and 10,000 video participant minutes each paid month, priority email support. Billed monthly, cancel anytime.
- **Pro (Yearly):** Chat, voice and video calling (group video up to 8 cameras) with screen sharing for one RTCExpress project: 6,000,000 chat messages, 600,000 voice and 120,000 video participant minutes for the year, usable any time, priority email support. Billed yearly (2 months free), cancel anytime.

Minute packs (Pricing Type **One-time payment**, created in Live 8 Nov 2026, names must match exactly):

| Name | Price | Description |
|---|---|---|
| RTCExpress Voice Minutes Pack | 6 | 20,000 extra voice participant minutes for one RTCExpress project on a paid plan, added right away and usable until the plan renews. One-time payment. |
| RTCExpress Video Minutes Pack | 8 | 5,000 extra video participant minutes for one RTCExpress project on the Pro plan, added right away and usable until the plan renews. One-time payment. |

## How it works (Phase 2, built 25 Oct 2026)

- Code: `packages/signaling/src/dodo.ts` (API client, product lookup, signature check, event handling), `src/routes/dodo-billing.ts` (routes), migration `019_dodo_billing.sql`, tests `src/dodo.test.ts`.
- Env on the VM (`.env.production`, passed through `docker-compose.prod.yml`): `DODO_ENV` (`test`/`live`), `DODO_API_KEY`, `DODO_WEBHOOK_SECRET`. Checkout is enabled only when the key and secret are both set.
- Products are found by **name** via `GET /products`, so test and live product IDs never need copying. Keep the four names exactly as in the table above.
- Console: `POST /v1/portal/billing/checkout {plan, period}` creates one Dodo customer per project, then a checkout session (metadata `appId/plan/period`), and returns its URL. If the project already has an active subscription, it calls `change-plan` instead (prorated immediately, change blocked if payment fails). `POST /v1/portal/billing/manage` returns a Dodo customer-portal link (cancel, payment method, invoices).
- Webhook `POST /v1/billing/dodo/webhook`: verifies the signature over the raw body, processes each `webhook-id` once, ignores events older than the last one applied. `active`/`past_due` sets the plan from the product; `cancelled`/`expired`/`failed`/`on_hold`/`paused` moves the project to Free, but only if it is the project's current subscription. A cancellation at period end keeps status `active`, so access lasts until the period ends.
- Return URL after checkout: `PUBLIC_WEBSITE_URL/#/portal/billing?checkout=return` (the console polls for up to a minute while the webhook lands).

## Original integration notes

- API: test `https://test.dodopayments.com`, live `https://live.dodopayments.com`, header `Authorization: Bearer <key>`.
- Checkout: `POST /checkouts` with `product_cart: [{ product_id, quantity: 1 }]`, `customer: { email }`, `metadata: { appId, plan, period }`, `return_url`; redirect to `checkout_url`.
- Webhook (Standard Webhooks): headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<base64>`); HMAC-SHA256 over `{id}.{timestamp}.{raw body}` with the base64 key after stripping `whsec_`; reject timestamps older than 5 minutes; return 2xx; retries up to 8 times.
- Events: `subscription.active` / `renewed` / `plan_changed` / `updated` → set plan; `subscription.cancelled` / `expired` / `failed` / `on_hold` → back to Free.
- Cancel: `PATCH /subscriptions/{id}` with `cancel_at_next_billing_date: true`. Customer portal: `POST /customers/{customer_id}/customer-portal/session` → `link`.
- Planned webhook URL: `https://api.devsquarelabs.com/v1/billing/dodo/webhook`.
- Secrets (`DODO_API_KEY`, `DODO_WEBHOOK_SECRET`) go only in `.env.production` on the VM, never in chat or git.
