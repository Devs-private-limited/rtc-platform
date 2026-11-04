import type { FastifyInstance } from "fastify";
import { requireAdmin, adminIdentity, audit } from "./admin.js";
import { getAttention, sendWeeklySummary } from "../admin-insights.js";
import { ownerAlertRecipients } from "../notify-email.js";

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
    const result = await sendWeeklySummary();
    await audit(adminIdentity(req)!.email, "summary.send", null, { result });
    return { result, recipients: ownerAlertRecipients() };
  });
}
