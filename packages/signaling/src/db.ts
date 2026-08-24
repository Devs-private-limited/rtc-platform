import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) return null;
    pool = new Pool({ connectionString: url });
  }
  return pool;
}

export async function runMigrations() {
  const db = getPool();
  if (!db) return false;

  const dir = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(join(dir, "../migrations/001_apps.sql"), "utf8");
  await db.query(sql);
  return true;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
