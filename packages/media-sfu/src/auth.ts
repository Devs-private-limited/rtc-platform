import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { TokenClaims } from "@rtc/protocol";

export interface AuthenticatedRequest extends FastifyRequest {
  rtcClaims: TokenClaims;
}

function peerIdFromRequest(req: FastifyRequest): string | undefined {
  const body = req.body as { peerId?: string } | undefined;
  const query = req.query as { peerId?: string } | undefined;
  return body?.peerId?.trim() || query?.peerId?.trim();
}

export function createAuthHook(jwtSecret: string) {
  return async function authHook(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing bearer token" });
    }

    try {
      const claims = jwt.verify(header.slice(7), jwtSecret) as TokenClaims;
      const peerId = peerIdFromRequest(req);
      if (peerId && peerId !== claims.userId) {
        return reply.status(403).send({ error: "peerId does not match token subject" });
      }
      (req as AuthenticatedRequest).rtcClaims = claims;
    } catch {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }
  };
}
