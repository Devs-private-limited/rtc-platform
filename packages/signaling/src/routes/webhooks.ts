import type { FastifyInstance } from "fastify";
import { createWebhook, deleteWebhook, listWebhooks } from "../webhooks.js";
import { requireAdmin } from "./admin.js";

export async function registerWebhookRoutes(app: FastifyInstance) {
  app.post<{ Params: { appId: string }; Body: { url?: string; events?: string[] } }>(
    "/v1/admin/apps/:appId/webhooks",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;

      const url = req.body?.url?.trim();
      const events = req.body?.events;

      if (!url || !/^https?:\/\//.test(url)) {
        return reply.status(400).send({ error: "A valid http(s) url is required" });
      }
      if (!Array.isArray(events) || events.length === 0) {
        return reply.status(400).send({ error: "events (non-empty array) is required" });
      }

      try {
        const webhook = await createWebhook(req.params.appId, url, events);
        return reply.status(201).send(webhook);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create webhook";
        return reply.status(503).send({ error: message });
      }
    }
  );

  app.get<{ Params: { appId: string } }>("/v1/admin/apps/:appId/webhooks", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const webhooks = await listWebhooks(req.params.appId);
      return { webhooks };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list webhooks";
      return reply.status(503).send({ error: message });
    }
  });

  app.delete<{ Params: { appId: string; webhookId: string } }>(
    "/v1/admin/apps/:appId/webhooks/:webhookId",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      try {
        const deleted = await deleteWebhook(req.params.appId, req.params.webhookId);
        if (!deleted) return reply.status(404).send({ error: "Webhook not found" });
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete webhook";
        return reply.status(503).send({ error: message });
      }
    }
  );
}
