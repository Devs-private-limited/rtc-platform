import type { FastifyRequest, FastifyReply } from "fastify";
import type { RoomStore } from "./store/types.js";
import { requireUser } from "./user-auth.js";
import { scopedRooms } from "./tenant-scope.js";
import { callMediaRoomFor } from "./call-state.js";

export async function requireRoomUser(req: FastifyRequest, reply: FastifyReply, secret: string, rooms: RoomStore, roomId: string) {
  const claims = requireUser(req, reply, secret);
  if (!claims) return null;
  // A 1:1 call's media room counts as the room the call was made in, for its two participants only.
  const accessRoom = callMediaRoomFor(claims.appId, claims.userId, roomId) ?? roomId;
  if ((claims.roomId && claims.roomId !== accessRoom) || !(await scopedRooms(rooms, claims.appId).isMember(accessRoom, claims.userId))) {
    reply.status(403).send({ error: "Room access denied" });
    return null;
  }
  return claims;
}
