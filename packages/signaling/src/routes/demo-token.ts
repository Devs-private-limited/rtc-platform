import type { FastifyInstance } from "fastify";
import type { TokenResponse } from "@rtc/protocol";
import { getDemoAppId, isDemoAppEnabled } from "../apps.js";
import { issueToken } from "../auth.js";
import { rateLimit } from "../rate-limit.js";
import { classifyDemoRoom, DEFAULT_DEMO_GOOGLE_CLIENT_ID, verifyGoogleIdToken } from "../demo-rooms.js";

interface DemoTokenDeps {
  jwtSecret: string;
}

const DEMO_TOKEN_LIMIT = 30;
const DEMO_TOKEN_WINDOW_MS = 60 * 60 * 1000;

export async function registerDemoTokenRoutes(app: FastifyInstance, deps: DemoTokenDeps) {
  /**
   * Issues a token for the public demo without the caller presenting an app
   * secret.
   *
   * The demo page previously shipped `appSecret` in its JavaScript, which meant
   * publishing a working credential to anyone who opened devtools. The secret
   * now stays on the server: this route mints a token only for the configured
   * demo app, and only while that app is enabled — so the demo can be turned
   * off entirely by not configuring one.
   */
  app.post<{ Body: { userId?: string; roomId?: string; googleIdToken?: string } }>(
    "/v1/demo/token",
    async (req, reply) => {
      if (!rateLimit(`demo-token:${req.ip}`, DEMO_TOKEN_LIMIT, DEMO_TOKEN_WINDOW_MS)) {
        return reply.status(429).send({ error: "Too many token requests. Try again later." });
      }

      if (!(await isDemoAppEnabled())) {
        return reply.status(404).send({
          error:
            "Demo is not enabled on this deployment. Set DEMO_APP_SECRET to a strong value to enable it.",
        });
      }

      const userId = req.body?.userId?.trim();
      if (!userId || userId.length > 128) {
        return reply.status(400).send({ error: "userId is required" });
      }

      // Every demo token is scoped to one room, and private rooms only go to their two members.
      const roomId = req.body?.roomId?.trim() || "";
      const room = classifyDemoRoom(roomId);
      if (room.kind === "invalid") {
        return reply.status(400).send({ error: "This demo app version is out of date. Please install the latest demo app." });
      }
      if (room.kind === "pair") {
        if (!room.members.includes(userId)) {
          return reply.status(403).send({ error: "This private chat belongs to two other people." });
        }
        const verified = await verifyGoogleIdToken(req.body?.googleIdToken || "", process.env.DEMO_GOOGLE_CLIENT_ID || DEFAULT_DEMO_GOOGLE_CLIENT_ID);
        if (verified !== userId) {
          return reply.status(401).send({ error: "Google sign-in could not be confirmed. Sign out and sign in again." });
        }
      }
      const token = issueToken({ appId: getDemoAppId(), userId, roomId }, deps.jwtSecret);
      const response: TokenResponse = { token, expiresIn: 3600 };
      return response;
    }
  );

  /** Lets the demo page tell the user why it is unavailable, before they try. */
  app.get("/v1/demo/status", async () => ({
    enabled: await isDemoAppEnabled(),
    appId: getDemoAppId(),
  }));
}
