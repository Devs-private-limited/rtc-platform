import { getPool } from "./db.js";
import { durationInPeriod } from "./usage-period.js";

export interface CallSession {
  id: number;
  callId: string;
  roomId: string;
  callerUserId: string;
  calleeUserId: string | null;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  endReason: string | null;
}

export type CallType = "voice" | "video";

interface MemoryCallSession {
  appId: string;
  callId: string;
  roomId: string;
  callerUserId: string;
  calleeUserId: string;
  callType: CallType;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  endReason: string | null;
}

interface MemoryEvent {
  appId: string;
  type: string;
  createdAt: string;
}

const memoryCallSessions: MemoryCallSession[] = [];
const memoryEvents: MemoryEvent[] = [];

export async function startCallSession(
  appId: string,
  callId: string,
  roomId: string,
  callerUserId: string,
  calleeUserId: string,
  callType: CallType = "voice"
) {
  const db = getPool();
  if (db) {
    await db.query(
      `INSERT INTO call_sessions (app_id, call_id, room_id, caller_user_id, callee_user_id, call_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (app_id, call_id) DO NOTHING`,
      [appId, callId, roomId, callerUserId, calleeUserId, callType]
    );
    return;
  }

  if (!memoryCallSessions.some((s) => s.appId === appId && s.callId === callId)) {
    memoryCallSessions.push({
      appId,
      callId,
      roomId,
      callerUserId,
      calleeUserId,
      callType,
      startedAt: new Date().toISOString(),
      endedAt: null,
      durationMs: null,
      endReason: null,
    });
  }
}

export async function endCallSession(appId: string, callId: string, reason = "hangup") {
  const db = getPool();
  if (db) {
    await db.query(
      `UPDATE call_sessions
       SET ended_at = NOW(),
           duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000))::bigint,
           end_reason = $3
       WHERE app_id = $1 AND call_id = $2 AND ended_at IS NULL`,
      [appId, callId, reason]
    );
    return;
  }

  const session = memoryCallSessions.find((s) => s.appId === appId && s.callId === callId);
  if (session && !session.endedAt) {
    const endedAt = new Date();
    session.endedAt = endedAt.toISOString();
    session.durationMs = endedAt.getTime() - new Date(session.startedAt).getTime();
    session.endReason = reason;
  }
}

/**
 * Closes every call the user was still on. A participant who crashes or loses
 * connectivity never sends call_end, which otherwise leaves the session open
 * forever with a NULL duration — so the call is never billed at all and shows
 * as permanently in-progress.
 */
export async function endActiveCallsForUser(
  appId: string,
  userId: string,
  reason = "disconnected"
) {
  const db = getPool();
  if (db) {
    await db.query(
      `UPDATE call_sessions
       SET ended_at = NOW(),
           duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000))::bigint,
           end_reason = $3
       WHERE app_id = $1
         AND ended_at IS NULL
         AND (caller_user_id = $2 OR callee_user_id = $2)`,
      [appId, userId, reason]
    );
    return;
  }

  const endedAt = new Date();
  for (const session of memoryCallSessions) {
    if (session.appId !== appId || session.endedAt) continue;
    if (session.callerUserId !== userId && session.calleeUserId !== userId) continue;
    session.endedAt = endedAt.toISOString();
    session.durationMs = endedAt.getTime() - new Date(session.startedAt).getTime();
    session.endReason = reason;
  }
}

export function recordMemoryEvent(appId: string, type: string) {
  memoryEvents.push({ appId, type, createdAt: new Date().toISOString() });
  if (memoryEvents.length > 10000) memoryEvents.splice(0, memoryEvents.length - 10000);
}

