import type { CallQualityReportPayload } from "@rtc/protocol";
import { getPool } from "./db.js";

export interface QualityReportRecord {
  id: number;
  appId: string;
  callId: string | null;
  roomId: string;
  userId: string;
  mediaMode: string;
  qualityScore: number;
  qualityLabel: string;
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPct: number | null;
  inboundBitrateKbps: number | null;
  outboundBitrateKbps: number | null;
  connectionState: string | null;
  iceState: string | null;
  createdAt: string;
}

export interface QualitySummary {
  appId: string;
  reportCount: number;
  avgScore: number;
  poorCount: number;
  fairCount: number;
  goodCount: number;
  excellentCount: number;
  avgRttMs: number | null;
  avgPacketLossPct: number | null;
}

const memoryReports: QualityReportRecord[] = [];
let memoryId = 1;

function toRecord(row: Record<string, unknown>): QualityReportRecord {
  return {
    id: Number(row.id),
    appId: String(row.app_id ?? row.appId),
    callId: (row.call_id ?? row.callId) as string | null,
    roomId: String(row.room_id ?? row.roomId),
    userId: String(row.user_id ?? row.userId),
    mediaMode: String(row.media_mode ?? row.mediaMode),
    qualityScore: Number(row.quality_score ?? row.qualityScore),
    qualityLabel: String(row.quality_label ?? row.qualityLabel),
    rttMs: row.rtt_ms != null ? Number(row.rtt_ms) : null,
    jitterMs: row.jitter_ms != null ? Number(row.jitter_ms) : null,
    packetLossPct: row.packet_loss_pct != null ? Number(row.packet_loss_pct) : null,
    inboundBitrateKbps:
      row.inbound_bitrate_kbps != null ? Number(row.inbound_bitrate_kbps) : null,
    outboundBitrateKbps:
      row.outbound_bitrate_kbps != null ? Number(row.outbound_bitrate_kbps) : null,
    connectionState: (row.connection_state ?? row.connectionState) as string | null,
    iceState: (row.ice_state ?? row.iceState) as string | null,
    createdAt: String(row.created_at ?? row.createdAt),
  };
}

export async function saveQualityReport(
  appId: string,
  userId: string,
  payload: CallQualityReportPayload
) {
  const { metrics } = payload;
  const db = getPool();

  if (db) {
    const result = await db.query(
      `INSERT INTO call_quality_reports (
         app_id, call_id, room_id, user_id, media_mode, quality_score, quality_label,
         rtt_ms, jitter_ms, packet_loss_pct, inbound_bitrate_kbps, outbound_bitrate_kbps,
         connection_state, ice_state
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, created_at`,
      [
        appId,
        payload.callId || null,
        payload.roomId,
        userId,
        payload.mediaMode,
        payload.qualityScore,
        payload.qualityLabel,
        metrics.rttMs,
        metrics.jitterMs,
        metrics.packetLossPct,
        metrics.inboundBitrateKbps,
        metrics.outboundBitrateKbps,
        metrics.connectionState,
        metrics.iceState,
      ]
    );
    const record = toRecord({
      id: result.rows[0].id,
      app_id: appId,
      call_id: payload.callId || null,
      room_id: payload.roomId,
      user_id: userId,
      media_mode: payload.mediaMode,
      quality_score: payload.qualityScore,
      quality_label: payload.qualityLabel,
      rtt_ms: metrics.rttMs,
      jitter_ms: metrics.jitterMs,
      packet_loss_pct: metrics.packetLossPct,
      inbound_bitrate_kbps: metrics.inboundBitrateKbps,
      outbound_bitrate_kbps: metrics.outboundBitrateKbps,
      connection_state: metrics.connectionState,
      ice_state: metrics.iceState,
      created_at: result.rows[0].created_at,
    });
    memoryReports.unshift(record);
    if (memoryReports.length > 5000) memoryReports.length = 5000;
    return record;
  }

  const record: QualityReportRecord = {
    id: memoryId++,
    appId,
    callId: payload.callId || null,
    roomId: payload.roomId,
    userId,
    mediaMode: payload.mediaMode,
    qualityScore: payload.qualityScore,
    qualityLabel: payload.qualityLabel,
    rttMs: metrics.rttMs,
    jitterMs: metrics.jitterMs,
    packetLossPct: metrics.packetLossPct,
    inboundBitrateKbps: metrics.inboundBitrateKbps,
    outboundBitrateKbps: metrics.outboundBitrateKbps,
    connectionState: metrics.connectionState,
    iceState: metrics.iceState,
    createdAt: new Date().toISOString(),
  };
  memoryReports.unshift(record);
  if (memoryReports.length > 5000) memoryReports.length = 5000;
  return record;
}

