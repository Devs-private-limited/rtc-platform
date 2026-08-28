import { getPool } from "./db.js";

export type CallStatus = "ringing" | "connected" | "ended" | "rejected" | "abandoned";

export interface CallSession {
  callId: string;
  roomId: string | null;
  initiatorId: string;
  calleeId: string | null;
  status: CallStatus;
  startedAt: string;
  connectedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  endReason: string | null;
}

interface CallEventPayload {
  callId?: string;
  roomId?: string;
  fromUserId?: string;
  toUserId?: string;
}

/**
 * Billable duration is measured from answer to hangup — time spent ringing
 * is deliberately excluded.
 */
const DURATION_EXPR = `
  CASE WHEN connected_at IS NULL THEN 0
       ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - connected_at))::int)
  END`;

async function startSession(appId: string, payload: CallEventPayload) {
  const db = getPool();
  if (!db || !payload.callId || !payload.fromUserId) return;

  await db.query(
    `INSERT INTO call_sessions (app_id, call_id, room_id, initiator_id, callee_id, status)
     VALUES ($1, $2, $3, $4, $5, 'ringing')
     ON CONFLICT (app_id, call_id) DO NOTHING`,
    [appId, payload.callId, payload.roomId ?? null, payload.fromUserId, payload.toUserId ?? null]
  );
}

async function markConnected(appId: string, payload: CallEventPayload) {
  const db = getPool();
  if (!db || !payload.callId) return;

  await db.query(
    `UPDATE call_sessions
     SET status = 'connected', connected_at = NOW()
     WHERE app_id = $1 AND call_id = $2 AND status = 'ringing'`,
    [appId, payload.callId]
  );
}

async function endSession(
  appId: string,
  payload: CallEventPayload,
  status: CallStatus,
  reason: string
) {
  const db = getPool();
  if (!db || !payload.callId) return;

  await db.query(
    `UPDATE call_sessions
     SET status = $3,
         ended_at = NOW(),
         duration_seconds = ${DURATION_EXPR},
         end_reason = $4
     WHERE app_id = $1 AND call_id = $2 AND status IN ('ringing', 'connected')`,
    [appId, payload.callId, status, reason]
  );
}

/**
 * Closes out any call the user was still part of. Without this, a browser
 * crash or lost connection would leave a session open forever and inflate
 * its billable duration.
 */
export async function endActiveCallsForUser(appId: string, userId: string) {
  const db = getPool();
  if (!db) return;

  await db.query(
    `UPDATE call_sessions
     SET status = 'abandoned',
         ended_at = NOW(),
         duration_seconds = ${DURATION_EXPR},
         end_reason = 'disconnected'
     WHERE app_id = $1
       AND status IN ('ringing', 'connected')
       AND (initiator_id = $2 OR callee_id = $2)`,
    [appId, userId]
  );
}

/**
 * Maps the call.* events already emitted by the WebSocket handlers onto
 * session lifecycle transitions. No-ops when no database is configured.
 */
export async function trackCallEvent(appId: string, type: string, payload: Record<string, unknown>) {
  const call = payload as CallEventPayload;

  switch (type) {
    case "call.ringing":
      return startSession(appId, call);
    case "call.connected":
      return markConnected(appId, call);
    case "call.failed":
      return endSession(appId, call, "rejected", "rejected");
    case "call.ended":
      return endSession(appId, call, "ended", "hangup");
    default:
      return;
  }
}

function mapRow(row: Record<string, any>): CallSession {
  return {
    callId: row.call_id,
    roomId: row.room_id,
    initiatorId: row.initiator_id,
    calleeId: row.callee_id,
    status: row.status,
    startedAt: row.started_at,
    connectedAt: row.connected_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    endReason: row.end_reason,
  };
}

const CALL_COLUMNS = `call_id, room_id, initiator_id, callee_id, status,
  started_at, connected_at, ended_at, duration_seconds, end_reason`;

export async function listCallSessions(
  appId: string,
  opts: { limit?: number; status?: string; userId?: string } = {}
): Promise<CallSession[]> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const params: unknown[] = [appId];
  let query = `SELECT ${CALL_COLUMNS} FROM call_sessions WHERE app_id = $1`;

  if (opts.status) {
    params.push(opts.status);
    query += ` AND status = $${params.length}`;
  }
  if (opts.userId) {
    params.push(opts.userId);
    query += ` AND (initiator_id = $${params.length} OR callee_id = $${params.length})`;
  }
  params.push(limit);
  query += ` ORDER BY started_at DESC LIMIT $${params.length}`;

  const result = await db.query(query, params);
  return result.rows.map(mapRow);
}

export async function getCallSession(appId: string, callId: string): Promise<CallSession | null> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const result = await db.query(
    `SELECT ${CALL_COLUMNS} FROM call_sessions WHERE app_id = $1 AND call_id = $2`,
    [appId, callId]
  );
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export interface CallStats {
  appId: string;
  totalCalls: number;
  connectedCalls: number;
  totalDurationSeconds: number;
  /** Two participants per 1:1 call — the unit voice pricing is billed in. */
  participantSeconds: number;
  /** Convenience view of participantSeconds; kept fractional so short calls aren't rounded away. */
  participantMinutes: number;
  averageDurationSeconds: number;
  byStatus: Array<{ status: string; count: number }>;
}

export async function getCallStats(appId: string): Promise<CallStats> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const [totals, byStatus] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS total_calls,
              COUNT(connected_at)::int AS connected_calls,
              COALESCE(SUM(duration_seconds), 0)::int AS total_duration
       FROM call_sessions WHERE app_id = $1`,
      [appId]
    ),
    db.query(
      `SELECT status, COUNT(*)::int AS count
       FROM call_sessions WHERE app_id = $1 GROUP BY status ORDER BY count DESC`,
      [appId]
    ),
  ]);

  const row = totals.rows[0];
  const connected = row?.connected_calls ?? 0;
  const totalDuration = row?.total_duration ?? 0;

  return {
    appId,
    totalCalls: row?.total_calls ?? 0,
    connectedCalls: connected,
    totalDurationSeconds: totalDuration,
    participantSeconds: totalDuration * 2,
    participantMinutes: Math.round(((totalDuration * 2) / 60) * 100) / 100,
    averageDurationSeconds: connected ? Math.round(totalDuration / connected) : 0,
    byStatus: byStatus.rows,
  };
}
