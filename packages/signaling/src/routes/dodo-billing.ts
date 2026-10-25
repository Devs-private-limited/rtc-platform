import type { FastifyInstance } from "fastify";
import { BILLING_PLANS } from "../billing-plans.js";
import { getCustomerByAppId } from "../customers.js";
import {
  DodoError,
  changeDodoPlan,
  createDodoCheckout,
  createDodoPortalLink,
  dodoConfig,
  ensureDodoCustomer,
  getAppBilling,
  handleDodoWebhook,
  hasLiveSubscription,
  isBillingPeriod,
  isDodoEnabled,
  isPaidPlan,
  verifyDodoSignature,
} from "../dodo.js";
import { requirePortalUser } from "../portal-auth.js";
import { rateLimit } from "../rate-limit.js";

function billingReturnUrl() {
  const site = (process.env.PUBLIC_WEBSITE_URL || "https://rtc.devsquarelabs.com").replace(/\/$/, "");
  return `${site}/#/portal/billing?checkout=return`;
}

function dodoFailure(err: unknown) {
  console.error(err);
  // Dodo's own error text can include internal IDs; customers get a generic message.
  const status = err instanceof DodoError && err.status === 409 ? 409 : 502;
  const error = status === 409
    ? "A plan change is already in progress. Wait a minute and refresh."
    : "The payment provider could not be reached. Please try again in a few minutes.";
  return { status, error };
}

export async function registerDodoBillingRoutes(app: FastifyInstance, secret: string) {
  app.post<{ Body: { plan?: unknown; period?: unknown } }>("/v1/portal/billing/checkout", async (req, reply) => {
    const claims = await requirePortalUser(req, reply, secret); if (!claims) return;
    if (!isDodoEnabled()) return reply.code(503).send({ error: "Online checkout is not available yet. Contact support to change plans." });
    if (!rateLimit(`billing-checkout:${claims.appId}`, 10, 60_000)) return reply.code(429).send({ error: "Too many requests. Try again shortly." });
    const { plan, period } = req.body || {};
    if (!isPaidPlan(plan) || !isBillingPeriod(period)) return reply.code(400).send({ error: "Choose the Starter or Pro plan, billed monthly or yearly" });

    const [billing, customer] = await Promise.all([getAppBilling(claims.appId), getCustomerByAppId(claims.appId)]);
    if (!billing) return reply.code(404).send({ error: "Project not found" });

    try {
      if (hasLiveSubscription(billing)) {
        if (billing.plan === plan && billing.billingPeriod === period) {
          return reply.code(409).send({ error: `You are already on ${BILLING_PLANS[plan].name} (${period}).` });
        }
        await changeDodoPlan(billing.subscriptionId!, plan, period);
        return { changed: true, message: `Switching to ${BILLING_PLANS[plan].name} (${period}). Any price difference is charged or credited pro rata; the plan updates here within a minute.` };
      }
      if (!customer?.email) return reply.code(400).send({ error: "Sign in with your account email to subscribe." });
      const customerId = await ensureDodoCustomer(claims.appId, customer.email, customer.name || customer.company);
      const url = await createDodoCheckout({ appId: claims.appId, customerId, plan, period, returnUrl: billingReturnUrl() });
      return { url };
    } catch (err) {
      const failure = dodoFailure(err);
      return reply.code(failure.status).send({ error: failure.error });
    }
  });

  app.post("/v1/portal/billing/manage", async (req, reply) => {
    const claims = await requirePortalUser(req, reply, secret); if (!claims) return;
    if (!isDodoEnabled()) return reply.code(503).send({ error: "Online billing is not available yet." });
    if (!rateLimit(`billing-manage:${claims.appId}`, 10, 60_000)) return reply.code(429).send({ error: "Too many requests. Try again shortly." });
    const billing = await getAppBilling(claims.appId);
    if (!billing?.customerId) return reply.code(404).send({ error: "There is no billing account for this project yet. Subscribe to a plan first." });
    try {
      return { url: await createDodoPortalLink(billing.customerId, billingReturnUrl()) };
    } catch (err) {
      const failure = dodoFailure(err);
      return reply.code(failure.status).send({ error: failure.error });
    }
  });

  // The signature covers the exact bytes Dodo sent, so this scope keeps the raw body.
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "string", bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));

    scope.post("/v1/billing/dodo/webhook", async (req, reply) => {
      const { webhookSecret } = dodoConfig();
      if (!webhookSecret) return reply.code(503).send({ error: "Webhook not configured" });
      const raw = typeof req.body === "string" ? req.body : "";
      const header = (name: string) => {
        const value = req.headers[name];
        return Array.isArray(value) ? value[0] : value;
      };
      const headers = { id: header("webhook-id"), timestamp: header("webhook-timestamp"), signature: header("webhook-signature") };
      if (!verifyDodoSignature(webhookSecret, headers, raw)) return reply.code(401).send({ error: "Invalid signature" });

      let event: { type?: string; data?: Record<string, unknown> };
      try { event = JSON.parse(raw); } catch { return reply.code(400).send({ error: "Invalid JSON" }); }

      try {
        const outcome = await handleDodoWebhook(headers.id!, Number(headers.timestamp), event);
        req.log.info({ webhookId: headers.id, type: event.type, outcome }, "dodo webhook");
        return { ok: true, outcome };
      } catch (err) {
        req.log.error({ err, webhookId: headers.id, type: event.type }, "dodo webhook failed");
        return reply.code(500).send({ error: "Processing failed" });
      }
    });
  });
}
