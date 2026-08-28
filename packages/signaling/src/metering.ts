import { getPool } from "./db.js";

export interface CallSession {
  id: number;
  callId: string;
  roomId: string;
  callerUserId: string;
  calleeUserId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
}

export async function startCallSession(
  appId: string,
  callId: string,
  roomId: string,
  callerUserId: string,
  calleeUserId: string
) {
  const db = getPool();
  if (!db) return;

  await db.query(
    `INSERT INTO call_sessions (app_id, call_id, room_id, caller_user_id, callee_user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (app_id, call_id) DO NOTHING`,
    [appId, callId, roomId, callerUserId, calleeUserId]
  );
}

export async function endCallSession(appId: string, callId: string) {
  const db = getPool();
  if (!db) return;

  await db.query(
    `UPDATE call_sessions
     SET ended_at = NOW(),
         duration_ms = EXTRACT(EPOCH FROM (NOW() - started_at))::int * 1000
     WHERE app_id = $1 AND call_id = $2 AND ended_at IS NULL`,
    [appId, callId]
  );
}

export async function listCallSessions(appId: string, limit = 50): Promise<CallSession[]> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const capped = Math.min(Math.max(limit, 1), 200);
  const result = await db.query(
    `SELECT id, call_id, room_id, caller_user_id, callee_user_id, started_at, ended_at, duration_ms
     FROM call_sessions WHERE app_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [appId, capped]
  );

  return result.rows.map((row) => ({
    id: row.id,
    callId: row.call_id,
    roomId: row.room_id,
    callerUserId: row.caller_user_id,
    calleeUserId: row.callee_user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
  }));
}

export interface MeteringSummary {
  appId: string;
  period: { from: string | null; to: string | null };
  messagesSent: number;
  callsConnected: number;
  callsEnded: number;
  callMinutes: number;
  totalEvents: number;
}

export async function getMeteringSummary(
  appId: string,
  opts: { from?: string; to?: string } = {}
): Promise<MeteringSummary> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const params: unknown[] = [appId];
  let eventFilter = "app_id = $1";
  if (opts.from) {
    params.push(opts.from);
    eventFilter += ` AND created_at >= $${params.length}`;
  }
  if (opts.to) {
    params.push(opts.to);
    eventFilter += ` AND created_at <= $${params.length}`;
  }

  const sessionParams: unknown[] = [appId];
  let sessionFilter = "app_id = $1";
  if (opts.from) {
    sessionParams.push(opts.from);
    sessionFilter += ` AND started_at >= $${sessionParams.length}`;
  }
  if (opts.to) {
    sessionParams.push(opts.to);
    sessionFilter += ` AND started_at <= $${sessionParams.length}`;
  }

  const [messages, callsConnected, callsEnded, callMinutes, totalEvents] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS count FROM events WHERE ${eventFilter} AND type = 'message.sent'`,
      params
    ),
    db.query(`SELECT COUNT(*)::int AS count FROM call_sessions WHERE ${sessionFilter}`, sessionParams),
    db.query(
      `SELECT COUNT(*)::int AS count FROM call_sessions WHERE ${sessionFilter} AND ended_at IS NOT NULL`,
      sessionParams
    ),
    db.query(
      `SELECT COALESCE(SUM(duration_ms), 0)::bigint AS total FROM call_sessions WHERE ${sessionFilter} AND duration_ms IS NOT NULL`,
      sessionParams
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM events WHERE ${eventFilter}`, params),
  ]);

  return {
    appId,
    period: { from: opts.from ?? null, to: opts.to ?? null },
    messagesSent: messages.rows[0]?.count ?? 0,
    callsConnected: callsConnected.rows[0]?.count ?? 0,
    callsEnded: callsEnded.rows[0]?.count ?? 0,
    callMinutes: Math.round((Number(callMinutes.rows[0]?.total ?? 0) / 60_000) * 100) / 100,
    totalEvents: totalEvents.rows[0]?.total ?? 0,
  };
}
