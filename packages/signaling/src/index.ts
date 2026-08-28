import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import Fastify from "fastify";
import cors from "@fastify/cors";
import type {
  ClientMessage,
  ServerMessage,
  TokenClaims,
  TokenRequest,
  TokenResponse,
} from "@rtc/protocol";
import { verifyToken, issueToken } from "./auth.js";
import { verifyAppCredentials, seedDemoApp } from "./apps.js";
import { getPlatformConfig } from "./config.js";
import { closeDb, getPool, runMigrations } from "./db.js";
import { loadSignalingEnv } from "./env.js";
import { handleClientMessage } from "./handlers.js";
import { getIceConfig } from "./ice.js";
import { MessageRelay } from "./relay.js";
import { rateLimit } from "./rate-limit.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerRecordingRoutes } from "./routes/recordings.js";
import { registerRecordingUploadRoutes } from "./routes/recording-upload.js";
import { dispatchEvent } from "./webhooks.js";
import { setRecordingsDir, ensureRecordingsDir } from "./recordings.js";
import { MemoryPresenceStore, MemoryRoomStore } from "./store/memory.js";
import {
  createRedisClient,
  RedisPresenceStore,
  RedisRoomStore,
} from "./store/redis.js";
import type { PresenceStore, RoomStore } from "./store/types.js";

const env = loadSignalingEnv();
setRecordingsDir(env.recordingsDir);
await ensureRecordingsDir();

if (env.databaseUrl) {
  await runMigrations();
  await seedDemoApp();
  console.log("PostgreSQL app registry enabled");
} else {
  console.log("No DATABASE_URL — using env demo credentials only");
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await registerAdminRoutes(app);
await registerWebhookRoutes(app);
await registerEventRoutes(app);
await registerRecordingRoutes(app);

let rooms: RoomStore = new MemoryRoomStore();
let presence: PresenceStore = new MemoryPresenceStore();
let redisPub = env.redisUrl ? createRedisClient(env.redisUrl) : null;
let redisSub = env.redisUrl ? createRedisClient(env.redisUrl) : null;

if (redisPub && redisSub) {
  rooms = new RedisRoomStore(redisPub);
  presence = new RedisPresenceStore(redisPub);
  console.log(`Redis enabled (${env.instanceId})`);
} else {
  console.log("Running in single-node mode (set REDIS_URL for scale)");
}

async function checkRedis() {
  if (!redisPub) return true;
  try {
    const pong = await redisPub.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

async function checkDatabase() {
  const pool = getPool();
  if (!pool) return true;
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

app.get("/health", async () => ({
  ok: true,
  service: "rtc-signaling",
  instanceId: env.instanceId,
  uptime: process.uptime(),
}));

app.get("/ready", async (_req, reply) => {
  const checks = {
    redis: await checkRedis(),
    database: await checkDatabase(),
  };
  const ready = Object.values(checks).every(Boolean);
  const payload = {
    ok: ready,
    service: "rtc-signaling",
    instanceId: env.instanceId,
    ready,
    checks,
  };
  if (!ready) return reply.status(503).send(payload);
  return payload;
});

app.get("/v1/config", async () => getPlatformConfig());
app.get("/v1/ice", async () => getIceConfig());

app.post<{ Body: TokenRequest }>("/v1/token", async (req, reply) => {
  const ip = req.ip;
  if (!rateLimit(`token:${ip}`, 30, 60_000)) {
    return reply.status(429).send({ error: "Too many token requests" });
  }

  const { appId, appSecret, userId, roomId } = req.body || {};
  if (!appId || !appSecret || !userId) {
    return reply.status(400).send({ error: "appId, appSecret, and userId are required" });
  }

  const valid = await verifyAppCredentials(appId, appSecret);
  if (!valid) {
    return reply.status(401).send({ error: "Invalid app credentials" });
  }

  const token = issueToken({ appId, userId, roomId }, env.jwtSecret);
  const response: TokenResponse = { token, expiresIn: 3600 };
  return response;
});

const userNotifier = {
  sendToUser: async (_userId: string, _message: ServerMessage) => false,
};

await registerRecordingUploadRoutes(app, {
  env,
  dispatch: dispatchEvent,
  sendToUser: (userId, message) => userNotifier.sendToUser(userId, message),
});

await app.ready();
const wss = new WebSocketServer({ server: app.server, path: "/ws" });

const sockets = new Map<string, WebSocket>();

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

const relay = new MessageRelay(
  env.instanceId,
  sockets,
  presence,
  redisPub,
  redisSub,
  send
);
await relay.start();

userNotifier.sendToUser = (userId, message) => relay.sendToUser(userId, message);

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    ws.close(4001, "Missing token");
    return;
  }

  let claims: TokenClaims;
  try {
    claims = verifyToken(token, env.jwtSecret);
  } catch {
    ws.close(4002, "Invalid token");
    return;
  }

  const { userId } = claims;
  sockets.set(userId, ws);
  void presence.setOnline(userId, env.instanceId);

  send(ws, {
    type: "connected",
    payload: { userId, appId: claims.appId, instanceId: env.instanceId },
  });

  ws.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientMessage;
      void handleClientMessage({
        message,
        claims,
        ws,
        rooms,
        send,
        sendToUser: (targetUserId, serverMessage) =>
          relay.sendToUser(targetUserId, serverMessage),
        dispatch: (type, payload) => void dispatchEvent(claims.appId, type, payload),
      });
    } catch {
      send(ws, { type: "error", payload: { message: "Invalid message format" } });
    }
  });

  ws.on("close", () => {
    sockets.delete(userId);
    void (async () => {
      await presence.setOffline(userId);
      const leftRooms = await rooms.leaveAll(userId);
      for (const roomId of leftRooms) {
        const members = await rooms.getMembers(roomId);
        for (const memberId of members) {
          await relay.sendToUser(memberId, {
            type: "user_left",
            payload: { roomId, userId },
          });
        }
        void dispatchEvent(claims.appId, "user.left", { roomId, userId });
      }
    })();
  });
});

await app.listen({ port: env.port, host: "0.0.0.0" });
console.log(`RTC signaling server on http://localhost:${env.port}`);
console.log(`WebSocket: ws://localhost:${env.port}/ws?token=...`);

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${signal})...`);

  for (const ws of sockets.values()) {
    ws.close(1001, "Server shutting down");
  }
  sockets.clear();

  await new Promise<void>((resolve) => wss.close(() => resolve()));
  await relay.stop();
  if (redisPub) await redisPub.quit();
  if (redisSub) await redisSub.quit();
  await closeDb();
  await app.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
