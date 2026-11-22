import type { FastifyInstance } from "fastify";
import { getPool } from "../db.js";
import { requireAdmin, adminIdentity, audit } from "./admin.js";
import { send } from "../notify-email.js";
import { rateLimit } from "../rate-limit.js";
import {
  DEFAULT_WELCOME, LIMITS, WELCOME_PLACEHOLDERS, getWelcomeTemplate, renderWelcome, resetWelcomeTemplate,
  saveWelcomeTemplate, sendWelcomeEmail, validateWelcome, type WelcomeTemplate,
} from "../welcome-email.js";

const emailReady = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
const SAMPLE = { name: "Priya Sharma", project: "My Chat App", email: "priya@example.com" };

function draftFrom(body: Record<string, unknown> | undefined): Partial<WelcomeTemplate> {
  const b = body || {};
  return { enabled: b.enabled as boolean, subject: b.subject as string, body: b.body as string, buttonText: b.buttonText as string, buttonLink: b.buttonLink as string, replyTo: b.replyTo as string };
}

// Admin panel → Emails page: edit, preview and test the welcome email; send it to one customer by hand.
export async function registerAdminEmailRoutes(app: FastifyInstance) {
  app.get("/v1/admin/emails/welcome", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const current = await getWelcomeTemplate();
    let stats = { sentTotal: 0, sent7d: 0, verified7d: 0 };
    const db = getPool();
    if (db) {
      try {
        const r = await db.query(`SELECT COUNT(welcome_email_sent_at)::int sent_total,
          COUNT(*) FILTER (WHERE welcome_email_sent_at > NOW() - interval '7 days')::int sent_7d,
          COUNT(*) FILTER (WHERE email_verified_at > NOW() - interval '7 days')::int verified_7d FROM customer_accounts`);
        stats = { sentTotal: r.rows[0].sent_total, sent7d: r.rows[0].sent_7d, verified7d: r.rows[0].verified_7d };
      } catch { /* column not there yet */ }
    }
    return { ...current, defaults: DEFAULT_WELCOME, placeholders: WELCOME_PLACEHOLDERS, limits: LIMITS, emailConfigured: emailReady(), stats };
  });

  app.put<{ Body: Record<string, unknown> }>("/v1/admin/emails/welcome", { bodyLimit: 16384 }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const draft = draftFrom(req.body);
    const problem = validateWelcome(draft);
    if (problem) return reply.code(400).send({ error: problem });
    const who = adminIdentity(req)!;
    const before = (await getWelcomeTemplate()).template;
    await saveWelcomeTemplate(draft as WelcomeTemplate, who.email);
    await audit(who.email, "email.welcome.update", "welcome", {
      enabled: draft.enabled, wasEnabled: before.enabled, subject: draft.subject,
      textChanged: before.body !== draft.body || before.subject !== draft.subject || before.buttonText !== draft.buttonText || before.buttonLink !== draft.buttonLink || before.replyTo !== draft.replyTo,
    });
    return getWelcomeTemplate();
  });

  app.delete("/v1/admin/emails/welcome", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await resetWelcomeTemplate();
    await audit(adminIdentity(req)!.email, "email.welcome.reset", "welcome");
    return getWelcomeTemplate();
  });

  // Preview of an unsaved draft, filled with sample customer details. Read-only, so viewers can use it too.
  app.post<{ Body: Record<string, unknown> }>("/v1/admin/emails/welcome/preview", { bodyLimit: 16384 }, async (req, reply) => {
    if (!requireAdmin(req, reply, "viewer")) return;
    const draft = { ...draftFrom(req.body), enabled: true };
    const problem = validateWelcome(draft);
    if (problem) return reply.code(400).send({ error: problem });
    const mail = renderWelcome(draft as WelcomeTemplate, SAMPLE);
    return { subject: mail.subject, html: mail.html, replyTo: mail.replyTo || null };
  });

  // Sends the draft (with sample details) to the signed-in admin's own inbox.
  app.post<{ Body: Record<string, unknown> }>("/v1/admin/emails/welcome/test", { bodyLimit: 16384 }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const who = adminIdentity(req)!;
    if (!who.email.includes("@")) return reply.code(400).send({ error: "Sign in with your admin email to send yourself a test." });
    if (!rateLimit(`welcome-test:${who.email}`, 10, 15 * 60 * 1000)) return reply.code(429).send({ error: "Too many test emails. Try again in 15 minutes." });
    const draft = { ...draftFrom(req.body), enabled: true };
    const problem = validateWelcome(draft);
    if (problem) return reply.code(400).send({ error: problem });
    const mail = renderWelcome(draft as WelcomeTemplate, { ...SAMPLE, email: who.email });
    const result = await send([who.email], `[Test] ${mail.subject}`, mail.text, mail.html, mail.replyTo);
    if (result === "not-configured") return reply.code(503).send({ error: "Email sending is not set up on the server (RESEND_API_KEY / EMAIL_FROM)." });
    if (result === "failed") return reply.code(502).send({ error: "The email provider didn't accept the email. Try again in a minute." });
    return { sentTo: who.email };
  });

  // "Send welcome email now" on a customer's page (for people who verified before this existed, or to resend).
  app.post<{ Params: { accountId: string } }>("/v1/admin/customers/:accountId/welcome-email", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(req.params.accountId)) return reply.code(400).send({ error: "Invalid customer" });
    const db = getPool(); if (!db) return reply.code(503).send({ error: "Database unavailable" });
    if (!rateLimit(`welcome-send:${req.params.accountId}`, 3, 15 * 60 * 1000)) return reply.code(429).send({ error: "Already sent a few times just now. Try again in 15 minutes." });
    const acc = await db.query(`SELECT id, email FROM customer_accounts WHERE id = $1`, [req.params.accountId]);
    if (!acc.rowCount) return reply.code(404).send({ error: "Customer not found" });
    const result = await sendWelcomeEmail(String(acc.rows[0].id), "manual");
    await audit(adminIdentity(req)!.email, "email.welcome.send", String(acc.rows[0].id), { email: acc.rows[0].email, result });
    if (result === "not-configured") return reply.code(503).send({ error: "Email sending is not set up on the server." });
    if (result !== "sent") return reply.code(502).send({ error: "The welcome email could not be sent. Try again in a minute." });
    return { sent: true };
  });
}
