import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { getPool } from "./db.js";

import type { BillingPlan } from "./billing-plans.js";

export interface AppRecord {
  appId: string;
  name: string;
  active: boolean;
  plan: BillingPlan;
  createdAt: string;
}

function hashSecret(secret: string) {
  return bcrypt.hashSync(secret, 10);
}

function generateAppId() {
  return `app_${randomBytes(8).toString("hex")}`;
}

function generateAppSecret() {
  return `sec_${randomBytes(16).toString("hex")}`;
}

export async function createApp(name: string) {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const appId = generateAppId();
  const appSecret = generateAppSecret();
  const secretHash = hashSecret(appSecret);

  await db.query(
    `INSERT INTO apps (app_id, name, secret_hash) VALUES ($1, $2, $3)`,
    [appId, name, secretHash]
  );

  return { appId, appSecret, name };
}

export async function listApps(): Promise<AppRecord[]> {
  const db = getPool();
  if (!db) throw new Error("Database not configured");

  const result = await db.query(
    `SELECT app_id, name, active, plan, created_at FROM apps ORDER BY created_at DESC`
  );
  return result.rows.map((row) => ({
    appId: row.app_id,
    name: row.name,
    active: row.active,
    plan: (row.plan || "free") as BillingPlan,
    createdAt: row.created_at,
  }));
}

export async function getAppPlan(appId: string): Promise<BillingPlan> {
  const db = getPool();
  if (!db) {
    if (appId === (process.env.DEMO_APP_ID || "demo-app")) return "free";
    return "free";
  }
  const result = await db.query(`SELECT plan FROM apps WHERE app_id = $1`, [appId]);
  if (!result.rows[0]) return "free";
  return (result.rows[0].plan || "free") as BillingPlan;
}

export async function setAppPlan(appId: string, plan: BillingPlan) {
  const db = getPool();
  if (!db) throw new Error("Database not configured");
  await db.query(`UPDATE apps SET plan = $1 WHERE app_id = $2`, [plan, appId]);
}

export async function verifyAppCredentials(appId: string, appSecret: string) {
  const db = getPool();
  if (!db) return verifyEnvCredentials(appId, appSecret);

  const result = await db.query(
    `SELECT secret_hash, active FROM apps WHERE app_id = $1`,
    [appId]
  );
  if (!result.rowCount) return false;
  const row = result.rows[0];
  if (!row.active) return false;
  return bcrypt.compareSync(appSecret, row.secret_hash);
}

function verifyEnvCredentials(appId: string, appSecret: string) {
  const expectedAppId = process.env.DEMO_APP_ID || "demo-app";
  const expectedSecret = process.env.DEMO_APP_SECRET || "demo-secret";
  return appId === expectedAppId && appSecret === expectedSecret;
}

export async function seedDemoApp() {
  const db = getPool();
  if (!db) return;

  const appId = process.env.DEMO_APP_ID || "demo-app";
  const appSecret = process.env.DEMO_APP_SECRET || "demo-secret";

  const existing = await db.query(`SELECT 1 FROM apps WHERE app_id = $1`, [appId]);
  if (existing.rowCount) return;

  await db.query(`INSERT INTO apps (app_id, name, secret_hash) VALUES ($1, $2, $3)`, [
    appId,
    "Demo Application",
    hashSecret(appSecret),
  ]);
  console.log(`Seeded demo app: ${appId}`);
}
