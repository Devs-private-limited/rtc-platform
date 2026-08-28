import type { FastifyInstance } from "fastify";
import { listRecordings } from "../recordings.js";
import { requireAdmin } from "./admin.js";

export async function registerRecordingRoutes(app: FastifyInstance) {
  app.get<{ Params: { appId: string }; Querystring: { limit?: string } }>(
    "/v1/admin/apps/:appId/recordings",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      try {
        const recordings = await listRecordings(
          req.params.appId,
          req.query.limit ? Number(req.query.limit) : undefined
        );
        return { recordings };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to list recordings";
        return reply.status(503).send({ error: message });
      }
    }
  );
}