export async function listCallSessions(appId: string, limit = 50): Promise<CallSession[]> {
  const db = getPool();
  if (!db) {
    return memoryCallSessions
      .filter((s) => s.appId === appId)
      .slice(-limit)
      .reverse()
      .map((s, i) => ({
        id: i + 1,
        callId: s.callId,
        roomId: s.roomId,
        callerUserId: s.callerUserId,
        calleeUserId: s.calleeUserId,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationMs: s.durationMs,
        endReason: s.endReason,
      }));
  }

  const capped = Math.min(Math.max(limit, 1), 200);
  const result = await db.query(
    `SELECT id, call_id, room_id, caller_user_id, callee_user_id, started_at, ended_at,
            duration_ms, end_reason
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
    endReason: row.end_reason,
  }));
}

/**
 * Call usage is counted in participant minutes, matching the published plans:
 * a 10-minute 1:1 call is 20 participant minutes, and each person in a group
 * room accrues their own time. `callMinutes` is voice plus video.
 */
export interface MeteringSummary {
  appId: string;
  period: { from: string | null; to: string | null };
  messagesSent: number;
  callsConnected: number;
  callsEnded: number;
  voiceMinutes: number;
  videoMinutes: number;
  callMinutes: number;
  totalEvents: number;
}

const ONE_TO_ONE_PARTICIPANTS = 2;

function toMinutes(ms: number) {
  return Math.round((ms / 60_000) * 100) / 100;
}

export async function getMeteringSummary(
  appId: string,
  opts: { from?: string; to?: string } = {}
): Promise<MeteringSummary> {
  const db = getPool();
  if (!db) {
    const sessions = memoryCallSessions.filter((s) => {
      if (s.appId !== appId) return false;
      if (opts.from && s.startedAt < opts.from) return false;
      if (opts.to && s.startedAt > opts.to) return false;
      return true;
    });
    const events = memoryEvents.filter((e) => {
      if (e.appId !== appId) return false;
      if (opts.from && e.createdAt < opts.from) return false;
      if (opts.to && e.createdAt > opts.to) return false;
      return true;
    });
    const msFor = (type: CallType) => memoryCallSessions
      .filter(s => s.appId === appId && s.callType === type)
      .reduce((sum, s) => sum + durationInPeriod(s.startedAt, s.endedAt, opts), 0) * ONE_TO_ONE_PARTICIPANTS;
    const voiceMinutes = toMinutes(msFor("voice"));
    const videoMinutes = toMinutes(msFor("video"));
    return {
      appId,
      period: { from: opts.from ?? null, to: opts.to ?? null },
      messagesSent: events.filter((e) => e.type === "message.sent").length,
      callsConnected: sessions.length,
      callsEnded: sessions.filter((s) => s.endedAt).length,
      voiceMinutes,
      videoMinutes,
      callMinutes: toMinutes(msFor("voice") + msFor("video")),
      totalEvents: events.length,
    };
  }

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

  const periodArgs = [appId, opts.from || "-infinity", opts.to || new Date().toISOString()];
  const [messages, callsConnected, callsEnded, oneToOne, group, totalEvents] = await Promise.all([
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
      `SELECT call_type AS kind, COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM
        (LEAST(COALESCE(ended_at, NOW()), $3::timestamptz) - GREATEST(started_at, $2::timestamptz))) * 1000)), 0)::bigint AS total
       FROM call_sessions WHERE app_id = $1 AND started_at <= $3::timestamptz AND COALESCE(ended_at, NOW()) >= $2::timestamptz
       GROUP BY call_type`,
      periodArgs
    ),
    db.query(
      `SELECT kind, COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM
        (LEAST(COALESCE(left_at, NOW()), $3::timestamptz) - GREATEST(joined_at, $2::timestamptz))) * 1000)), 0)::bigint AS total
       FROM media_sessions WHERE app_id = $1 AND joined_at <= $3::timestamptz AND COALESCE(left_at, NOW()) >= $2::timestamptz
       GROUP BY kind`,
      periodArgs
    ),
    db.query(`SELECT COUNT(*)::int AS total FROM events WHERE ${eventFilter}`, params),
  ]);

  const msFor = (kind: CallType) =>
    Number(oneToOne.rows.find((row) => row.kind === kind)?.total ?? 0) * ONE_TO_ONE_PARTICIPANTS +
    Number(group.rows.find((row) => row.kind === kind)?.total ?? 0);

  return {
    appId,
    period: { from: opts.from ?? null, to: opts.to ?? null },
    messagesSent: messages.rows[0]?.count ?? 0,
    callsConnected: callsConnected.rows[0]?.count ?? 0,
    callsEnded: callsEnded.rows[0]?.count ?? 0,
    voiceMinutes: toMinutes(msFor("voice")),
    videoMinutes: toMinutes(msFor("video")),
    callMinutes: toMinutes(msFor("voice") + msFor("video")),
    totalEvents: totalEvents.rows[0]?.total ?? 0,
  };
}
