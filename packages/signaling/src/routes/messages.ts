import type { FastifyInstance } from "fastify";
import { listMessages } from "../messages.js";
import type { RoomStore } from "../store/types.js";
import { requireUser } from "../user-auth.js";

interface MessageRouteDeps {
  jwtSecret: string;
  rooms: RoomStore;
}

export async function registerMessageRoutes(app: FastifyInstance, deps: MessageRouteDeps) {
  app.get<{ Params: { roomId: string }; Querystring: { before?: string; limit?: string } }>(
    "/v1/rooms/:roomId/messages",
    async (req, reply) => {
      const claims = requireUser(req, reply, deps.jwtSecret);
      if (!claims) return;

      const { roomId } = req.params;

      // A room-scoped token must not read a different room's history.
      if (claims.roomId && claims.roomId !== roomId) {
        return reply.status(403).send({ error: "Token is not valid for this room" });
      }

      // History is readable by current room members only. Call this after the
      // SDK's roomJoined event, which fires once membership is recorded.
      if (!(await deps.rooms.isMember(roomId, claims.userId))) {
        return reply.status(403).send({ error: "Join the room first" });
      }

      try {
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        return await listMessages(claims.appId, roomId, { before: req.query.before, limit });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load messages";
        return reply.status(503).send({ error: message });
      }
    }
  );
}
