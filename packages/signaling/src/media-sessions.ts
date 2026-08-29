import { getPool } from "./db.js";

export type MediaKind = "voice" | "video";

export interface MediaSession {
  roomId: string;
  userId: string;
  kind: MediaKind;
  joinedAt: string;
  leftAt: string | null;
  durationMs: number | null;
  endReason: string | null;
}

/**
 * Group media bills per participant, so duration runs from the moment the
 * participant joined — there is no ringing phase to exclude as there is for
 * 1:1 calls. Milliseconds to match `call_sessions.duration_ms`.
 */
const DURATION_EXPR = `GREATEST(0, EXTRACT(EPOCH FROM (NOW() - joined_at))::int * 1000)`;

export async function joinMediaSession(
  appId: string,
  roomId: string,
  userId: string,
  kind: MediaKind
) {
  const db = getPool();
  if (!db) return;

  await db.query(
    `INSERT INTO media_sessions (app_id, room_id, user_id, kind)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (app_id, room_id, user_id) WHERE left_at IS NULL
     DO UPDATE SET kind = EXCLUDED.kind`,
    [appId, roomId, userId, kind]
  );
}

export async function leaveMediaSession(
  appId: string,
  roomId: string,
  userId: string,
  reason = "left"
) {
  const db = getPool();
  if (!db) return;

  await db.query(
    `UPDATE media_sessions
     SET left_at = NOW(), duration_ms = ${DURATION_EXPR}, end_reason = $4
     WHERE app_id = $1 AND room_id = $2 AND user_id = $3 AND left_at IS NULL`,
    [appId, roomId, userId, reason]
  );
}

/**
 * Closes every open session for a user. Without this a dropped socket would
 * leave the participant in group media forever, inflating billed time.
 */
export async function endMediaSessionsForUser(
  appId: string,
  userId: string,
  reason = "disconnected"
) {
  const db = getPool();
  if (!db) return;

  await db.query(
    `UPDATE media_sessions
     SET left_at = NOW(), duration_ms = ${DURATION_EXPR}, end_reason = $3
     WHERE app_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [appId, userId, reason]
  );
}

function mapRow(row: Record<string, any>): MediaSession {
  return {
    roomId: row.room_id,
    userId: row.user_id,
    kind: row.kind,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    durationMs: row.duration_ms,
    endReason: row.end_reason,
  };
}

const COLUMNS = `room_id, user_id, kind, joined_at, left_at, duration_ms, end_reason`;

export async function listMediaSessions(
  appId: string,
  opts: { limit?: number; roomId?: string; userId?: string; kind?: string; active?: boolean } = {}
): Promise<MediaSession[]> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const params: unknown[] = [appId];
  let query = `SELECT ${COLUMNS} FROM media_sessions WHERE app_id = $1`;

  if (opts.roomId) {
    params.push(opts.roomId);
    query += ` AND room_id = $${params.length}`;
  }
  if (opts.userId) {
    params.push(opts.userId);
    query += ` AND user_id = $${params.length}`;
  }
  if (opts.kind) {
    params.push(opts.kind);
    query += ` AND kind = $${params.length}`;
  }
  if (opts.active) query += ` AND left_at IS NULL`;

  params.push(limit);
  query += ` ORDER BY joined_at DESC LIMIT $${params.length}`;

  const result = await db.query(query, params);
  return result.rows.map(mapRow);
}

export interface MediaStats {
  appId: string;
  totalSessions: number;
  activeSessions: number;
  /** Exact figure to bill group media on — one participant-ms per person, per ms. */
  participantMs: number;
  participantMinutes: number;
  byKind: Array<{ kind: string; count: number; participantMs: number }>;
  distinctRooms: number;
  distinctUsers: number;
}

export async function getMediaStats(appId: string): Promise<MediaStats> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const [totals, byKind] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS total_sessions,
              COUNT(*) FILTER (WHERE left_at IS NULL)::int AS active_sessions,
              COALESCE(SUM(duration_ms), 0)::bigint AS participant_ms,
              COUNT(DISTINCT room_id)::int AS distinct_rooms,
              COUNT(DISTINCT user_id)::int AS distinct_users
       FROM media_sessions WHERE app_id = $1`,
      [appId]
    ),
    db.query(
      `SELECT kind, COUNT(*)::int AS count, COALESCE(SUM(duration_ms), 0)::bigint AS participant_ms
       FROM media_sessions WHERE app_id = $1 GROUP BY kind ORDER BY count DESC`,
      [appId]
    ),
  ]);

  const row = totals.rows[0];
  const participantMs = Number(row?.participant_ms ?? 0);

  return {
    appId,
    totalSessions: row?.total_sessions ?? 0,
    activeSessions: row?.active_sessions ?? 0,
    participantMs,
    participantMinutes: Math.round((participantMs / 60000) * 100) / 100,
    byKind: byKind.rows.map((r) => ({
      kind: r.kind,
      count: r.count,
      participantMs: Number(r.participant_ms),
    })),
    distinctRooms: row?.distinct_rooms ?? 0,
    distinctUsers: row?.distinct_users ?? 0,
  };
}
