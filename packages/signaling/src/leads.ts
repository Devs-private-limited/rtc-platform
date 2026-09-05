import { getPool } from "./db.js";

/** Generous but bounded — real addresses are far shorter than the RFC maximum. */
export const MAX_EMAIL_LENGTH = 320;
export const MAX_COMPANY_LENGTH = 255;

export interface Lead {
  id: string;
  email: string;
  company: string | null;
  source: string;
  createdAt: string;
}

/**
 * Deliberately loose. Strict RFC-5322 validation rejects addresses that work
 * in practice, and the cost of a bad row here is trivial compared to turning
 * away a real signup.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string) {
  return EMAIL_RE.test(email) && email.length <= MAX_EMAIL_LENGTH;
}

export async function saveLead(input: {
  email: string;
  company?: string | null;
  source?: string;
  userAgent?: string | null;
}) {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const source = input.source || "website";
  const result = await db.query(
    `INSERT INTO leads (email, company, source, user_agent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (LOWER(email), source) DO UPDATE
       SET company = COALESCE(EXCLUDED.company, leads.company),
           created_at = NOW()
     RETURNING id, created_at`,
    [input.email, input.company || null, source, input.userAgent || null]
  );

  return {
    id: String(result.rows[0].id),
    createdAt: result.rows[0].created_at as string,
  };
}

export async function listLeads(opts: { limit?: number; source?: string } = {}): Promise<Lead[]> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const params: unknown[] = [];
  let query = `SELECT id, email, company, source, created_at FROM leads`;

  if (opts.source) {
    params.push(opts.source);
    query += ` WHERE source = $${params.length}`;
  }
  params.push(limit);
  query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const result = await db.query(query, params);
  return result.rows.map((row) => ({
    id: String(row.id),
    email: row.email,
    company: row.company,
    source: row.source,
    createdAt: row.created_at,
  }));
}

export async function countLeads(): Promise<number> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");
  const result = await db.query(`SELECT COUNT(*)::int AS total FROM leads`);
  return result.rows[0]?.total ?? 0;
}
