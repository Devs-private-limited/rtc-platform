import type { FastifyReply, FastifyRequest } from "fastify";
import type { TokenClaims } from "@rtc/protocol";
import { verifyToken } from "./auth.js";

/**
 * Authenticates an end user from the same JWT the WebSocket accepts, for REST
 * endpoints an app's own users call directly (rather than the admin key, which
 * belongs to the app owner and must never ship in client code).
 */
export function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
  jwtSecret: string
): TokenClaims | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    reply.status(401).send({ error: "Missing bearer token" });
    return null;
  }

  try {
    return verifyToken(header.slice(7), jwtSecret);
  } catch {
    reply.status(401).send({ error: "Invalid or expired token" });
    return null;
  }
}
