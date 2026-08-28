import type { FastifyInstance } from "fastify";
import { getQualitySummary, listQualityReports } from "../quality.js";
import { requireAdmin } from "./admin.js";

export async function registerQualityRoutes(app: FastifyInstance) {
  app.get<{
    Params: { appId: string };
    Querystring: { limit?: string; callId?: string };
  }>("/v1/admin/apps/:appId/quality", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const reports = await listQualityReports(req.params.appId, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        callId: req.query.callId,
      });
      return { reports };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list quality reports";
      return reply.status(503).send({ error: message });
    }
  });

  app.get<{ Params: { appId: string } }>(
    "/v1/admin/apps/:appId/quality/summary",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      try {
        return await getQualitySummary(req.params.appId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to compute quality summary";
        return reply.status(503).send({ error: message });
      }
    }
  );
}
