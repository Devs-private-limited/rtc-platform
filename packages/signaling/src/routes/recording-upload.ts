import type { FastifyInstance } from "fastify";
import { verifyToken } from "../auth.js";
import type { SignalingEnv } from "../env.js";
import { processRecordingIntelligence, type DispatchFn, type SendToUserFn } from "../intelligence.js";
import { getRecording, saveRecordingFile } from "../recordings.js";

interface UploadDeps {
  env: SignalingEnv;
  dispatch: DispatchFn;
  sendToUser: SendToUserFn;
}

export async function registerRecordingUploadRoutes(app: FastifyInstance, deps: UploadDeps) {
  app.addContentTypeParser(
    ["application/octet-stream", "audio/webm", "video/webm"],
    { parseAs: "buffer" },
    (_req, body, done) => {
      done(null, body);
    }
  );

  app.post<{ Params: { recordingId: string } }>(
    "/v1/recordings/:recordingId/upload",
    async (req, reply) => {
      const auth = req.headers.authorization;
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      if (!token) {
        return reply.status(401).send({ error: "Bearer token required" });
      }

      let claims;
      try {
        claims = verifyToken(token, deps.env.jwtSecret);
      } catch {
        return reply.status(401).send({ error: "Invalid token" });
      }

      const recording = await getRecording(req.params.recordingId);
      if (!recording) {
        return reply.status(404).send({ error: "Recording not found" });
      }
      if (recording.appId !== claims.appId || recording.userId !== claims.userId) {
        return reply.status(403).send({ error: "Not allowed to upload this recording" });
      }

      const buffer = req.body as Buffer;
      if (!buffer?.length) {
        return reply.status(400).send({ error: "Empty upload body" });
      }

      const mimeType =
        typeof req.headers["content-type"] === "string"
          ? req.headers["content-type"].split(";")[0]
          : recording.mimeType;

      await saveRecordingFile(recording.id, buffer, mimeType);
      deps.dispatch(recording.appId, "recording.uploaded", {
        recordingId: recording.id,
        roomId: recording.roomId,
        callId: recording.callId,
        userId: recording.userId,
        sizeBytes: buffer.length,
      });

      void processRecordingIntelligence(
        recording.id,
        deps.env,
        deps.dispatch,
        deps.sendToUser
      );

      return { ok: true, recordingId: recording.id };
    }
  );
}
