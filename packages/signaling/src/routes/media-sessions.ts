import type { FastifyInstance } from "fastify";
import { getMediaStats, listMediaSessions } from "../media-sessions.js";
import { requireAdmin } from "./admin.js";

export async function registerMediaSessionRoutes(app: FastifyInstance) {
  app.get<{
    Params: { appId: string };
    Querystring: { limit?: string; roomId?: string; userId?: string; kind?: string; active?: string };
  }>("/v1/admin/apps/:appId/media-sessions", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const sessions = await listMediaSessions(req.params.appId, {
        limit,
        roomId: req.query.roomId,
        userId: req.query.userId,
        kind: req.query.kind,
        active: req.query.active === "true",
      });
      return { sessions };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list media sessions";
      return reply.status(503).send({ error: message });
    }
  });

  app.get<{ Params: { appId: string } }>(
    "/v1/admin/apps/:appId/media-sessions/stats",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      try {
        return await getMediaStats(req.params.appId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to compute media stats";
        return reply.status(503).send({ error: message });
      }
    }
  );
}
