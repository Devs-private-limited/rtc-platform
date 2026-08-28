import { mkdir, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { getPool } from "./db.js";

export type IntelligenceStatus = "pending" | "processing" | "transcribed" | "complete" | "failed";

export interface RecordingRecord {
  id: string;
  appId: string;
  callId: string | null;
  roomId: string;
  userId: string;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
  storagePath: string | null;
  transcript: string | null;
  summary: string | null;
  intelligenceStatus: IntelligenceStatus;
}

const memoryRecordings = new Map<string, RecordingRecord>();

let recordingsDir = path.join(process.cwd(), "data", "recordings");

export function setRecordingsDir(dir: string) {
  recordingsDir = dir;
}

export async function ensureRecordingsDir() {
  await mkdir(recordingsDir, { recursive: true });
}

function toRecord(row: Record<string, unknown>): RecordingRecord {
  return {
    id: String(row.id),
    appId: String(row.app_id ?? row.appId),
    callId: (row.call_id ?? row.callId) as string | null,
    roomId: String(row.room_id ?? row.roomId),
    userId: String(row.user_id ?? row.userId),
    durationMs: Number(row.duration_ms ?? row.durationMs),
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes),
    mimeType: String(row.mime_type ?? row.mimeType),
    createdAt: String(row.created_at ?? row.createdAt),
    storagePath: (row.storage_path ?? row.storagePath) as string | null,
    transcript: (row.transcript as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    intelligenceStatus: (row.intelligence_status ?? row.intelligenceStatus ?? "pending") as IntelligenceStatus,
  };
}

export async function saveRecording(
  appId: string,
  userId: string,
  data: {
    callId?: string;
    roomId: string;
    durationMs: number;
    sizeBytes: number;
    mimeType: string;
  }
) {
  const db = getPool();
  if (db) {
    const result = await db.query(
      `INSERT INTO recordings (app_id, call_id, room_id, user_id, duration_ms, size_bytes, mime_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        appId,
        data.callId || null,
        data.roomId,
        userId,
        data.durationMs,
        data.sizeBytes,
        data.mimeType,
      ]
    );
    const id = result.rows[0].id as string;
    const createdAt = result.rows[0].created_at as string;
    memoryRecordings.set(id, {
      id,
      appId,
      callId: data.callId || null,
      roomId: data.roomId,
      userId,
      durationMs: data.durationMs,
      sizeBytes: data.sizeBytes,
      mimeType: data.mimeType,
      createdAt,
      storagePath: null,
      transcript: null,
      summary: null,
      intelligenceStatus: "pending",
    });
    return { id, createdAt };
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  memoryRecordings.set(id, {
    id,
    appId,
    callId: data.callId || null,
    roomId: data.roomId,
    userId,
    durationMs: data.durationMs,
    sizeBytes: data.sizeBytes,
    mimeType: data.mimeType,
    createdAt,
    storagePath: null,
    transcript: null,
    summary: null,
    intelligenceStatus: "pending",
  });
  return { id, createdAt };
}

export async function getRecording(recordingId: string): Promise<RecordingRecord | null> {
  const cached = memoryRecordings.get(recordingId);
  if (cached) return cached;

  const db = getPool();
  if (!db) return null;

  const result = await db.query(
    `SELECT id, app_id, call_id, room_id, user_id, duration_ms, size_bytes, mime_type,
            created_at, storage_path, transcript, summary, intelligence_status
     FROM recordings WHERE id = $1`,
    [recordingId]
  );
  if (!result.rows[0]) return null;
  const record = toRecord(result.rows[0]);
  memoryRecordings.set(record.id, record);
  return record;
}

export async function saveRecordingFile(recordingId: string, buffer: Buffer, mimeType: string) {
  await ensureRecordingsDir();
  const ext = mimeType.includes("video") ? "webm" : "webm";
  const filePath = path.join(recordingsDir, `${recordingId}.${ext}`);
  await writeFile(filePath, buffer);

  const db = getPool();
  if (db) {
    await db.query(`UPDATE recordings SET storage_path = $1 WHERE id = $2`, [filePath, recordingId]);
  }

  const record = memoryRecordings.get(recordingId);
  if (record) {
    record.storagePath = filePath;
    record.mimeType = mimeType;
    record.sizeBytes = buffer.length;
  } else {
    memoryRecordings.set(recordingId, {
      id: recordingId,
      appId: "",
      callId: null,
      roomId: "",
      userId: "",
      durationMs: 0,
      sizeBytes: buffer.length,
      mimeType,
      createdAt: new Date().toISOString(),
      storagePath: filePath,
      transcript: null,
      summary: null,
      intelligenceStatus: "pending",
    });
  }

  return filePath;
}

export async function updateRecordingIntelligence(
  recordingId: string,
  data: {
    transcript?: string;
    summary?: string;
    intelligenceStatus?: IntelligenceStatus;
  }
) {
  const db = getPool();
  if (db) {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (data.transcript != null) {
      sets.push(`transcript = $${i++}`);
      values.push(data.transcript);
    }
    if (data.summary != null) {
      sets.push(`summary = $${i++}`);
      values.push(data.summary);
    }
    if (data.intelligenceStatus) {
      sets.push(`intelligence_status = $${i++}`);
      values.push(data.intelligenceStatus);
    }
    if (sets.length) {
      values.push(recordingId);
      await db.query(`UPDATE recordings SET ${sets.join(", ")} WHERE id = $${i}`, values);
    }
  }

  const record = memoryRecordings.get(recordingId);
  if (record) {
    if (data.transcript != null) record.transcript = data.transcript;
    if (data.summary != null) record.summary = data.summary;
    if (data.intelligenceStatus) record.intelligenceStatus = data.intelligenceStatus;
  }
}

export async function countRecordingsForApp(
  appId: string,
  opts: { from?: string; to?: string } = {}
) {
  const db = getPool();
  if (!db) {
    return [...memoryRecordings.values()].filter((r) => {
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
  const result = await db.query(`SELECT COUNT(*)::int AS count FROM recordings WHERE ${filter}`, params);
  return result.rows[0]?.count ?? 0;
}

export async function listRecordings(appId: string, limit = 50): Promise<RecordingRecord[]> {
  const db = getPool();
  if (!db) {
    return [...memoryRecordings.values()]
      .filter((r) => r.appId === appId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  const capped = Math.min(Math.max(limit, 1), 200);
  const result = await db.query(
    `SELECT id, app_id, call_id, room_id, user_id, duration_ms, size_bytes, mime_type,
            created_at, storage_path, transcript, summary, intelligence_status
     FROM recordings WHERE app_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [appId, capped]
  );

  return result.rows.map((row) => toRecord(row));
}
