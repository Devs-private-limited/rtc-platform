import type { FastifyInstance } from "fastify";
import { getCallSession, getCallStats, listCallSessions } from "../calls.js";
import { requireAdmin } from "./admin.js";

export async function registerCallRoutes(app: FastifyInstance) {
  app.get<{
    Params: { appId: string };
    Querystring: { limit?: string; status?: string; userId?: string };
  }>("/v1/admin/apps/:appId/calls", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const calls = await listCallSessions(req.params.appId, {
        limit,
        status: req.query.status,
        userId: req.query.userId,
      });
      return { calls };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list calls";
      return reply.status(503).send({ error: message });
    }
  });

  app.get<{ Params: { appId: string } }>("/v1/admin/apps/:appId/calls/stats", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      return await getCallStats(req.params.appId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to compute call stats";
      return reply.status(503).send({ error: message });
    }
  });

  app.get<{ Params: { appId: string; callId: string } }>(
    "/v1/admin/apps/:appId/calls/:callId",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      try {
        const call = await getCallSession(req.params.appId, req.params.callId);
        if (!call) return reply.status(404).send({ error: "Call not found" });
        return call;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to fetch call";
        return reply.status(503).send({ error: message });
      }
    }
  );
}
