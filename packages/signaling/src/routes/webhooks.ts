import type { FastifyInstance } from "fastify";
import { createWebhook, deleteWebhook, listWebhookDeliveries, listWebhooks, updateWebhook } from "../webhooks.js";
import { isValidEventType, WEBHOOK_EVENT_TYPES } from "../event-types.js";
import { requireAdmin } from "./admin.js";

export async function registerWebhookRoutes(app: FastifyInstance) {
  app.get("/v1/admin/webhook-event-types", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { eventTypes: WEBHOOK_EVENT_TYPES };
  });

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
      if (!events.every(isValidEventType)) {
        return reply.status(400).send({ error: "Invalid event type in events array" });
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

  app.patch<{
    Params: { appId: string; webhookId: string };
    Body: { active?: boolean; url?: string; events?: string[] };
  }>("/v1/admin/apps/:appId/webhooks/:webhookId", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    if (req.body?.events && !req.body.events.every(isValidEventType)) {
      return reply.status(400).send({ error: "Invalid event type in events array" });
    }
    try {
      const updated = await updateWebhook(req.params.appId, req.params.webhookId, {
        active: req.body?.active,
        url: req.body?.url?.trim(),
        eventTypes: req.body?.events,
      });
      if (!updated) return reply.status(404).send({ error: "Webhook not found" });
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update webhook";
      return reply.status(503).send({ error: message });
    }
  });

  app.get<{
    Params: { appId: string };
    Querystring: { webhookId?: string; limit?: string };
  }>("/v1/admin/apps/:appId/webhook-deliveries", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      const deliveries = await listWebhookDeliveries(req.params.appId, {
        webhookId: req.query.webhookId,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
      });
      return { deliveries };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to list deliveries";
      return reply.status(503).send({ error: message });
    }
  });
}
