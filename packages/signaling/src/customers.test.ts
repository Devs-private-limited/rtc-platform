import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { getPool,closeDb } from './db.js';
import { issueToken } from './auth.js';
import { registerCustomerRoutes } from './routes/customers.js';
import { BILLING_PLANS } from './billing-plans.js';

test('admin customer reporting and customer-owned business profiles',async t=>{
  const previous={db:process.env.DATABASE_URL,admin:process.env.ADMIN_API_KEY};
  process.env.DATABASE_URL='postgresql://unused/customer-tests';process.env.ADMIN_API_KEY='test-admin';
  const pg=new PGlite(),app=Fastify();
  t.after(async()=>{await app.close();await closeDb();await pg.close();if(previous.db===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous.db;if(previous.admin===undefined)delete process.env.ADMIN_API_KEY;else process.env.ADMIN_API_KEY=previous.admin;});
  await pg.exec(`CREATE TABLE apps(app_id VARCHAR(64) PRIMARY KEY,name TEXT,plan TEXT,active BOOLEAN DEFAULT TRUE,portal_version INTEGER DEFAULT 0,billing_period VARCHAR(16),subscription_status VARCHAR(32),subscription_renews_at TIMESTAMPTZ,subscription_cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,dodo_subscription_id VARCHAR(64));
    INSERT INTO apps(app_id,name,plan) VALUES ('app-a','First project','pro'),('app-b','Second project','free');`);
  await pg.exec(await readFile(new URL('../migrations/012_customer_accounts.sql',import.meta.url),'utf8'));
  await pg.exec('ALTER TABLE customer_accounts ADD COLUMN email_verified_at TIMESTAMPTZ');
  const migration=await readFile(new URL('../migrations/017_customer_reporting.sql',import.meta.url),'utf8');await pg.exec(migration);await pg.exec(migration);
  await pg.exec(await readFile(new URL('../migrations/020_billing_payments.sql',import.meta.url),'utf8'));
  for(const m of ['002_events_and_webhooks','003_call_sessions','008_media_sessions','004_recordings','005_recording_intelligence','006_call_quality','009_messages','010_call_session_end_reason','018_call_session_type','021_signup_source','022_admin_team_and_bonus_minutes'])await pg.exec(await readFile(new URL(`../migrations/${m}.sql`,import.meta.url),'utf8'));
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
  await pg.query(`INSERT INTO customer_accounts(id,email,password_hash,name,company,app_id) VALUES ($1,'first@example.test','SENSITIVE-HASH','First','Original business','app-a'),($2,'second@example.test','OTHER-HASH','Second',NULL,'app-b')`,[a,b]);
  t.mock.method(getPool()!,'query',async(sql:string,args?:unknown[])=>{const result=await pg.query(sql,args);return {...result,rowCount:result.rows.length || result.affectedRows};});
  const q=async(sql:string,args?:unknown[])=>{const result=await pg.query(sql,args);return {...result,rowCount:result.rows.length || result.affectedRows};};
  t.mock.method(getPool()!,'connect',async()=>({query:q,release(){}}));
  await app.register(async scope=>registerCustomerRoutes(scope,'test'));
  const admin={'x-admin-key':'test-admin'};
  const portal=(appId='app-a')=>({authorization:`Bearer ${issueToken({appId,userId:'__portal__'},'test')}`});
  await t.test('customer and anonymous tokens cannot see the admin directory or payment records',async()=>{
    for(const url of ['/v1/admin/customers',`/v1/admin/customers/${a}`]){
      assert.equal((await app.inject({url})).statusCode,401);assert.equal((await app.inject({url,headers:portal()})).statusCode,401);
    }
    const res=await app.inject({url:'/v1/admin/customers',headers:admin});assert.equal(res.statusCode,200);assert.equal(res.headers['cache-control'],'no-store');
    assert.equal(res.json().summary.registered_customers,2);assert.equal(res.json().summary.paying_customers,0);assert.equal(res.json().paymentIntegration,'dodo');assert.ok(!res.body.includes('HASH'));
  });
  await t.test('profiles can only update the signed-in customer and cannot create payments',async()=>{
    assert.equal((await app.inject({url:'/v1/portal/business-profile',headers:portal()})).json().profile.business_name,'Original business');
    const payload={business_type:'individual',business_name:'My studio <script>',phone:'+91 12345',website:'https://example.test',address:'Office address',country:'India',account_id:b,amount_minor:99999,verified_at:new Date().toISOString()};
    const saved=await app.inject({url:'/v1/portal/business-profile',method:'PUT',headers:portal(),payload});assert.equal(saved.statusCode,200,saved.body);
    assert.equal((await app.inject({url:'/v1/portal/business-profile',headers:portal('app-b')})).json().profile.business_name,'');
    assert.equal((await pg.query('SELECT * FROM customer_payments')).rows.length,0);
    const detail=await app.inject({url:`/v1/admin/customers/${a}`,headers:admin});assert.equal(detail.json().profile.phone,'+91 12345');assert.ok(!detail.body.includes('SENSITIVE-HASH'));
    assert.equal((await app.inject({url:'/v1/portal/business-profile',method:'PUT',headers:portal(),payload:{...payload,website:'javascript:alert(1)'}})).statusCode,400);
    await pg.exec("UPDATE apps SET portal_version=1 WHERE app_id='app-a'");assert.equal((await app.inject({url:'/v1/portal/business-profile',headers:portal()})).statusCode,401);await pg.exec("UPDATE apps SET portal_version=0 WHERE app_id='app-a'");
  });
  await t.test('totals count only succeeded Dodo payments, per currency, and subtract refunds',async()=>{
    // Test fixture insertion represents the Dodo webhook (trusted), never a client request.
    await pg.query(`INSERT INTO billing_payments(payment_id,app_id,subscription_id,status,amount_minor,refunded_minor,currency,description,paid_at)
      VALUES ('pay_1','app-a','sub_1','succeeded',2900,0,'USD','Pro monthly',NOW()-INTERVAL '1 day'),
      ('pay_2','app-a','sub_1','succeeded',29000,500,'USD','Pro yearly',NOW()),
      ('pay_3','app-b',NULL,'failed',900,0,'USD','Starter monthly',NOW()),
      ('pay_4','app-b',NULL,'processing',900,0,'USD','Starter monthly',NOW())`);
    await pg.exec("UPDATE apps SET plan='pro',subscription_status='active',billing_period='yearly' WHERE app_id='app-a'");
    const res=await app.inject({url:'/v1/admin/customers',headers:admin});const s=res.json().summary;
    assert.equal(s.paying_customers,1);assert.equal(s.verified_payments,2);assert.equal(s.active_subscriptions,1);
    assert.deepEqual(s.totals,[{currency:'USD',gross_minor:'31900',refunds_minor:'500',net_minor:'31400'}]);
    const paid=await app.inject({url:'/v1/admin/customers?paid=paid',headers:admin});assert.equal(paid.json().total,1);assert.equal(paid.json().customers[0].id,a);
    assert.equal(paid.json().customers[0].subscription_status,'active');assert.equal(paid.json().customers[0].currency,'USD');
    const unpaid=await app.inject({url:'/v1/admin/customers?paid=unpaid',headers:admin});assert.equal(unpaid.json().customers[0].id,b);
    const search=await app.inject({url:'/v1/admin/customers?q=studio',headers:admin});assert.equal(search.json().total,1);
    const detail=await app.inject({url:`/v1/admin/customers/${a}`,headers:admin});assert.equal(detail.json().payments.length,2);assert.equal(detail.json().payments[0].payment_id,'pay_2');assert.equal(detail.json().account.billing_period,'yearly');
    const foreign=await app.inject({url:`/v1/admin/customers/${b}`,headers:admin});assert.ok(foreign.json().payments.every((p:any)=>p.payment_id!=='pay_1'&&p.payment_id!=='pay_2'));
  });
  await t.test('pagination and invalid requests do not expose records or SQL errors',async()=>{
    const page=await app.inject({url:'/v1/admin/customers?page=2',headers:admin});assert.equal(page.json().customers.length,0);assert.equal(page.json().total,2);
    assert.equal((await app.inject({url:'/v1/admin/customers?page=-1',headers:admin})).statusCode,400);
    assert.equal((await app.inject({url:'/v1/admin/customers/------------------------------------',headers:admin})).statusCode,400);
    assert.equal((await app.inject({url:'/v1/admin/customers?q=%27%20OR%201%3D1',headers:admin})).json().total,0);
    assert.equal((await app.inject({url:`/v1/admin/customers/${a}`,method:'POST',headers:admin,payload:{status:'paid'}})).statusCode,404);
  });
  await t.test('usage: participant minutes (1:1 x2, group per person), messages, sort, plan filter and overview',async()=>{
    // 10-minute 1:1 call = 20 participant minutes; 3 people x 5 minutes in a group room = 15; plus a demo app that is not a customer.
    await pg.exec(`INSERT INTO call_sessions(app_id,call_id,room_id,caller_user_id,callee_user_id,call_type,started_at,ended_at) VALUES
        ('app-b','c1','r','u1','u2','voice',NOW()-interval '20 minutes',NOW()-interval '10 minutes'),
        ('demo','d1','r','x','y','voice',NOW()-interval '6 minutes',NOW()-interval '1 minute');
      INSERT INTO media_sessions(app_id,room_id,user_id,kind,joined_at,left_at) VALUES
        ('app-b','g','u1','voice',NOW()-interval '5 minutes',NOW()),('app-b','g','u2','voice',NOW()-interval '5 minutes',NOW()),('app-b','g','u3','voice',NOW()-interval '5 minutes',NOW());
      INSERT INTO messages(app_id,room_id,from_user_id,text) VALUES ('app-b','r','u1','hi'),('app-b','r','u2','hello');
      INSERT INTO events(app_id,type,user_id) VALUES ('app-b','message.sent','u1'),('app-a','user.joined','__portal__');`);
    const list=(await app.inject({url:'/v1/admin/customers?sort=minutes_month',headers:admin})).json();
    const b0=list.customers[0];assert.equal(b0.id,b);assert.equal(Math.round(b0.minutes_month),35);assert.equal(Math.round(b0.minutes_total),35);
    assert.equal(b0.messages_total,2);assert.equal(b0.calls_total,1);assert.ok(b0.last_active_at);
    assert.equal(list.customers[1].minutes_total,0);assert.equal(list.customers[1].last_active_at,null,'console visits are not app activity');
    assert.equal(list.planLimits.free.callMinutes,2000);
    assert.equal((await app.inject({url:'/v1/admin/customers?plan=pro',headers:admin})).json().total,1);
    assert.equal((await app.inject({url:'/v1/admin/customers?sort=drop',headers:admin})).statusCode,400);
    const detail=(await app.inject({url:`/v1/admin/customers/${b}`,headers:admin})).json();
    assert.equal(detail.monthly.length,6);assert.equal(Math.round(detail.monthly[0].minutes),35);assert.equal(detail.recentCalls.length,1);assert.ok('signup_ip' in detail.account);
    const o=(await app.inject({url:'/v1/admin/overview',headers:admin})).json();
    assert.equal(o.customers,2);assert.equal(Math.round(o.customer_minutes_month),35);assert.equal(Math.round(o.other_minutes_month),10);
    assert.equal(o.customer_messages_month,2);assert.equal(o.active_30_days,1);assert.deepEqual(o.plans,{free:1,pro:1});assert.equal(o.recentSignups.length,2);
    const pays=(await app.inject({url:'/v1/admin/payments',headers:admin})).json();assert.equal(pays.total,4);assert.equal(pays.payments[0].email!==undefined,true);
    for(const url of ['/v1/admin/overview','/v1/admin/payments'])assert.equal((await app.inject({url,headers:portal()})).statusCode,401);
  });
  await t.test('admin changes plan and gives extra minutes; both raise the allowance and land in the history',async()=>{
    const post=(url:string,payload:any)=>app.inject({method:'POST',url,headers:admin,payload});
    assert.equal((await post(`/v1/admin/customers/${b}/plan`,{plan:'pro'})).statusCode,400,'reason required');
    assert.equal((await post(`/v1/admin/customers/${b}/plan`,{plan:'gold',reason:'x'})).statusCode,400);
    assert.equal((await post(`/v1/admin/customers/${b}/plan`,{plan:'starter',reason:'Friend, testing'})).statusCode,200);
    assert.equal((await pg.query(`SELECT plan FROM apps WHERE app_id='app-b'`)).rows[0].plan,'starter');
    assert.equal((await post(`/v1/admin/customers/${b}/plan`,{plan:'starter',reason:'again'})).statusCode,400,'same plan');
    assert.equal((await post(`/v1/admin/customers/${b}/bonus-minutes`,{minutes:1.5,note:'x'})).statusCode,400);
    assert.equal((await post(`/v1/admin/customers/${b}/bonus-minutes`,{minutes:500})).statusCode,400,'note required');
    const g=await post(`/v1/admin/customers/${b}/bonus-minutes`,{minutes:500,note:'Launch goodwill'});assert.equal(g.statusCode,200,g.body);
    const d=(await app.inject({url:`/v1/admin/customers/${b}`,headers:admin})).json();
    assert.equal(d.account.bonus_minutes_month,500);assert.equal(d.bonusGrants.length,1);
    assert.deepEqual(d.history.map((h:any)=>h.action),['minutes.add','plan.change']);assert.equal(d.history[0].actor,'server-api-key');
    const { getBillingSummary }=await import('./billing.js');
    const summary=await getBillingSummary('app-b');assert.equal(summary.bonusMinutes,500);assert.equal(summary.limits.callMinutes,BILLING_PLANS.starter.limits.callMinutes+500);
    assert.equal((await app.inject({method:'DELETE',url:`/v1/admin/customers/${a}/bonus-minutes/${g.json().id}`,headers:admin})).statusCode,404,'grant belongs to another customer');
    assert.equal((await app.inject({method:'DELETE',url:`/v1/admin/customers/${b}/bonus-minutes/${g.json().id}`,headers:admin})).statusCode,200);
    assert.equal((await getBillingSummary('app-b')).bonusMinutes,0);
    assert.equal((await app.inject({method:'POST',url:`/v1/admin/customers/${b}/plan`,headers:portal('app-b'),payload:{plan:'pro',reason:'me'}})).statusCode,401);
  });
  await t.test('filters behind the overview numbers; block, unblock and delete',async()=>{
    const list=async(qs:string)=>(await app.inject({url:`/v1/admin/customers?${qs}`,headers:admin})).json();
    assert.equal((await list('joined=month')).total,2);assert.equal((await list('activity=active30')).customers[0].id,b);assert.equal((await list('activity=never')).total,1);
    assert.equal((await list('email=unverified')).total,2);assert.equal((await app.inject({url:'/v1/admin/customers?joined=year',headers:admin})).statusCode,400);
    const access=(id:string,payload:any)=>app.inject({method:'POST',url:`/v1/admin/customers/${id}/access`,headers:admin,payload});
    assert.equal((await access(b,{blocked:true})).statusCode,400,'reason required');
    assert.equal((await access(b,{blocked:true,reason:'Spam'})).statusCode,200);
    assert.equal((await list('status=blocked')).total,1);
    assert.equal((await app.inject({url:'/v1/portal/business-profile',headers:portal('app-b')})).statusCode,401,'blocked customer is signed out');
    assert.equal((await access(b,{blocked:true,reason:'again'})).statusCode,400);
    assert.equal((await access(b,{blocked:false,reason:'Sorted out'})).statusCode,200);
    const del=(id:string,payload:any)=>app.inject({method:'DELETE',url:`/v1/admin/customers/${id}`,headers:admin,payload});
    assert.equal((await del(a,{confirmEmail:'first@example.test',reason:'x'})).statusCode,409,'paying customers are never deleted');
    assert.equal((await del(b,{confirmEmail:'second@example.test',reason:'x'})).statusCode,409,'even failed payment attempts are kept');
    await pg.exec(`DELETE FROM billing_payments WHERE app_id='app-b'`);
    assert.equal((await del(b,{confirmEmail:'wrong@example.test',reason:'x'})).statusCode,400);
    const ok=await del(b,{confirmEmail:'SECOND@example.test',reason:'Test account'});assert.equal(ok.statusCode,200,ok.body);
    assert.equal((await pg.query(`SELECT 1 FROM apps WHERE app_id='app-b'`)).rows.length,0);
    assert.equal((await pg.query(`SELECT 1 FROM messages WHERE app_id='app-b'`)).rows.length,0);
    assert.equal((await pg.query(`SELECT 1 FROM billing_payments WHERE app_id='app-a'`)).rows.length,2,'other customers untouched');
    const h=(await app.inject({url:'/v1/admin/customers?page=1',headers:admin})).json();assert.equal(h.total,1);
    assert.equal((await pg.query(`SELECT action FROM admin_audit WHERE target=$1 ORDER BY id DESC LIMIT 1`,[b])).rows[0].action,'account.delete');
  });
});
