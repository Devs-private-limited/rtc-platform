import type { FastifyInstance } from "fastify";
import {
  getActiveCdnStream,
  listCdnStreams,
  startCdnStream,
  stopCdnStream,
} from "../cdn-stream.js";
import { canModerate } from "../room-roles.js";
import type { RoomRoleStore } from "../room-roles.js";
import type { RoomStore } from "../store/types.js";
import { requireUser } from "../user-auth.js";
import { requireAdmin } from "./admin.js";

export async function registerCdnStreamRoutes(
  app: FastifyInstance,
  deps: {
    jwtSecret: string;
    rooms: RoomStore;
    roomRoles: RoomRoleStore;
  }
) {
  app.post<{ Params: { roomId: string } }>(
    "/v1/rooms/:roomId/cdn-stream/start",
    async (req, reply) => {
      const claims = requireUser(req, reply, deps.jwtSecret);
      if (!claims) return;
      const roomId = req.params.roomId;
      if (claims.roomId && claims.roomId !== roomId) {
        return reply.status(403).send({ error: "Token is not valid for this room" });
      }
      if (!(await deps.rooms.isMember(roomId, claims.userId))) {
        return reply.status(403).send({ error: "Join the room first" });
      }
      if (!canModerate(deps.roomRoles.get(roomId, claims.userId))) {
        return reply.status(403).send({ error: "Only the room host can start CDN streaming" });
      }
      try {
        const session = await startCdnStream(
          claims.appId,
          roomId,
          claims.userId,
          deps.jwtSecret
        );
        return { session };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to start CDN stream";
        return reply.status(400).send({ error: message });
      }
    }
  );

  app.post<{ Params: { roomId: string } }>(
    "/v1/rooms/:roomId/cdn-stream/stop",
    async (req, reply) => {
      const claims = requireUser(req, reply, deps.jwtSecret);
      if (!claims) return;
      const roomId = req.params.roomId;
      if (!canModerate(deps.roomRoles.get(roomId, claims.userId))) {
        return reply.status(403).send({ error: "Only the room host can stop CDN streaming" });
      }
      try {
        const session = await stopCdnStream(
          roomId,
          deps.jwtSecret,
          claims.appId,
          claims.userId
        );
        return { session };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to stop CDN stream";
        return reply.status(400).send({ error: message });
      }
    }
  );

  app.get<{ Params: { roomId: string } }>("/v1/rooms/:roomId/cdn-stream", async (req, reply) => {
    const claims = requireUser(req, reply, deps.jwtSecret);
    if (!claims) return;
    const session = getActiveCdnStream(req.params.roomId);
    return { active: session };
  });

  app.get<{ Params: { appId: string } }>(
    "/v1/admin/apps/:appId/cdn-streams",
    async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      return { sessions: listCdnStreams(req.params.appId) };
    }
  );
}
