import jwt from "jsonwebtoken";
import type { TokenClaims } from "@rtc/protocol";

export function issueToken(
  input: { appId: string; userId: string; roomId?: string; role?: string },
  secret: string
) {
  const payload: Omit<TokenClaims, "iat" | "exp"> = {
    appId: input.appId,
    userId: input.userId,
    roomId: input.roomId,
    role: input.role as TokenClaims["role"],
  };
  return jwt.sign(payload, secret, { expiresIn: "1h" });
}

export function verifyToken(token: string, secret: string): TokenClaims {
  return jwt.verify(token, secret) as TokenClaims;
}
