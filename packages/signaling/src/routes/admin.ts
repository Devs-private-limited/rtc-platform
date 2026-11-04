import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createApp, listApps } from "../apps.js";
import jwt from "jsonwebtoken";
import { authenticateCustomer } from "../customers.js";
import { rateLimit } from "../rate-limit.js";
import { getPool } from "../db.js";

// Admin sign-in uses a normal console account (email + password).
// Roles: owner = email listed in ADMIN_EMAILS on the server (can never be locked out, manages the team);
// admin = added by an owner in the panel (can change customers' plans and minutes);
// viewer = added by an owner (can see everything, change nothing).
// Sessions are signed with a key derived from JWT_SECRET, so customer or call tokens can never act as admin.
// The role is looked up on every request, so removing someone takes effect immediately.
export type AdminRole = "owner" | "admin" | "viewer";
export interface AdminIdentity { email: string; role: AdminRole }

const ADMIN_SESSION_SEC = 8 * 60 * 60;
const RANK: Record<AdminRole, number> = { viewer: 1, admin: 2, owner: 3 };
const ownerEmails = () => (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const adminSigningKey = () => `${process.env.JWT_SECRET || "dev-jwt-secret"}:admin-session`;

// Panel-added admins, cached in memory so the (synchronous) per-request check stays fast.
// Refreshed at startup, after every change, and every minute (in case of several server instances).
let team = new Map<string, "admin" | "viewer">();
export async function loadAdminTeam() {
  const db = getPool();
  if (!db) return;
  try {
    const r = await db.query("SELECT email, role FROM admin_users");
    team = new Map(r.rows.map((row: { email: string; role: "admin" | "viewer" }) => [row.email.toLowerCase(), row.role]));
  } catch {
    /* table missing (old database or tests): keep the current list */
  }
}

export function roleFor(email: string): AdminRole | null {
  const e = email.trim().toLowerCase();
  if (ownerEmails().includes(e)) return "owner";
  return team.get(e) ?? null;
}

export const isOwnerEmail = (email: string) => ownerEmails().includes(email.trim().toLowerCase());

export function issueAdminSession(email: string) {
  return jwt.sign({ admin: true, email: email.toLowerCase() }, adminSigningKey(), { expiresIn: ADMIN_SESSION_SEC });
}

function sessionIdentity(header: unknown): AdminIdentity | null {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return null;
  try {
    const claims = jwt.verify(header.slice(7), adminSigningKey(), { algorithms: ["HS256"] }) as { admin?: boolean; email?: string };
    if (claims.admin !== true || !claims.email) return null;
    const role = roleFor(claims.email);
    return role ? { email: claims.email, role } : null;
  } catch {
    return null;
  }
}

export function adminIdentity(req: FastifyRequest): AdminIdentity | null {
  const key = req.headers["x-admin-key"];
  const expected = process.env.ADMIN_API_KEY || "dev-admin-key";
  if (key === expected) return { email: "server-api-key", role: "owner" };
  return sessionIdentity(req.headers.authorization);
}

/**
 * Lets the request through if the caller is an admin with at least `need`.
 * Default: reading (GET/HEAD) needs viewer, anything that changes data needs admin.
 */
export function requireAdmin(req: FastifyRequest, reply: FastifyReply, need?: AdminRole) {
  const who = adminIdentity(req);
  if (!who) {
    reply.status(401).send({ error: "Unauthorized" });
    return false;
  }
  const required = need ?? (req.method === "GET" || req.method === "HEAD" ? "viewer" : "admin");
  if (RANK[who.role] < RANK[required]) {
    reply.status(403).send({ error: required === "owner" ? "Only the owner can do this." : "Your admin access is view-only." });
    return false;
  }
  return true;
}

const AUDIT_PAGE_SIZE = 20;
const AUDIT_KINDS = ["all", "plan", "minutes", "account", "team", "summary"];

export async function audit(actor: string, action: string, target: string | null, detail: Record<string, unknown> = {}) {
  const db = getPool();
  if (!db) return;
  await db.query("INSERT INTO admin_audit(actor, action, target, detail) VALUES ($1, $2, $3, $4)", [actor, action, target, JSON.stringify(detail)]);
}

export async function registerAdminLogin(app: FastifyInstance) {
  await loadAdminTeam();
  setInterval(() => void loadAdminTeam(), 60_000).unref();

  app.post<{ Body: { email?: string; password?: string } }>("/v1/admin/login", async (req, reply) => {
    if (!rateLimit(`admin-login:${req.ip}`, 5, 15 * 60 * 1000)) {
      return reply.status(429).send({ error: "Too many sign-in attempts. Try again in 15 minutes." });
    }
    const email = req.body?.email?.trim().toLowerCase() || "";
    const password = req.body?.password || "";
    if (!email || !password) return reply.status(400).send({ error: "Email and password are required" });
    // Same message for "not an admin" and "wrong password", so the admin list can't be probed.
    const role = roleFor(email);
    if (!role) return reply.status(401).send({ error: "Invalid email or password" });
    const account = await authenticateCustomer(email, password);
    if (!account) return reply.status(401).send({ error: "Invalid email or password" });
    return { token: issueAdminSession(email), email, role, expiresIn: ADMIN_SESSION_SEC };
  });

  app.get("/v1/admin/me", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return adminIdentity(req);
  });

  // ---- Team (owner manages; everyone can see who has access) ----
  app.get("/v1/admin/team", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const db = getPool(); if (!db) return reply.code(503).send({ error: "Database unavailable" });
    const owners = ownerEmails();
    const [rows, accounts] = await Promise.all([
      db.query("SELECT email, role, added_by, created_at FROM admin_users ORDER BY created_at"),
      db.query("SELECT LOWER(email) email FROM customer_accounts WHERE LOWER(email) = ANY($1::text[])", [[...owners]]),
    ]);
    const hasAccount = new Set(accounts.rows.map((r: { email: string }) => r.email));
    return {
      owners: owners.map((email) => ({ email, role: "owner", hasConsoleAccount: hasAccount.has(email) })),
      members: rows.rows,
    };
  });

  app.post<{ Body: { email?: string; role?: string } }>("/v1/admin/team", async (req, reply) => {
    if (!requireAdmin(req, reply, "owner")) return;
    const email = String(req.body?.email || "").trim().toLowerCase();
    const role = req.body?.role;
    if (!email || email.length > 320 || !email.includes("@")) return reply.code(400).send({ error: "Enter a valid email address." });
    if (role !== "admin" && role !== "viewer") return reply.code(400).send({ error: "Choose Admin or View only." });
    if (isOwnerEmail(email)) return reply.code(400).send({ error: "This email is already an owner." });
    const db = getPool(); if (!db) return reply.code(503).send({ error: "Database unavailable" });
    const account = await db.query("SELECT 1 FROM customer_accounts WHERE LOWER(email) = $1", [email]);
    if (!account.rowCount) return reply.code(400).send({ error: "There is no RTCExpress console account with this email. Ask them to sign up at rtc.devsquarelabs.com first, then add them here." });
    const who = adminIdentity(req)!;
    await db.query(
      `INSERT INTO admin_users(email, role, added_by) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role`,
      [email, role, who.email]
    );
    await audit(who.email, "team.set", email, { role });
    await loadAdminTeam();
    return { email, role };
  });

  app.delete<{ Params: { email: string } }>("/v1/admin/team/:email", async (req, reply) => {
    if (!requireAdmin(req, reply, "owner")) return;
    const email = decodeURIComponent(req.params.email).trim().toLowerCase();
    const db = getPool(); if (!db) return reply.code(503).send({ error: "Database unavailable" });
    const r = await db.query("DELETE FROM admin_users WHERE email = $1 RETURNING email", [email]);
    if (!r.rowCount) return reply.code(404).send({ error: isOwnerEmail(email) ? "Owners are set on the server (ADMIN_EMAILS) and can't be removed here." : "Not on the team." });
    await audit(adminIdentity(req)!.email, "team.remove", email);
    await loadAdminTeam();
    return { removed: email };
  });

  // Change history: search, filter by kind of change, and pages of 20.
  app.get<{ Querystring: { q?: string; kind?: string; page?: string } }>("/v1/admin/audit", async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const q = String(req.query.q || "").trim().slice(0, 200);
    const kind = String(req.query.kind || "all");
    const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
    if (!AUDIT_KINDS.includes(kind)) return reply.code(400).send({ error: "Invalid filter" });
    const db = getPool(); if (!db) return reply.code(503).send({ error: "Database unavailable" });
    const where = `($1 = '' OR actor ILIKE $2 OR COALESCE(target, '') ILIKE $2 OR action ILIKE $2 OR detail::text ILIKE $2)
      AND ($3 = 'all' OR split_part(action, '.', 1) = $3)`;
    const like = `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    const [rows, count] = await Promise.all([
      db.query(`SELECT actor, action, target, detail, created_at FROM admin_audit WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $4 OFFSET $5`, [q, like, kind, AUDIT_PAGE_SIZE, (page - 1) * AUDIT_PAGE_SIZE]),
      db.query(`SELECT COUNT(*)::int AS n FROM admin_audit WHERE ${where}`, [q, like, kind]),
    ]);
    return { entries: rows.rows, total: count.rows[0].n, page, pageSize: AUDIT_PAGE_SIZE };
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
