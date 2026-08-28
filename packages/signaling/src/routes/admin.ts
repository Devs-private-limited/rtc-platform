import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createApp, listApps } from "../apps.js";

export function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers["x-admin-key"];
  const expected = process.env.ADMIN_API_KEY || "dev-admin-key";
  if (key !== expected) {
    reply.status(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.post<{ Body: { name?: string } }>("/v1/admin/apps", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const name = req.body?.name?.trim();
    if (!name) return reply.status(400).send({ error: "name is required" });

    try {
      const created = await createApp(name);
      return reply.status(201).send({
        ...created,
        note: "Store appSecret securely. It is shown only once.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create app";
      return reply.status(503).send({ error: message });
    }
  });

  app.get("/v1/admin/apps", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const apps = await listApps();
      return { apps };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list apps";
      return reply.status(503).send({ error: message });
    }
  });
}
