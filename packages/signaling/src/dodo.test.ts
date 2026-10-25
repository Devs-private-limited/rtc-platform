import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { PGlite } from "@electric-sql/pglite";
import { getPool, closeDb } from "./db.js";
import { issueToken } from "./auth.js";
import { parseProductName, resetDodoProductCache, verifyDodoSignature } from "./dodo.js";
import { registerDodoBillingRoutes } from "./routes/dodo-billing.js";

const SECRET = "whsec_" + Buffer.from("dodo-test-signing-key-0123456789").toString("base64");

function sign(id: string, timestamp: number, body: string, secret = SECRET) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

test("dodo product names map to plans and periods", () => {
  assert.deepEqual(parseProductName("RTCExpress Starter (Monthly)"), { plan: "starter", period: "monthly" });
  assert.deepEqual(parseProductName("RTCExpress Pro (Yearly)"), { plan: "pro", period: "yearly" });
  assert.equal(parseProductName("RTCExpress Enterprise (Monthly)"), null);
  assert.equal(parseProductName(undefined), null);
});

test("dodo webhook signatures follow Standard Webhooks and reject stale or forged deliveries", () => {
  const now = 1_800_000_000;
  const body = '{"type":"subscription.active"}';
  const headers = { id: "msg_1", timestamp: String(now), signature: sign("msg_1", now, body) };
  assert.equal(verifyDodoSignature(SECRET, headers, body, now * 1000), true);
  assert.equal(verifyDodoSignature(SECRET, { ...headers, signature: `v1,bogus ${headers.signature}` }, body, now * 1000), true);
  assert.equal(verifyDodoSignature(SECRET, headers, body + " ", now * 1000), false);
  assert.equal(verifyDodoSignature(SECRET, headers, body, (now + 301) * 1000), false);
  assert.equal(verifyDodoSignature(SECRET, { ...headers, signature: sign("msg_1", now, body, "whsec_" + Buffer.from("other").toString("base64")) }, body, now * 1000), false);
  assert.equal(verifyDodoSignature(SECRET, { ...headers, id: undefined }, body, now * 1000), false);
});

