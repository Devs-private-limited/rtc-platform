import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createApp, listApps } from "../apps.js";
import jwt from "jsonwebtoken";
import { authenticateCustomer } from "../customers.js";
import { rateLimit } from "../rate-limit.js";

// Admin sign-in uses a normal console account (email + password) whose email is listed in ADMIN_EMAILS.
// Sessions are signed with a key derived from JWT_SECRET, so customer or call tokens can never act as admin.
const ADMIN_SESSION_SEC = 8 * 60 * 60;
const adminEmails = () => (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const adminSigningKey = () => `${process.env.JWT_SECRET || "dev-jwt-secret"}:admin-session`;

export function issueAdminSession(email: string) {
  return jwt.sign({ admin: true, email: email.toLowerCase() }, adminSigningKey(), { expiresIn: ADMIN_SESSION_SEC });
}

function validAdminSession(header: unknown) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  try {
    const claims = jwt.verify(header.slice(7), adminSigningKey(), { algorithms: ["HS256"] }) as { admin?: boolean; email?: string };
    return claims.admin === true && !!claims.email && adminEmails().includes(claims.email);
  } catch {
    return false;
  }
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const key = req.headers["x-admin-key"];
  const expected = process.env.ADMIN_API_KEY || "dev-admin-key";
  if (key !== expected && !validAdminSession(req.headers.authorization)) {
    reply.status(401).send({ error: "Unauthorized" });
    return false;
  }
  return true;
}

export async function registerAdminLogin(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string } }>("/v1/admin/login", async (req, reply) => {
    if (!rateLimit(`admin-login:${req.ip}`, 5, 15 * 60 * 1000)) {
      return reply.status(429).send({ error: "Too many sign-in attempts. Try again in 15 minutes." });
    }
    const email = req.body?.email?.trim().toLowerCase() || "";
    const password = req.body?.password || "";
    if (!email || !password) return reply.status(400).send({ error: "Email and password are required" });
    // Same message for "not an admin" and "wrong password", so the admin list can't be probed.
    if (!adminEmails().includes(email)) return reply.status(401).send({ error: "Invalid email or password" });
    const account = await authenticateCustomer(email, password);
    if (!account) return reply.status(401).send({ error: "Invalid email or password" });
    return { token: issueAdminSession(email), email, expiresIn: ADMIN_SESSION_SEC };
  });
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
