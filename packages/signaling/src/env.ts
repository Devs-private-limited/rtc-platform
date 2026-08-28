import { randomUUID } from "crypto";
import path from "path";

const DEV_JWT_SECRET = "dev-secret-change-in-production";
const DEV_ADMIN_KEY = "dev-admin-key";

export interface SignalingEnv {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  jwtSecret: string;
  adminApiKey: string;
  instanceId: string;
  redisUrl: string | null;
  databaseUrl: string | null;
  sfuUrl: string | null;
  openaiApiKey: string | null;
  recordingsDir: string;
}

export function loadSignalingEnv(): SignalingEnv {
  const nodeEnv = process.env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";

  const jwtSecret = process.env.JWT_SECRET || DEV_JWT_SECRET;
  const adminApiKey = process.env.ADMIN_API_KEY || DEV_ADMIN_KEY;

  if (isProduction) {
    if (!process.env.JWT_SECRET || jwtSecret === DEV_JWT_SECRET) {
      throw new Error("JWT_SECRET must be set to a strong value in production");
    }
    if (!process.env.ADMIN_API_KEY || adminApiKey === DEV_ADMIN_KEY) {
      throw new Error("ADMIN_API_KEY must be set in production");
    }
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required in production");
    }
  }

  return {
    nodeEnv,
    isProduction,
    port: Number(process.env.PORT || 4000),
    jwtSecret,
    adminApiKey,
    instanceId: process.env.INSTANCE_ID || randomUUID(),
    redisUrl: process.env.REDIS_URL || null,
    databaseUrl: process.env.DATABASE_URL || null,
    sfuUrl: process.env.SFU_URL || null,
    openaiApiKey: process.env.OPENAI_API_KEY || null,
    recordingsDir: process.env.RECORDINGS_DIR || path.join(process.cwd(), "data", "recordings"),
  };
}
