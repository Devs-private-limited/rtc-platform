import type { FastifyInstance } from "fastify";
import { getUsageSummary, listEvents } from "../events.js";
import { getMeteringSummary, listCallSessions } from "../metering.js";
import { requireAdmin } from "./admin.js";

export async function registerEventRoutes(app: FastifyInstance) {
  app.get<{
    Params: { appId: string };
    Querystring: { limit?: string; type?: string; from?: string; to?: string };
  }>("/v1/admin/apps/:appId/events", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const events = await listEvents(req.params.appId, {
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        type: req.query.type,
        from: req.query.from,
        to: req.query.to,
      });
      return { events };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list events";
      return reply.status(503).send({ error: message });
    }
  });

  app.get<{ Params: { appId: string } }>("/v1/admin/apps/:appId/usage", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      return await getUsageSummary(req.params.appId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to compute usage";
      return reply.status(503).send({ error: message });
    }
  });

  app.get<{
    Params: { appId: string };
    Querystring: { from?: string; to?: string };
  }>("/v1/admin/apps/:appId/metering", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      return await getMeteringSummary(req.params.appId, {
        from: req.query.from,
        to: req.query.to,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to compute metering";
      return reply.status(503).send({ error: message });
    }
  });

  app.get<{ Params: { appId: string }; Querystring: { limit?: string } }>(
    "/v1/admin/apps/:appId/call-sessions",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      try {
        const sessions = await listCallSessions(
          req.params.appId,
          req.query.limit ? Number(req.query.limit) : undefined
        );
        return { sessions };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to list call sessions";
        return reply.status(503).send({ error: message });
      }
    }
  );
}
