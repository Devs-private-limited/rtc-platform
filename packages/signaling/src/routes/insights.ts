import type { FastifyInstance } from "fastify";
import { requireAdmin, adminIdentity, audit } from "./admin.js";
import { getAttention, sendWeeklySummary } from "../admin-insights.js";
import { ownerAlertRecipients } from "../notify-email.js";
import { getPool } from "../db.js";

const SUMMARY_COOLDOWN_MS = 10 * 60 * 1000;

export async function registerInsightRoutes(app: FastifyInstance) {
  app.get("/v1/admin/attention", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try { return await getAttention(); }
    catch (err) { return reply.code(503).send({ error: err instanceof Error ? err.message : "Could not load" }); }
  });
  app.get("/v1/admin/weekly-summary", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { recipients: ownerAlertRecipients(), schedule: "Every Monday after 9:00 am IST" };
  });
  // Owner can send the summary right now (to check it, or any time).
  app.post("/v1/admin/weekly-summary/send", async (req, reply) => {
    if (!requireAdmin(req, reply, "owner")) return;
    // One email per 10 minutes, so repeated clicks can't flood the inbox.
    const db = getPool();
    if (db) {
      const last = await db.query(
        "SELECT created_at FROM admin_audit WHERE action = 'summary.send' AND detail->>'result' = 'sent' AND created_at > NOW() - INTERVAL '10 minutes' ORDER BY created_at DESC LIMIT 1");
      if (last.rows[0]) {
        const wait = Math.max(1, Math.ceil((new Date(last.rows[0].created_at).getTime() + SUMMARY_COOLDOWN_MS - Date.now()) / 60000));
        return reply.code(429).send({ error: `The summary was sent a few minutes ago. You can send it again in ${wait} minute${wait === 1 ? "" : "s"}.` });
      }
    }
    const result = await sendWeeklySummary();
    await audit(adminIdentity(req)!.email, "summary.send", null, { result });
    return { result, recipients: ownerAlertRecipients() };
  });
}
