import { readdirSync, readFileSync } from "fs";
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

  const dir = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    await db.query(sql);
  }
  return true;
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
