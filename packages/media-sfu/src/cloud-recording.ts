import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { SfuManager } from "./sfu.js";

export interface RecordingSession {
  sessionId: string;
  roomId: string;
  startedAt: string;
  producerIds: string[];
}

const sessions = new Map<string, RecordingSession>();
const activeByRoom = new Map<string, string>();

export class CloudRecordingManager {
  constructor(
    private sfu: SfuManager,
    private outputDir: string
  ) {}

  async start(roomId: string, sessionId = randomUUID() as string) {
    if (activeByRoom.has(roomId)) throw new Error("Recording already active");
    const producers = this.sfu.listProducers(roomId);
    const session: RecordingSession = {
      sessionId,
      roomId,
      startedAt: new Date().toISOString(),
      producerIds: producers.map((p) => p.producerId),
    };
    sessions.set(sessionId, session);
    activeByRoom.set(roomId, sessionId);
    await mkdir(this.outputDir, { recursive: true });
    return session;
  }

  async stop(roomId: string) {
    const sessionId = activeByRoom.get(roomId);
    if (!sessionId) throw new Error("No active recording");
    const session = sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    activeByRoom.delete(roomId);

    const filePath = path.join(this.outputDir, `cloud-${sessionId}.webm`);
    const marker = {
      sessionId,
      roomId,
      startedAt: session.startedAt,
      endedAt: new Date().toISOString(),
      producerIds: session.producerIds,
      note: "Composite media requires ffmpeg; this marker file records session metadata.",
    };
    await writeFile(filePath, JSON.stringify(marker, null, 2));
    return { sessionId, filePath, dataBase64: undefined as string | undefined };
  }
}
