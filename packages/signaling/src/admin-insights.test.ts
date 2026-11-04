import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { getPool, closeDb } from './db.js';
import { getAttention } from './admin-insights.js';
import { registerInsightRoutes } from './routes/insights.js';
import { issueToken } from './auth.js';

test('needs-attention lists and the weekly summary email', async t => {
  const saved = { ...process.env };
  process.env.DATABASE_URL = 'postgresql://unused/insights-tests'; process.env.ADMIN_API_KEY = 'k';
  const pg = new PGlite(), app = Fastify();
  t.after(async () => { await app.close(); await closeDb(); await pg.close(); process.env = saved; });
  await pg.exec(`CREATE TABLE apps(app_id VARCHAR(64) PRIMARY KEY,name TEXT,plan TEXT DEFAULT 'free',active BOOLEAN DEFAULT TRUE,portal_version INTEGER DEFAULT 0,billing_period VARCHAR(16),subscription_status VARCHAR(32),subscription_renews_at TIMESTAMPTZ,subscription_cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,billing_event_at TIMESTAMPTZ);`);
  const m = (f: string) => readFile(new URL(`../migrations/${f}.sql`, import.meta.url), 'utf8');
  for (const f of ['012_customer_accounts', '014_account_security', '002_events_and_webhooks', '003_call_sessions', '008_media_sessions', '009_messages', '018_call_session_type', '020_billing_payments', '022_admin_team_and_bonus_minutes', '023_owner_digest']) {
    if (f === '014_account_security') { await pg.exec('ALTER TABLE customer_accounts ADD COLUMN email_verified_at TIMESTAMPTZ'); continue; }
    await pg.exec(await m(f));
  }
  const ids = ['a', 'b', 'c', 'd', 'e'].map((x) => `${x.repeat(8)}-1111-4111-8111-111111111111`);
  await pg.exec(`INSERT INTO apps(app_id,name,plan,subscription_status,subscription_cancel_at_period_end,subscription_renews_at,billing_event_at) VALUES
    ('heavy','h','free',NULL,false,NULL,NULL),('quit','q','starter','active',true,NOW()+interval '9 days',NOW()),
    ('ghost','g','free',NULL,false,NULL,NULL),('fresh','f','free',NULL,false,NULL,NULL),('payfail','p','free',NULL,false,NULL,NULL);
    INSERT INTO customer_accounts(id,email,password_hash,app_id,created_at,email_verified_at) VALUES
    ('${ids[0]}','heavy@x.test','h','heavy',NOW()-interval '20 days',NOW()),('${ids[1]}','quit@x.test','h','quit',NOW()-interval '20 days',NOW()),
    ('${ids[2]}','ghost@x.test','h','ghost',NOW()-interval '10 days',NULL),('${ids[3]}','fresh@x.test','h','fresh',NOW()-interval '1 day',NULL),
    ('${ids[4]}','payfail@x.test','h','payfail',NOW()-interval '20 days',NOW());
    -- heavy: 1:1 call of 900 min started 16h ago = 1800 participant minutes (90% of Free 2000, and a spike)
    INSERT INTO call_sessions(app_id,call_id,room_id,caller_user_id,callee_user_id,started_at,ended_at) VALUES ('heavy','c1','r','u1','u2',NOW()-interval '16 hours',NOW()-interval '1 hour');
    INSERT INTO events(app_id,type,user_id) VALUES ('heavy','call.connected','u1'),('quit','message.sent','u'),('payfail','message.sent','u'),('ghost','user.joined','__portal__');
    INSERT INTO billing_payments(payment_id,app_id,status,amount_minor,refunded_minor,currency,paid_at) VALUES ('p1','payfail','failed',900,0,'USD',NOW()-interval '2 days'),('p2','quit','succeeded',900,0,'USD',NOW()-interval '3 days');`);
  const q = async (sql: string, args?: unknown[]) => { const r = await pg.query(sql, args); return { ...r, rowCount: r.rows.length || r.affectedRows }; };
  t.mock.method(getPool()!, 'query', q);

  const a = await getAttention();
  assert.deepEqual(a.nearLimit.map((i) => i.email), ['heavy@x.test']); assert.match(a.nearLimit[0].why, /Near the minutes limit: 1,800 of 2,000/);
  assert.deepEqual(a.spikes.map((i) => i.email), ['heavy@x.test']);
  assert.deepEqual(a.paymentProblems.map((i) => i.email), ['payfail@x.test']); assert.match(a.paymentProblems[0].why, /failed: \$9\.00/);
  assert.deepEqual(a.cancellations.map((i) => i.email), ['quit@x.test']); assert.match(a.cancellations[0].why, /Cancels at the end/);
  assert.deepEqual(a.notVerified.map((i) => i.email), ['ghost@x.test'], 'fresh sign-ups (under 3 days) are not nagged yet');
  assert.deepEqual(a.neverUsed.map((i) => i.email), ['ghost@x.test'], 'console visits do not count as using the app');

  // Extra minutes lift the limit, so the customer drops off the near-limit list.
  await pg.exec(`INSERT INTO app_bonus_minutes(app_id,month,minutes) VALUES ('heavy',to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM'),5000)`);
  assert.equal((await getAttention()).nearLimit.length, 0);

  await registerInsightRoutes(app);
  const admin = { 'x-admin-key': 'k' };
  assert.equal((await app.inject({ url: '/v1/admin/attention', headers: { authorization: `Bearer ${issueToken({ appId: 'heavy', userId: '__portal__' }, 'x')}` } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/admin/attention', headers: admin })).json().cancellations.length, 1);

  Object.assign(process.env, { RESEND_API_KEY: 'r', EMAIL_FROM: 'x@x.test', SIGNUP_ALERT_TO: 'boss@x.test' });
  const sent: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_u: string, init: any) => { sent.push(JSON.parse(init.body)); return new Response('{}'); });
  const res = await app.inject({ method: 'POST', url: '/v1/admin/weekly-summary/send', headers: admin });
  assert.equal(res.json().result, 'sent', res.body);
  assert.deepEqual(sent[0].to, ['boss@x.test']);
  assert.match(sent[0].subject, /weekly summary: 1 new/);
  assert.match(sent[0].text, /Revenue \(after refunds\): \$9\.00/);
  assert.match(sent[0].text, /fresh@x\.test/); assert.match(sent[0].text, /Cancelled or cancelling:\n- quit@x\.test/);
});
