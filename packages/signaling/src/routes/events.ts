import type { FastifyInstance } from "fastify";
import { getUsageSummary, listEvents } from "../events.js";
import { requireAdmin } from "./admin.js";

export async function registerEventRoutes(app: FastifyInstance) {
  app.get<{ Params: { appId: string }; Querystring: { limit?: string; type?: string } }>(
    "/v1/admin/apps/:appId/events",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      try {
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const events = await listEvents(req.params.appId, { limit, type: req.query.type });
        return { events };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to list events";
        return reply.status(503).send({ error: message });
      }
    }
  );

  app.get<{ Params: { appId: string } }>("/v1/admin/apps/:appId/usage", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      return await getUsageSummary(req.params.appId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to compute usage";
      return reply.status(503).send({ error: message });
    }
  });
}
