import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import bcrypt from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { getPool, closeDb } from './db.js';
import { registerAdminLogin, requireAdmin } from './routes/admin.js';

test('owner manages the admin team; admins can change data, viewers only read; removal is immediate', async t => {
  const previous = { db: process.env.DATABASE_URL, emails: process.env.ADMIN_EMAILS, jwt: process.env.JWT_SECRET };
  process.env.DATABASE_URL = 'postgresql://unused/admin-team-tests';
  process.env.ADMIN_EMAILS = 'owner@example.test';
  process.env.JWT_SECRET = 'test-jwt';
  const pg = new PGlite(), app = Fastify();
  t.after(async () => {
    await app.close(); await closeDb(); await pg.close();
    for (const [k, v] of Object.entries({ DATABASE_URL: previous.db, ADMIN_EMAILS: previous.emails, JWT_SECRET: previous.jwt })) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
  await pg.exec(`CREATE TABLE apps(app_id TEXT PRIMARY KEY,name TEXT,active BOOLEAN DEFAULT TRUE,portal_version INTEGER DEFAULT 0);
    CREATE TABLE customer_accounts(email TEXT,password_hash TEXT,name TEXT,company TEXT,app_id TEXT);
    INSERT INTO apps(app_id,name) VALUES ('a1','o'),('a2','m'),('a3','v'),('a4','x');`);
  await pg.exec(await readFile(new URL('../migrations/022_admin_team_and_bonus_minutes.sql', import.meta.url), 'utf8'));
  const hash = await bcrypt.hash('pw-123456', 4);
  await pg.query(`INSERT INTO customer_accounts VALUES ('owner@example.test',$1,'O',NULL,'a1'),('mate@example.test',$1,'M',NULL,'a2'),('view@example.test',$1,'V',NULL,'a3'),('stranger@example.test',$1,'S',NULL,'a4')`, [hash]);
  t.mock.method(getPool()!, 'query', async (sql: string, args?: unknown[]) => { const r = await pg.query(sql, args); return { ...r, rowCount: r.rows.length || r.affectedRows }; });
  await registerAdminLogin(app);
  app.post('/change', async (req, reply) => (requireAdmin(req, reply) ? { ok: true } : undefined));

  const login = async (email: string) => {
    const r = await app.inject({ method: 'POST', url: '/v1/admin/login', payload: { email, password: 'pw-123456' } });
    return r.statusCode === 200 ? { authorization: `Bearer ${r.json().token}` } : null;
  };
  const owner = (await login('owner@example.test'))!;
  assert.equal((await app.inject({ url: '/v1/admin/me', headers: owner })).json().role, 'owner');
  assert.equal(await login('mate@example.test'), null, 'not on the team yet');

  const add = (headers: any, email: string, role: string) => app.inject({ method: 'POST', url: '/v1/admin/team', headers, payload: { email, role } });
  assert.equal((await add(owner, 'nobody@example.test', 'admin')).statusCode, 400, 'needs a console account');
  assert.equal((await add(owner, 'owner@example.test', 'admin')).statusCode, 400);
  assert.equal((await add(owner, 'mate@example.test', 'boss')).statusCode, 400);
  assert.equal((await add(owner, 'Mate@Example.test', 'admin')).statusCode, 200);
  assert.equal((await add(owner, 'view@example.test', 'viewer')).statusCode, 200);

  const mate = (await login('mate@example.test'))!, viewer = (await login('view@example.test'))!;
  assert.equal((await app.inject({ method: 'POST', url: '/change', headers: mate })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/change', headers: viewer })).statusCode, 403, 'viewer is read-only');
  assert.equal((await app.inject({ url: '/v1/admin/team', headers: viewer })).statusCode, 200);
  assert.equal((await add(mate, 'stranger@example.test', 'admin')).statusCode, 403, 'only the owner manages the team');

  const team = (await app.inject({ url: '/v1/admin/team', headers: owner })).json();
  assert.deepEqual(team.owners, [{ email: 'owner@example.test', role: 'owner', hasConsoleAccount: true }]);
  assert.deepEqual(team.members.map((m: any) => [m.email, m.role, m.added_by]), [['mate@example.test', 'admin', 'owner@example.test'], ['view@example.test', 'viewer', 'owner@example.test']]);

  assert.equal((await app.inject({ method: 'DELETE', url: '/v1/admin/team/owner%40example.test', headers: owner })).statusCode, 404, 'owners are not removable here');
  assert.equal((await app.inject({ method: 'DELETE', url: '/v1/admin/team/mate%40example.test', headers: owner })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/change', headers: mate })).statusCode, 401, 'old session stops working at once');

  const log = (await app.inject({ url: '/v1/admin/audit', headers: owner })).json().entries.map((e: any) => e.action);
  assert.deepEqual(log, ['team.remove', 'team.set', 'team.set']);
});
