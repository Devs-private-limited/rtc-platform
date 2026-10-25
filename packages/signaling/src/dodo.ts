import { createHmac, timingSafeEqual } from "crypto";
import type { BillingPlan } from "./billing-plans.js";
import { getPool } from "./db.js";

export type PaidPlan = Exclude<BillingPlan, "free">;
export type BillingPeriod = "monthly" | "yearly";

const REQUEST_TIMEOUT_MS = 15_000;
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;
const PRODUCT_CACHE_MS = 10 * 60_000;

/** Statuses that keep the paid plan. `past_due` is Dodo's retry grace period. */
const PAID_STATUSES = new Set(["active", "past_due"]);
const ENDED_STATUSES = new Set(["cancelled", "expired", "failed", "on_hold", "paused"]);

export function dodoConfig() {
  const live = process.env.DODO_ENV === "live";
  return {
    apiKey: process.env.DODO_API_KEY || null,
    webhookSecret: process.env.DODO_WEBHOOK_SECRET || null,
    baseUrl: live ? "https://live.dodopayments.com" : "https://test.dodopayments.com",
    mode: live ? ("live" as const) : ("test" as const),
  };
}

export function isDodoEnabled() {
  const config = dodoConfig();
  return Boolean(config.apiKey && config.webhookSecret);
}

export function isPaidPlan(value: unknown): value is PaidPlan {
  return value === "starter" || value === "pro";
}

export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return value === "monthly" || value === "yearly";
}

export class DodoError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function dodoRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { apiKey, baseUrl } = dodoConfig();
  if (!apiKey) throw new DodoError(503, "Dodo Payments is not configured");
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new DodoError(res.status, `Dodo ${method} ${path.split("?")[0]} failed (${res.status}): ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

// Products are matched by name ("RTCExpress Starter (Monthly)"), so the same
// code works in test and live mode without copying product IDs around.
const PRODUCT_NAME = /^RTCExpress (Starter|Pro) \((Monthly|Yearly)\)$/i;
let productCache: { at: number; ids: Map<string, string>; plans: Map<string, { plan: PaidPlan; period: BillingPeriod }> } | null = null;

export function parseProductName(name: unknown): { plan: PaidPlan; period: BillingPeriod } | null {
  const match = typeof name === "string" ? PRODUCT_NAME.exec(name.trim()) : null;
  if (!match) return null;
  return { plan: match[1].toLowerCase() as PaidPlan, period: match[2].toLowerCase() as BillingPeriod };
}

async function loadProducts(force = false) {
  if (!force && productCache && Date.now() - productCache.at < PRODUCT_CACHE_MS) return productCache;
  const result = await dodoRequest<{ items?: Array<{ product_id: string; name?: string }> }>("GET", "/products?page_size=100");
  const ids = new Map<string, string>();
  const plans = new Map<string, { plan: PaidPlan; period: BillingPeriod }>();
  for (const item of result.items ?? []) {
    const parsed = parseProductName(item.name);
    if (!parsed) continue;
    ids.set(`${parsed.plan}:${parsed.period}`, item.product_id);
    plans.set(item.product_id, parsed);
  }
  productCache = { at: Date.now(), ids, plans };
  return productCache;
}

export function resetDodoProductCache() {
  productCache = null;
}

async function productIdFor(plan: PaidPlan, period: BillingPeriod) {
  const id = (await loadProducts()).ids.get(`${plan}:${period}`) ?? (await loadProducts(true)).ids.get(`${plan}:${period}`);
  if (!id) throw new DodoError(503, `No Dodo product named "RTCExpress ${plan === "pro" ? "Pro" : "Starter"} (${period === "yearly" ? "Yearly" : "Monthly"})"`);
  return id;
}

async function planForProduct(productId: string) {
  return (await loadProducts()).plans.get(productId) ?? (await loadProducts(true)).plans.get(productId) ?? null;
}

export interface AppBillingRow {
  plan: BillingPlan;
  billingPeriod: BillingPeriod | null;
  customerId: string | null;
  subscriptionId: string | null;
  status: string | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

export async function getAppBilling(appId: string): Promise<AppBillingRow | null> {
  const db = getPool();
  if (!db) return null;
  const result = await db.query(
    `SELECT plan, billing_period, dodo_customer_id, dodo_subscription_id, subscription_status, subscription_renews_at, subscription_cancel_at_period_end
     FROM apps WHERE app_id = $1`,
    [appId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    plan: (row.plan || "free") as BillingPlan,
    billingPeriod: row.billing_period ?? null,
    customerId: row.dodo_customer_id ?? null,
    subscriptionId: row.dodo_subscription_id ?? null,
    status: row.subscription_status ?? null,
    renewsAt: row.subscription_renews_at ? new Date(row.subscription_renews_at).toISOString() : null,
    cancelAtPeriodEnd: Boolean(row.subscription_cancel_at_period_end),
  };
}

export function hasLiveSubscription(billing: AppBillingRow | null) {
  return Boolean(billing?.subscriptionId && billing.status && PAID_STATUSES.has(billing.status));
}

/** One Dodo customer per project, created on first checkout. */
export async function ensureDodoCustomer(appId: string, email: string, name: string | null) {
  const db = getPool();
  if (!db) throw new Error("Database not configured");
  const existing = await getAppBilling(appId);
  if (existing?.customerId) return existing.customerId;
  const created = await dodoRequest<{ customer_id: string }>("POST", "/customers", { email, name: name || email });
  await db.query(`UPDATE apps SET dodo_customer_id = $1 WHERE app_id = $2 AND dodo_customer_id IS NULL`, [created.customer_id, appId]);
  return (await getAppBilling(appId))?.customerId ?? created.customer_id;
}

export async function createDodoCheckout(input: { appId: string; customerId: string; plan: PaidPlan; period: BillingPeriod; returnUrl: string }) {
  const productId = await productIdFor(input.plan, input.period);
  const session = await dodoRequest<{ session_id: string; checkout_url?: string | null }>("POST", "/checkouts", {
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: { customer_id: input.customerId },
    return_url: input.returnUrl,
    metadata: { appId: input.appId, plan: input.plan, period: input.period },
  });
  if (!session.checkout_url) throw new DodoError(502, "Dodo did not return a checkout URL");
  return session.checkout_url;
}

/** Upgrade or downgrade an existing subscription; the webhook then switches the plan. */
export async function changeDodoPlan(subscriptionId: string, plan: PaidPlan, period: BillingPeriod) {
  const productId = await productIdFor(plan, period);
  await dodoRequest("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`, {
    product_id: productId,
    quantity: 1,
    proration_billing_mode: "prorated_immediately",
    on_payment_failure: "prevent_change",
  });
}

