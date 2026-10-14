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

async function sendEnquiryAlert(input: { email: string; company: string | null; source: string }) {
  const recipient = process.env.ENQUIRY_ALERT_TO;
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !recipient) return false;

  const company = input.company || "Not provided";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [recipient],
      reply_to: input.email,
      subject: `New RTCExpress enquiry from ${input.email}`,
      text: `A new ${input.source} enquiry was received.\n\nEmail: ${input.email}\nCompany / product: ${company}\nSource: ${input.source}\n\nReply directly to this email to contact the person.`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Email provider rejected enquiry alert (${response.status})`);
  return true;
}

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
      const source = req.body?.source === "demo" ? "demo" : "website";
      await saveLead({
        email,
        company,
        source,
        userAgent: req.headers["user-agent"] || null,
      });
      // Saving the enquiry is the primary action. An alert failure must never
      // make a visitor think their request was lost.
      void sendEnquiryAlert({ email, company, source }).catch((err) =>
        app.log.error({ err, email }, "Unable to send customer enquiry alert")
      );
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
