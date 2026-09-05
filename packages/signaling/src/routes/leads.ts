import type { FastifyInstance } from "fastify";
import {
  countLeads,
  isValidEmail,
  listLeads,
  MAX_COMPANY_LENGTH,
  saveLead,
} from "../leads.js";
import { rateLimit } from "../rate-limit.js";
import { requireAdmin } from "./admin.js";

/** Public endpoint, so it is limited far more tightly than the authed routes. */
const SUBMIT_LIMIT = 5;
const SUBMIT_WINDOW_MS = 60 * 60 * 1000;

export async function registerLeadRoutes(app: FastifyInstance) {
  // Public — called by the marketing site's early-access form. No auth by
  // design; abuse is bounded by the IP rate limit and a honeypot field.
  app.post<{
    Body: { email?: string; company?: string; source?: string; website?: string };
  }>("/v1/leads", async (req, reply) => {
    if (!rateLimit(`lead:${req.ip}`, SUBMIT_LIMIT, SUBMIT_WINDOW_MS)) {
      return reply.status(429).send({ error: "Too many requests. Please try again later." });
    }

    // Honeypot: a hidden field real users never fill in. Answer 200 so bots
    // get no signal that they were caught.
    if (req.body?.website) {
      return reply.status(200).send({ ok: true });
    }

    const email = req.body?.email?.trim();
    const company = req.body?.company?.trim().slice(0, MAX_COMPANY_LENGTH) || null;

    if (!email || !isValidEmail(email)) {
      return reply.status(400).send({ error: "A valid email address is required" });
    }

    try {
      await saveLead({
        email,
        company,
        source: req.body?.source === "demo" ? "demo" : "website",
        userAgent: req.headers["user-agent"] || null,
      });
      return reply.status(201).send({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to record signup";
      return reply.status(503).send({ error: message });
    }
  });

  app.get<{ Querystring: { limit?: string; source?: string } }>(
    "/v1/admin/leads",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      try {
        const [leads, total] = await Promise.all([
          listLeads({
            limit: req.query.limit ? Number(req.query.limit) : undefined,
            source: req.query.source,
          }),
          countLeads(),
        ]);
        return { total, leads };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to list leads";
        return reply.status(503).send({ error: message });
      }
    }
  );
}
