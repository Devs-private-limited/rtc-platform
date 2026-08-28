import { getPool } from "./db.js";

export interface EventRecord {
  id: number;
  type: string;
  roomId: string | null;
  userId: string | null;
  payload: unknown;
  createdAt: string;
}

function extractRoomId(payload: Record<string, unknown>): string | null {
  return typeof payload.roomId === "string" ? payload.roomId : null;
}

function extractUserId(payload: Record<string, unknown>): string | null {
  if (typeof payload.userId === "string") return payload.userId;
  if (typeof payload.fromUserId === "string") return payload.fromUserId;
  return null;
}

export async function recordEvent(
  appId: string,
  type: string,
  payload: Record<string, unknown>
): Promise<{ id: number; createdAt: string } | null> {
  const db = getPool();
  if (!db) return null;

  const result = await db.query(
    `INSERT INTO events (app_id, type, room_id, user_id, payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [appId, type, extractRoomId(payload), extractUserId(payload), JSON.stringify(payload)]
  );
  return { id: result.rows[0].id, createdAt: result.rows[0].created_at };
}

export async function listEvents(
  appId: string,
  opts: { limit?: number; type?: string } = {}
): Promise<EventRecord[]> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const params: unknown[] = [appId];
  let query = `SELECT id, type, room_id, user_id, payload, created_at FROM events WHERE app_id = $1`;
  if (opts.type) {
    params.push(opts.type);
    query += ` AND type = $${params.length}`;
  }
  params.push(limit);
  query += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const result = await db.query(query, params);
  return result.rows.map((row) => ({
    id: row.id,
    type: row.type,
    roomId: row.room_id,
    userId: row.user_id,
    payload: row.payload,
    createdAt: row.created_at,
  }));
}

export interface UsageSummary {
  appId: string;
  totalEvents: number;
  byType: Array<{ type: string; count: number }>;
}

export async function getUsageSummary(appId: string): Promise<UsageSummary> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const [byType, total] = await Promise.all([
    db.query(
      `SELECT type, COUNT(*)::int AS count FROM events WHERE app_id = $1 GROUP BY type ORDER BY count DESC`,
      [appId]
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM events WHERE app_id = $1`, [appId]),
  ]);

  return {
    appId,
    totalEvents: total.rows[0]?.total ?? 0,
    byType: byType.rows,
  };
}