export async function countQualityReportsForApp(
  appId: string,
  opts: { from?: string; to?: string } = {}
) {
  const db = getPool();
  if (!db) {
    return memoryReports.filter((r) => {
      if (r.appId !== appId) return false;
      if (opts.from && r.createdAt < opts.from) return false;
      if (opts.to && r.createdAt > opts.to) return false;
      return true;
    }).length;
  }

  const params: unknown[] = [appId];
  let filter = "app_id = $1";
  if (opts.from) {
    params.push(opts.from);
    filter += ` AND created_at >= $${params.length}`;
  }
  if (opts.to) {
    params.push(opts.to);
    filter += ` AND created_at <= $${params.length}`;
  }
  const result = await db.query(`SELECT COUNT(*)::int AS count FROM call_quality_reports WHERE ${filter}`, params);
  return result.rows[0]?.count ?? 0;
}

export async function listQualityReports(
  appId: string,
  opts: { limit?: number; callId?: string } = {}
): Promise<QualityReportRecord[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const db = getPool();

  if (db) {
    const params: unknown[] = [appId];
    let filter = "app_id = $1";
    if (opts.callId) {
      params.push(opts.callId);
      filter += ` AND call_id = $${params.length}`;
    }
    params.push(limit);
    const result = await db.query(
      `SELECT id, app_id, call_id, room_id, user_id, media_mode, quality_score, quality_label,
              rtt_ms, jitter_ms, packet_loss_pct, inbound_bitrate_kbps, outbound_bitrate_kbps,
              connection_state, ice_state, created_at
       FROM call_quality_reports WHERE ${filter}
       ORDER BY created_at DESC LIMIT $${params.length}`,
      params
    );
    return result.rows.map((row) => toRecord(row));
  }

  return memoryReports
    .filter((r) => r.appId === appId && (!opts.callId || r.callId === opts.callId))
    .slice(0, limit);
}

export async function getQualitySummary(appId: string): Promise<QualitySummary> {
  const db = getPool();

  if (db) {
    const result = await db.query(
      `SELECT
         COUNT(*)::int AS report_count,
         COALESCE(AVG(quality_score), 0)::float AS avg_score,
         COUNT(*) FILTER (WHERE quality_label = 'poor')::int AS poor_count,
         COUNT(*) FILTER (WHERE quality_label = 'fair')::int AS fair_count,
         COUNT(*) FILTER (WHERE quality_label = 'good')::int AS good_count,
         COUNT(*) FILTER (WHERE quality_label = 'excellent')::int AS excellent_count,
         AVG(rtt_ms)::float AS avg_rtt_ms,
         AVG(packet_loss_pct)::float AS avg_packet_loss_pct
       FROM call_quality_reports WHERE app_id = $1`,
      [appId]
    );
    const row = result.rows[0];
    return {
      appId,
      reportCount: row.report_count ?? 0,
      avgScore: Math.round((row.avg_score ?? 0) * 10) / 10,
      poorCount: row.poor_count ?? 0,
      fairCount: row.fair_count ?? 0,
      goodCount: row.good_count ?? 0,
      excellentCount: row.excellent_count ?? 0,
      avgRttMs: row.avg_rtt_ms != null ? Math.round(row.avg_rtt_ms) : null,
      avgPacketLossPct:
        row.avg_packet_loss_pct != null
          ? Math.round(row.avg_packet_loss_pct * 10) / 10
          : null,
    };
  }

  const reports = memoryReports.filter((r) => r.appId === appId);
  const count = reports.length;
  const avgScore = count
    ? Math.round((reports.reduce((sum, r) => sum + r.qualityScore, 0) / count) * 10) / 10
    : 0;
  const rttValues = reports.map((r) => r.rttMs).filter((v): v is number => v != null);
  const lossValues = reports.map((r) => r.packetLossPct).filter((v): v is number => v != null);

  return {
    appId,
    reportCount: count,
    avgScore,
    poorCount: reports.filter((r) => r.qualityLabel === "poor").length,
    fairCount: reports.filter((r) => r.qualityLabel === "fair").length,
    goodCount: reports.filter((r) => r.qualityLabel === "good").length,
    excellentCount: reports.filter((r) => r.qualityLabel === "excellent").length,
    avgRttMs: rttValues.length
      ? Math.round(rttValues.reduce((a, b) => a + b, 0) / rttValues.length)
      : null,
    avgPacketLossPct: lossValues.length
      ? Math.round((lossValues.reduce((a, b) => a + b, 0) / lossValues.length) * 10) / 10
      : null,
  };
}