test("dodo checkout and webhooks drive the project plan", async (t) => {
  const previous = { db: process.env.DATABASE_URL, key: process.env.DODO_API_KEY, secret: process.env.DODO_WEBHOOK_SECRET };
  process.env.DATABASE_URL = "postgresql://unused/dodo-tests";
  process.env.DODO_API_KEY = "test-key";
  process.env.DODO_WEBHOOK_SECRET = SECRET;
  resetDodoProductCache();
  const pg = new PGlite();
  const app = Fastify();
  t.after(async () => {
    await app.close(); await closeDb(); await pg.close();
    for (const [name, value] of [["DATABASE_URL", previous.db], ["DODO_API_KEY", previous.key], ["DODO_WEBHOOK_SECRET", previous.secret]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  await pg.exec(`CREATE TABLE apps(app_id VARCHAR(64) PRIMARY KEY, name TEXT, plan VARCHAR(32) NOT NULL DEFAULT 'free', active BOOLEAN DEFAULT TRUE, portal_version INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW());
    INSERT INTO apps(app_id, name) VALUES ('app-a', 'First'), ('app-b', 'Second');`);
  await pg.exec(await readFile(new URL("../migrations/012_customer_accounts.sql", import.meta.url), "utf8"));
  const migration = await readFile(new URL("../migrations/019_dodo_billing.sql", import.meta.url), "utf8");
  await pg.exec(migration); await pg.exec(migration);
  await pg.query(`INSERT INTO customer_accounts(email, password_hash, name, app_id) VALUES ('a@example.test', 'x', 'Ann', 'app-a')`);
  t.mock.method(getPool()!, "query", async (sql: string, args?: unknown[]) => {
    const result = await pg.query(sql, args);
    return { ...result, rowCount: result.rows.length || result.affectedRows };
  });

  const calls: Array<{ method: string; path: string; body: any }> = [];
  let linksEnabled = true;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method: init.method!, path, body });
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer test-key");
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (path === "/products") return json({ items: [
      { product_id: "pdt_sm", name: "RTCExpress Starter (Monthly)" }, { product_id: "pdt_sy", name: "RTCExpress Starter (Yearly)" },
      { product_id: "pdt_pm", name: "RTCExpress Pro (Monthly)" }, { product_id: "pdt_py", name: "RTCExpress Pro (Yearly)" },
      { product_id: "pdt_other", name: "Something else" },
    ] });
    if (path === "/customers") return json({ customer_id: "cus_a" });
    if (path === "/checkouts") return json({ session_id: "cks_1", checkout_url: "https://test.checkout.dodopayments.com/cks_1" });
    if (path.endsWith("/change-plan")) {
      if (body.collect_via_payment_link && !linksEnabled) return new Response('{"code":"FEATURE_NOT_ENABLED"}', { status: 422 });
      return json(body.collect_via_payment_link ? { payment_id: "pay_2", payment_link: "https://test.checkout.dodopayments.com/link_2" } : { payment_id: "pay_2", payment_link: null });
    }
    if (path.endsWith("/customer-portal/session")) return json({ link: "https://portal.dodo.test/x" });
    return new Response("not found", { status: 404 });
  });

  await app.register(async (scope) => registerDodoBillingRoutes(scope, "test"));
  const portal = (appId = "app-a") => ({ authorization: `Bearer ${issueToken({ appId, userId: "__portal__" }, "test")}` });
  const plan = async (appId = "app-a") => (await pg.query<{ plan: string; billing_period: string | null; subscription_status: string | null }>(
    "SELECT plan, billing_period, subscription_status FROM apps WHERE app_id = $1", [appId])).rows[0];
  let clock = Math.floor(Date.now() / 1000);
  let seq = 0;
  const deliver = async (type: string, data: Record<string, unknown>, opts: { id?: string; timestamp?: number; signature?: string } = {}) => {
    const id = opts.id ?? `msg_${++seq}`;
    const timestamp = opts.timestamp ?? ++clock;
    const body = JSON.stringify({ business_id: "bus_1", type, timestamp: new Date(timestamp * 1000).toISOString(), data });
    return app.inject({
      url: "/v1/billing/dodo/webhook", method: "POST", payload: body,
      headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": opts.signature ?? sign(id, timestamp, body) },
    });
  };
  const sub = (status: string, extra: Record<string, unknown> = {}) => ({
    subscription_id: "sub_1", status, product_id: "pdt_sm", customer: { customer_id: "cus_a", email: "a@example.test" },
    metadata: { appId: "app-a" }, next_billing_date: "2026-11-25T00:00:00Z", cancel_at_next_billing_date: false, ...extra,
  });

  await t.test("checkout validates input and creates one customer per project", async () => {
    assert.equal((await app.inject({ url: "/v1/portal/billing/checkout", method: "POST", payload: { plan: "pro", period: "monthly" } })).statusCode, 401);
    assert.equal((await app.inject({ url: "/v1/portal/billing/checkout", method: "POST", headers: portal(), payload: { plan: "free", period: "monthly" } })).statusCode, 400);
    assert.equal((await app.inject({ url: "/v1/portal/billing/checkout", method: "POST", headers: portal(), payload: { plan: "pro", period: "weekly" } })).statusCode, 400);
    assert.equal((await app.inject({ url: "/v1/portal/billing/checkout", method: "POST", headers: portal("app-b"), payload: { plan: "pro", period: "monthly" } })).statusCode, 400);
    const res = await app.inject({ url: "/v1/portal/billing/checkout", method: "POST", headers: portal(), payload: { plan: "starter", period: "monthly", appId: "app-b" } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().url, "https://test.checkout.dodopayments.com/cks_1");
    const checkout = calls.find((c) => c.path === "/checkouts")!;
    assert.deepEqual(checkout.body.product_cart, [{ product_id: "pdt_sm", quantity: 1 }]);
    assert.deepEqual(checkout.body.customer, { customer_id: "cus_a" });
    assert.deepEqual(checkout.body.metadata, { appId: "app-a", plan: "starter", period: "monthly" });
    await app.inject({ url: "/v1/portal/billing/checkout", method: "POST", headers: portal(), payload: { plan: "pro", period: "yearly" } });
    assert.equal(calls.filter((c) => c.path === "/customers").length, 1);
    assert.equal((await plan()).plan, "free", "checkout alone must not change the plan");
  });

  await t.test("forged webhooks are rejected and do nothing", async () => {
    const res = await deliver("subscription.active", sub("active"), { signature: "v1,AAAA" });
    assert.equal(res.statusCode, 401);
    assert.equal((await plan()).plan, "free");
  });

  await t.test("active subscription upgrades the plan, retries are processed once", async () => {
    const res = await deliver("subscription.active", sub("active"), { id: "msg_fixed" });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().outcome, "applied");
    assert.deepEqual(await plan(), { plan: "starter", billing_period: "monthly", subscription_status: "active" });
    assert.equal((await deliver("subscription.active", sub("active"), { id: "msg_fixed" })).json().outcome, "duplicate");
    assert.equal((await plan("app-b")).plan, "free");
  });

  await t.test("a paid project changes plan in place instead of opening a second checkout", async () => {
    const before = calls.filter((c) => c.path === "/checkouts").length;
    assert.equal((await app.inject({ url: "/v1/portal/billing/checkout", method: "POST", headers: portal(), payload: { plan: "starter", period: "monthly" } })).statusCode, 409);
    const res = await app.inject({ url: "/v1/portal/billing/checkout", method: "POST", headers: portal(), payload: { plan: "pro", period: "monthly" } });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().url, "https://test.checkout.dodopayments.com/link_2", "upgrades send the customer to pay the difference");
    const change = calls.find((c) => c.path === "/subscriptions/sub_1/change-plan")!;
    assert.equal(change.body.product_id, "pdt_pm");
    assert.equal(change.body.proration_billing_mode, "prorated_immediately_keep_cycle");
    assert.equal(change.body.on_payment_failure, "prevent_change");
    assert.equal(change.body.collect_via_payment_link, true);
    assert.match(change.body.return_url, /#\/portal\/billing\?checkout=return$/);
    linksEnabled = false;
    const fallback = await app.inject({ url: "/v1/portal/billing/checkout", method: "POST", headers: portal(), payload: { plan: "pro", period: "yearly" } });
    assert.equal(fallback.statusCode, 200, fallback.body);
    assert.equal(fallback.json().changed, true, "without payment links the saved method is charged");
    const retried = calls.filter((c) => c.path === "/subscriptions/sub_1/change-plan").slice(-2);
    assert.equal(retried[0].body.collect_via_payment_link, true);
    assert.equal(retried[1].body.collect_via_payment_link, undefined);
    assert.equal(retried[1].body.proration_billing_mode, "prorated_immediately", "switching period starts a new cycle");
    linksEnabled = true;
    assert.equal(calls.filter((c) => c.path === "/checkouts").length, before);
    assert.equal((await deliver("subscription.plan_changed", sub("active", { product_id: "pdt_pm" }))).json().outcome, "applied");
    assert.equal((await plan()).plan, "pro");
  });

  await t.test("cancelling at period end keeps access until the subscription ends", async () => {
    await deliver("subscription.cancelled", sub("active", { product_id: "pdt_pm", cancel_at_next_billing_date: true }));
    assert.equal((await plan()).plan, "pro");
    const late = clock - 100;
    assert.equal((await deliver("subscription.expired", sub("expired", { product_id: "pdt_pm" }), { timestamp: late })).json().outcome, "ignored", "older events cannot override newer ones");
    assert.equal((await plan()).plan, "pro");
    assert.equal((await deliver("subscription.expired", sub("expired", { product_id: "pdt_pm" }))).json().outcome, "applied");
    assert.deepEqual(await plan(), { plan: "free", billing_period: null, subscription_status: "expired" });
  });

  await t.test("an old subscription ending cannot downgrade a newer one", async () => {
    await deliver("subscription.active", sub("active", { subscription_id: "sub_2", product_id: "pdt_py" }));
    assert.equal((await plan()).plan, "pro");
    assert.equal((await deliver("subscription.failed", sub("failed"))).json().outcome, "ignored");
    assert.equal((await plan()).plan, "pro");
  });

  await t.test("payment events and unknown products are acknowledged without changes", async () => {
    assert.equal((await deliver("payment.succeeded", { payment_id: "pay_1" })).json().outcome, "ignored");
    assert.equal((await deliver("subscription.active", sub("active", { subscription_id: "sub_x", product_id: "pdt_other" }))).json().outcome, "ignored");
    assert.equal((await plan()).plan, "pro");
  });

  await t.test("manage billing opens the portal only for projects with a billing account", async () => {
    const res = await app.inject({ url: "/v1/portal/billing/manage", method: "POST", headers: portal() });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().url, "https://portal.dodo.test/x");
    assert.equal((await app.inject({ url: "/v1/portal/billing/manage", method: "POST", headers: portal("app-b") })).statusCode, 404);
  });
});
