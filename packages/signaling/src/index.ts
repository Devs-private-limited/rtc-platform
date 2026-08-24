import "dotenv/config";
import { randomUUID } from "crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { WebSocketServer, WebSocket } from "ws";
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
import { runMigrations } from "./db.js";
import { handleClientMessage } from "./handlers.js";
import { getIceConfig } from "./ice.js";
import { MessageRelay } from "./relay.js";
import { rateLimit } from "./rate-limit.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { MemoryPresenceStore, MemoryRoomStore } from "./store/memory.js";
import {
  createRedisClient,
  RedisPresenceStore,
  RedisRoomStore,
} from "./store/redis.js";
import type { PresenceStore, RoomStore } from "./store/types.js";

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const INSTANCE_ID = process.env.INSTANCE_ID || randomUUID();
const REDIS_URL = process.env.REDIS_URL;
const DATABASE_URL = process.env.DATABASE_URL;

if (DATABASE_URL) {
  await runMigrations();
  await seedDemoApp();
  console.log("PostgreSQL app registry enabled");
} else {
  console.log("No DATABASE_URL — using env demo credentials only");
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
await registerAdminRoutes(app);

let rooms: RoomStore = new MemoryRoomStore();
let presence: PresenceStore = new MemoryPresenceStore();
let redisPub: ReturnType<typeof createRedisClient> | null = null;
let redisSub: ReturnType<typeof createRedisClient> | null = null;

if (REDIS_URL) {
  redisPub = createRedisClient(REDIS_URL);
  redisSub = createRedisClient(REDIS_URL);
  rooms = new RedisRoomStore(redisPub);
  presence = new RedisPresenceStore(redisPub);
  console.log(`Redis enabled (${INSTANCE_ID})`);
} else {
  console.log("Running in single-node mode (set REDIS_URL for scale)");
}

app.get("/health", async () => ({
  ok: true,
  service: "rtc-signaling",
  instanceId: INSTANCE_ID,
  redis: Boolean(REDIS_URL),
  database: Boolean(DATABASE_URL),
}));

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

  const token = issueToken({ appId, userId, roomId }, JWT_SECRET);
  const response: TokenResponse = { token, expiresIn: 3600 };
  return response;
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
  INSTANCE_ID,
  sockets,
  presence,
  redisPub,
  redisSub,
  send
);
await relay.start();

wss.on("connection", (ws, req) => {
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    ws.close(4001, "Missing token");
    return;
  }

  let claims: TokenClaims;
  try {
    claims = verifyToken(token, JWT_SECRET);
  } catch {
    ws.close(4002, "Invalid token");
    return;
  }

  const { userId } = claims;
  sockets.set(userId, ws);
  void presence.setOnline(userId, INSTANCE_ID);

  send(ws, {
    type: "connected",
    payload: { userId, appId: claims.appId, instanceId: INSTANCE_ID },
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
      }
    })();
  });
});

await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`RTC signaling server on http://localhost:${PORT}`);
console.log(`WebSocket: ws://localhost:${PORT}/ws?token=...`);
