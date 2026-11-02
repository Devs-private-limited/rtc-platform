import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import bcrypt from 'bcryptjs';
import { PGlite } from '@electric-sql/pglite';
import { getPool, closeDb } from './db.js';
import { issueToken } from './auth.js';
import { registerAdminLogin, requireAdmin } from './routes/admin.js';

test('admin signs in with an allow-listed console account; other tokens are refused', async t => {
  const previous = { db: process.env.DATABASE_URL, emails: process.env.ADMIN_EMAILS, key: process.env.ADMIN_API_KEY, jwt: process.env.JWT_SECRET };
  process.env.DATABASE_URL = 'postgresql://unused/admin-login-tests';
  process.env.ADMIN_EMAILS = 'Owner@Example.test, second-admin@example.test';
  process.env.ADMIN_API_KEY = 'test-admin-key';
  process.env.JWT_SECRET = 'test-jwt';
  const pg = new PGlite(), app = Fastify();
  t.after(async () => {
    await app.close(); await closeDb(); await pg.close();
    for (const [k, v] of Object.entries({ DATABASE_URL: previous.db, ADMIN_EMAILS: previous.emails, ADMIN_API_KEY: previous.key, JWT_SECRET: previous.jwt })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  await pg.exec(`CREATE TABLE apps(app_id TEXT PRIMARY KEY,name TEXT,active BOOLEAN DEFAULT TRUE,portal_version INTEGER DEFAULT 0);
    CREATE TABLE customer_accounts(email TEXT,password_hash TEXT,name TEXT,company TEXT,app_id TEXT);
    INSERT INTO apps(app_id,name) VALUES ('app-o','Owner project'),('app-c','Customer project');`);
  const hash = await bcrypt.hash('right-password', 4);
  await pg.query(`INSERT INTO customer_accounts VALUES ('owner@example.test',$1,'Owner',NULL,'app-o'),('customer@example.test',$1,'Customer',NULL,'app-c')`, [hash]);
  t.mock.method(getPool()!, 'query', async (sql: string, args?: unknown[]) => { const r = await pg.query(sql, args); return { ...r, rowCount: r.rows.length }; });
  await registerAdminLogin(app);
  app.get('/protected', async (req, reply) => (requireAdmin(req, reply) ? { ok: true } : undefined));

  const login = (email: string, password: string) => app.inject({ method: 'POST', url: '/v1/admin/login', payload: { email, password } });

  const ok = await login('OWNER@example.test', 'right-password');
  assert.equal(ok.statusCode, 200, ok.body);
  const session = ok.json().token as string;
  assert.equal((await app.inject({ url: '/protected', headers: { authorization: `Bearer ${session}` } })).statusCode, 200);

  // Wrong password and non-admin accounts get the same answer.
  const wrong = await login('owner@example.test', 'wrong');
  const notAdmin = await login('customer@example.test', 'right-password');
  assert.equal(wrong.statusCode, 401); assert.equal(notAdmin.statusCode, 401);
  assert.equal(wrong.json().error, notAdmin.json().error);

  // Customer console tokens and call tokens can never act as admin.
  const portalToken = issueToken({ appId: 'app-o', userId: '__portal__' }, 'test-jwt');
  assert.equal((await app.inject({ url: '/protected', headers: { authorization: `Bearer ${portalToken}` } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/protected' })).statusCode, 401);

  // Removing the email from ADMIN_EMAILS ends existing sessions.
  process.env.ADMIN_EMAILS = 'second-admin@example.test';
  assert.equal((await app.inject({ url: '/protected', headers: { authorization: `Bearer ${session}` } })).statusCode, 401);

  // The old API key still works (scripts).
  assert.equal((await app.inject({ url: '/protected', headers: { 'x-admin-key': 'test-admin-key' } })).statusCode, 200);
});
