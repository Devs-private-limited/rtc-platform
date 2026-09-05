import type { FastifyInstance } from "fastify";
import type { TokenResponse } from "@rtc/protocol";
import { getDemoAppId, isDemoAppEnabled } from "../apps.js";
import { issueToken } from "../auth.js";
import { rateLimit } from "../rate-limit.js";

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
  app.post<{ Body: { userId?: string; roomId?: string } }>(
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

      const roomId = req.body?.roomId?.trim() || undefined;
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
