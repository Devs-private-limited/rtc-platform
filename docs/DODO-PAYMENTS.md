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
| RTCExpress Starter (Monthly) | 9 | 1 Month | `pdt_0NqUeuNICKI797gGObwLU` (read from a screenshot; copy the exact ID from Dodo before using it) |
| RTCExpress Starter (Yearly) | 90 | 1 Year | |
| RTCExpress Pro (Monthly) | 29 | 1 Month | |
| RTCExpress Pro (Yearly) | 290 | 1 Year | |

Descriptions:

- **Starter (Monthly):** Chat plus 1:1 and group voice calling for one RTCExpress project: up to 1,000 chat MAU and 30,000 voice participant minutes per month, webhooks and email support. Billed monthly, cancel anytime.
- **Starter (Yearly):** Chat plus 1:1 and group voice calling for one RTCExpress project: up to 1,000 chat MAU and 30,000 voice participant minutes per month, webhooks and email support. Billed yearly (2 months free), cancel anytime.
- **Pro (Monthly):** Chat, voice and video calling with screen sharing for one RTCExpress project: up to 5,000 chat MAU, 50,000 voice and 10,000 video participant minutes per month, priority email support. Billed monthly, cancel anytime.
- **Pro (Yearly):** Chat, voice and video calling with screen sharing for one RTCExpress project: up to 5,000 chat MAU, 50,000 voice and 10,000 video participant minutes per month, priority email support. Billed yearly (2 months free), cancel anytime.

## Integration plan (Phase 2, not built yet)

- API: test `https://test.dodopayments.com`, live `https://live.dodopayments.com`, header `Authorization: Bearer <key>`.
- Checkout: `POST /checkouts` with `product_cart: [{ product_id, quantity: 1 }]`, `customer: { email }`, `metadata: { appId, plan, period }`, `return_url`; redirect to `checkout_url`.
- Webhook (Standard Webhooks): headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<base64>`); HMAC-SHA256 over `{id}.{timestamp}.{raw body}` with the base64 key after stripping `whsec_`; reject timestamps older than 5 minutes; return 2xx; retries up to 8 times.
- Events: `subscription.active` / `renewed` / `plan_changed` / `updated` → set plan; `subscription.cancelled` / `expired` / `failed` / `on_hold` → back to Free.
- Cancel: `PATCH /subscriptions/{id}` with `cancel_at_next_billing_date: true`. Customer portal: `POST /customers/{customer_id}/customer-portal/session` → `link`.
- Planned webhook URL: `https://api.devsquarelabs.com/v1/billing/dodo/webhook`.
- Secrets (`DODO_API_KEY`, `DODO_WEBHOOK_SECRET`) go only in `.env.production` on the VM, never in chat or git.