export async function createDodoPortalLink(customerId: string, returnUrl: string) {
  const session = await dodoRequest<{ link: string }>(
    "POST",
    `/customers/${encodeURIComponent(customerId)}/customer-portal/session?return_url=${encodeURIComponent(returnUrl)}`
  );
  return session.link;
}

/** Standard Webhooks signature check (webhook-id / webhook-timestamp / webhook-signature). */
export function verifyDodoSignature(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  rawBody: string,
  nowMs = Date.now()
) {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

interface DodoSubscriptionData {
  subscription_id?: string;
  status?: string;
  product_id?: string;
  customer?: { customer_id?: string };
  metadata?: Record<string, unknown>;
  next_billing_date?: string | null;
  cancel_at_next_billing_date?: boolean;
}

async function resolveAppId(data: DodoSubscriptionData) {
  const db = getPool()!;
  const byColumn = async (column: string, value: string | undefined) => {
    if (!value) return null;
    const result = await db.query(`SELECT app_id FROM apps WHERE ${column} = $1 LIMIT 1`, [value]);
    return (result.rows[0]?.app_id as string) ?? null;
  };
  const metadataAppId = typeof data.metadata?.appId === "string" ? data.metadata.appId : undefined;
  return (
    (await byColumn("dodo_subscription_id", data.subscription_id)) ??
    (await byColumn("dodo_customer_id", data.customer?.customer_id)) ??
    (await byColumn("app_id", metadataAppId))
  );
}

export type WebhookOutcome = "applied" | "duplicate" | "ignored";

export async function handleDodoWebhook(
  webhookId: string,
  timestampSeconds: number,
  event: { type?: string; data?: DodoSubscriptionData }
): Promise<WebhookOutcome> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");
  const type = String(event.type || "unknown");
  const claimed = await db.query(
    `INSERT INTO dodo_webhook_events (webhook_id, event_type) VALUES ($1, $2) ON CONFLICT (webhook_id) DO NOTHING`,
    [webhookId, type.slice(0, 64)]
  );
  if (!claimed.rowCount) return "duplicate";
  if (!type.startsWith("subscription.") || !event.data) return "ignored";
  try {
    return await applySubscriptionEvent(event.data, new Date(timestampSeconds * 1000));
  } catch (err) {
    // Release the claim so Dodo's retry processes the event again.
    await db.query(`DELETE FROM dodo_webhook_events WHERE webhook_id = $1`, [webhookId]);
    throw err;
  }
}

async function applySubscriptionEvent(data: DodoSubscriptionData, eventAt: Date): Promise<WebhookOutcome> {
  const db = getPool()!;
  const status = data.status ?? "";
  if (!data.subscription_id || !(PAID_STATUSES.has(status) || ENDED_STATUSES.has(status))) return "ignored";
  const appId = await resolveAppId(data);
  if (!appId) {
    console.warn(`Dodo subscription ${data.subscription_id} does not match any project; ignored`);
    return "ignored";
  }

  if (PAID_STATUSES.has(status)) {
    const product = data.product_id ? await planForProduct(data.product_id) : null;
    if (!product) {
      console.warn(`Dodo product ${data.product_id} is not an RTCExpress plan; subscription ${data.subscription_id} ignored`);
      return "ignored";
    }
    const result = await db.query(
      `UPDATE apps SET plan = $2, billing_period = $3, dodo_subscription_id = $4,
         dodo_customer_id = COALESCE(dodo_customer_id, $5), subscription_status = $6,
         subscription_renews_at = $7, subscription_cancel_at_period_end = $8, billing_event_at = $9
       WHERE app_id = $1 AND (billing_event_at IS NULL OR billing_event_at <= $9)`,
      [appId, product.plan, product.period, data.subscription_id, data.customer?.customer_id ?? null, status,
        data.next_billing_date ?? null, Boolean(data.cancel_at_next_billing_date), eventAt.toISOString()]
    );
    return result.rowCount ? "applied" : "ignored";
  }

  // Only the subscription the project is currently on can send it back to Free;
  // an old subscription ending after a new one started must not downgrade it.
  const result = await db.query(
    `UPDATE apps SET plan = 'free', billing_period = NULL, subscription_status = $3,
       subscription_renews_at = NULL, subscription_cancel_at_period_end = FALSE, billing_event_at = $4
     WHERE app_id = $1 AND dodo_subscription_id = $2 AND (billing_event_at IS NULL OR billing_event_at <= $4)`,
    [appId, data.subscription_id, status, eventAt.toISOString()]
  );
  return result.rowCount ? "applied" : "ignored";
}
