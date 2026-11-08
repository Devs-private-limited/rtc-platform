import type { FastifyInstance } from 'fastify';
import { getPool } from '../db.js';
import { requireAdmin, adminIdentity, audit } from './admin.js';
import { setAppPlan } from '../apps.js';
import { sendExtraMinutesEmail, sendPlanChangedEmail } from '../notify-email.js';
import { getBonusMinutes, getCurrentBillingSummary } from '../billing.js';
import { clearMinuteCache } from '../usage-limits.js';
import { requirePortalUser } from '../portal-auth.js';
import { rateLimit } from '../rate-limit.js';
import { BILLING_PLANS } from '../billing-plans.js';

// Real payments come from Dodo webhooks into billing_payments (one project per account, joined by app_id).
const verified="status='succeeded'";
const profileColumns='business_type,business_name,phone,website,address,city,state,postal_code,country,tax_id,updated_at';
const paymentColumns='payment_id,subscription_id,status,amount_minor,refunded_minor,currency,description,paid_at,updated_at';

// Participant minutes, counted the same way as the console and plan limits: a 1:1 call counts once per
// person (x2), group/SFU sessions count per participant. Calendar month is UTC. Open sessions count up to now.
const monthStart="(date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')";
const usageJoin=`LEFT JOIN LATERAL (SELECT
    (COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(cs.ended_at,NOW())-cs.started_at)))*2 FROM call_sessions cs WHERE cs.app_id=c.app_id),0)
      +COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ms.left_at,NOW())-ms.joined_at))) FROM media_sessions ms WHERE ms.app_id=c.app_id),0))/60 AS minutes_total,
    (COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(cs.ended_at,NOW())-GREATEST(cs.started_at,${monthStart}))))*2 FROM call_sessions cs WHERE cs.app_id=c.app_id AND COALESCE(cs.ended_at,NOW())>${monthStart}),0)
      +COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ms.left_at,NOW())-GREATEST(ms.joined_at,${monthStart})))) FROM media_sessions ms WHERE ms.app_id=c.app_id AND COALESCE(ms.left_at,NOW())>${monthStart}),0))/60 AS minutes_month,
    (SELECT COUNT(*)::int FROM call_sessions cs WHERE cs.app_id=c.app_id) AS calls_total,
    (SELECT COUNT(*)::int FROM messages m WHERE m.app_id=c.app_id) AS messages_total,
    (SELECT COUNT(*)::int FROM messages m WHERE m.app_id=c.app_id AND m.sent_at>=${monthStart}) AS messages_month,
    (SELECT MAX(e.created_at) FROM events e WHERE e.app_id=c.app_id AND COALESCE(e.user_id,'')<>'__portal__') AS last_active_at,
    (SELECT COALESCE(SUM(b.minutes),0)::int FROM app_bonus_minutes b WHERE b.app_id=c.app_id AND b.month=to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM')) AS bonus_minutes_month
  ) u ON true`;
const usageColumns='ROUND(u.minutes_total::numeric,1)::float8 minutes_total,ROUND(u.minutes_month::numeric,1)::float8 minutes_month,u.calls_total,u.messages_total,u.messages_month,u.last_active_at,u.bonus_minutes_month';
const sorts:Record<string,string>={newest:'c.created_at DESC',minutes_month:'u.minutes_month DESC NULLS LAST,c.created_at DESC',minutes_total:'u.minutes_total DESC NULLS LAST,c.created_at DESC',last_active:'u.last_active_at DESC NULLS LAST,c.created_at DESC',paid:'COALESCE(p.payment_count,0) DESC,c.created_at DESC'};
const planLimits=Object.fromEntries(Object.entries(BILLING_PLANS).map(([id,p])=>[id,{name:p.name,callMinutes:p.limits.callMinutes,messages:p.limits.messages}]));

export async function registerCustomerRoutes(app:FastifyInstance,secret:string) {
  app.addHook('onSend',async(_req,reply,payload)=>{reply.header('Cache-Control','no-store');return payload;});
  app.get<{Querystring:{q?:string;page?:string;paid?:string;sort?:string;plan?:string;joined?:string;activity?:string;email?:string;status?:string}}>('/v1/admin/customers',async(req,reply)=>{
    if(!requireAdmin(req,reply))return;
    const db=getPool();if(!db)return reply.code(503).send({error:'Database unavailable'});
    const q=req.query.q?.trim() || '',page=Number(req.query.page || 1),paid=req.query.paid || 'all',sort=req.query.sort || 'newest',plan=req.query.plan || 'all';
    const joined=req.query.joined || 'all',activity=req.query.activity || 'all',email=req.query.email || 'all',status=req.query.status || 'all';
    if(q.length>200 || !Number.isInteger(page) || page<1 || page>100000 || !['all','paid','unpaid'].includes(paid) || !Object.hasOwn(sorts,sort) || !['all','free','starter','pro'].includes(plan)
      || !['all','month','7d'].includes(joined) || !['all','active30','never'].includes(activity) || !['all','verified','unverified'].includes(email) || !['all','active','blocked'].includes(status))return reply.code(400).send({error:'Invalid search, page, filter or sort'});
    const filter=`($1='' OR POSITION(LOWER($1) IN LOWER(CONCAT_WS(' ',c.name,c.email,c.company,c.app_id,b.business_name)))>0)
      AND ($2='all' OR ($2='paid' AND COALESCE(p.payment_count,0)>0) OR ($2='unpaid' AND COALESCE(p.payment_count,0)=0))
      AND ($3='all' OR a.plan=$3)
      AND ($4='all' OR ($4='month' AND c.created_at>=${monthStart}) OR ($4='7d' AND c.created_at>=NOW()-interval '7 days'))
      AND ($5='all' OR ($5='active30' AND u.last_active_at>=NOW()-interval '30 days') OR ($5='never' AND u.last_active_at IS NULL))
      AND ($6='all' OR ($6='verified' AND c.email_verified_at IS NOT NULL) OR ($6='unverified' AND c.email_verified_at IS NULL))
      AND ($7='all' OR ($7='active' AND a.active) OR ($7='blocked' AND NOT a.active))`;
    const base=`FROM customer_accounts c JOIN apps a ON a.app_id=c.app_id LEFT JOIN customer_business_profiles b ON b.account_id=c.id
      LEFT JOIN (SELECT app_id,COUNT(*)::int payment_count,SUM(amount_minor)::text total_paid_minor,SUM(refunded_minor)::text refunded_minor,MAX(paid_at) last_paid_at,MAX(currency) currency
        FROM billing_payments WHERE ${verified} GROUP BY app_id) p ON p.app_id=c.app_id ${usageJoin} WHERE ${filter}`;
    const [summary,customers,count]=await Promise.all([
      db.query(`SELECT (SELECT COUNT(*)::int FROM customer_accounts) registered_customers,
        (SELECT COUNT(*)::int FROM apps WHERE plan<>'free' AND subscription_status='active') active_subscriptions,
        (SELECT COUNT(DISTINCT app_id)::int FROM billing_payments WHERE ${verified}) paying_customers,
        (SELECT COUNT(*)::int FROM billing_payments WHERE ${verified}) verified_payments,
        COALESCE((SELECT json_agg(t) FROM (SELECT currency,SUM(amount_minor)::text gross_minor,SUM(refunded_minor)::text refunds_minor,SUM(amount_minor-refunded_minor)::text net_minor
          FROM billing_payments WHERE ${verified} GROUP BY currency ORDER BY currency) t),'[]'::json) totals`),
      db.query(`SELECT c.id,c.name,c.email,c.company,c.app_id,c.created_at,a.plan,a.active,a.billing_period,a.subscription_status,a.subscription_renews_at,a.subscription_cancel_at_period_end,b.business_name,COALESCE(p.payment_count,0) payment_count,
        COALESCE(p.total_paid_minor,'0') total_paid_minor,COALESCE(p.refunded_minor,'0') refunded_minor,p.last_paid_at,p.currency,c.email_verified_at,a.name project_name,c.signup_source,${usageColumns}
        ${base} ORDER BY ${sorts[sort]},c.id LIMIT 25 OFFSET $8`,[q,paid,plan,joined,activity,email,status,(page-1)*25]),
      db.query(`SELECT COUNT(*)::int total ${base}`,[q,paid,plan,joined,activity,email,status]),
    ]);
    return {summary:summary.rows[0],scope:'all_time',customers:customers.rows,total:count.rows[0].total,page,pageSize:25,paymentIntegration:'dodo',planLimits};
  });
  app.get<{Params:{accountId:string};Querystring:{page?:string}}>('/v1/admin/customers/:accountId',async(req,reply)=>{
    if(!requireAdmin(req,reply))return;
    const {accountId}=req.params,page=Number(req.query.page || 1);
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(accountId) || !Number.isInteger(page) || page<1 || page>100000)return reply.code(400).send({error:'Invalid customer or page'});
    const db=getPool();if(!db)return reply.code(503).send({error:'Database unavailable'});
    const account=await db.query(`SELECT c.id,c.name,c.email,c.company,c.app_id,c.created_at,c.email_verified_at,c.signup_ip,c.signup_user_agent,c.signup_source,a.name project_name,a.plan,a.active,a.billing_period,a.subscription_status,a.subscription_renews_at,a.subscription_cancel_at_period_end,a.dodo_subscription_id,${usageColumns}
      FROM customer_accounts c JOIN apps a ON a.app_id=c.app_id ${usageJoin} WHERE c.id=$1`,[accountId]);
    if(!account.rows.length)return reply.code(404).send({error:'Customer not found'});
    const appId=account.rows[0].app_id;
    const [profile,payments,count,monthly,calls,bonuses,history]=await Promise.all([
      db.query(`SELECT ${profileColumns} FROM customer_business_profiles WHERE account_id=$1`,[accountId]),
      db.query(`SELECT ${paymentColumns} FROM billing_payments WHERE app_id=$1 ORDER BY paid_at DESC,payment_id DESC LIMIT 25 OFFSET $2`,[account.rows[0].app_id,(page-1)*25]),
      db.query('SELECT COUNT(*)::int total FROM billing_payments WHERE app_id=$1',[account.rows[0].app_id]),
      // Last 6 calendar months (UTC); a session counts in the month it started.
      db.query(`WITH months AS (SELECT (generate_series(date_trunc('month',NOW() AT TIME ZONE 'UTC')-interval '5 months',date_trunc('month',NOW() AT TIME ZONE 'UTC'),interval '1 month')) AT TIME ZONE 'UTC' AS m)
        SELECT to_char(m AT TIME ZONE 'UTC','YYYY-MM') AS month,
          ROUND(((COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at,NOW())-started_at)))*2 FROM call_sessions WHERE app_id=$1 AND started_at>=m AND started_at<m+interval '1 month'),0)
           +COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(left_at,NOW())-joined_at))) FROM media_sessions WHERE app_id=$1 AND joined_at>=m AND joined_at<m+interval '1 month'),0))/60)::numeric,1)::float8 AS minutes,
          (SELECT COUNT(*)::int FROM call_sessions WHERE app_id=$1 AND started_at>=m AND started_at<m+interval '1 month') AS calls,
          (SELECT COUNT(*)::int FROM messages WHERE app_id=$1 AND sent_at>=m AND sent_at<m+interval '1 month') AS messages
        FROM months ORDER BY m DESC`,[appId]),
      db.query(`SELECT call_type,caller_user_id,callee_user_id,started_at,ended_at,end_reason,ROUND((EXTRACT(EPOCH FROM (COALESCE(ended_at,NOW())-started_at))/60)::numeric,1)::float8 AS minutes
        FROM call_sessions WHERE app_id=$1 ORDER BY started_at DESC LIMIT 20`,[appId]),
      db.query(`SELECT id::text,month,minutes,note,granted_by,created_at FROM app_bonus_minutes WHERE app_id=$1 AND month=to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM') ORDER BY created_at DESC`,[appId]),
      db.query(`SELECT actor,action,detail,created_at FROM admin_audit WHERE target=$1 ORDER BY created_at DESC,id DESC LIMIT 30`,[accountId]),
    ]);
    return {account:account.rows[0],profile:profile.rows[0] || null,payments:payments.rows,total:count.rows[0].total,page,pageSize:25,monthly:monthly.rows,recentCalls:calls.rows,bonusGrants:bonuses.rows,history:history.rows,planLimits};
  });
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  async function findAccount(id:string){
    if(!uuid.test(id))return null;
    const r=await getPool()!.query('SELECT c.id,c.email,c.app_id,a.plan,a.active,a.subscription_status FROM customer_accounts c JOIN apps a ON a.app_id=c.app_id WHERE c.id=$1',[id]);
    return r.rows[0] || null;
  }
  // Manual plan change (no payment). A later Dodo subscription event can change it again.
  app.post<{Params:{accountId:string};Body:{plan?:string;reason?:string;notify?:boolean}}>('/v1/admin/customers/:accountId/plan',async(req,reply)=>{
    if(!requireAdmin(req,reply))return;
    if(!getPool())return reply.code(503).send({error:'Database unavailable'});
    const plan=req.body?.plan,reason=String(req.body?.reason || '').trim().slice(0,300);
    if(!plan || !Object.hasOwn(BILLING_PLANS,plan))return reply.code(400).send({error:'Choose Free, Starter or Pro.'});
    if(!reason)return reply.code(400).send({error:'Write a short reason (for the change history).'});
    const acc=await findAccount(req.params.accountId);if(!acc)return reply.code(404).send({error:'Customer not found'});
    if(acc.plan===plan)return reply.code(400).send({error:'The customer is already on this plan.'});
    await setAppPlan(acc.app_id,plan as any);
    clearMinuteCache(acc.app_id);
    const order=['free','starter','pro'],upgrade=order.indexOf(plan)>order.indexOf(acc.plan);
    const email=req.body?.notify===false?'skipped':await sendPlanChangedEmail(acc.email,BILLING_PLANS[plan as keyof typeof BILLING_PLANS].name,upgrade);
    await audit(adminIdentity(req)!.email,'plan.change',acc.id,{email:acc.email,from:acc.plan,to:plan,reason,customerEmail:email});
    return {plan,customerEmail:email};
  });
  app.post<{Params:{accountId:string};Body:{minutes?:unknown;note?:string;notify?:boolean}}>('/v1/admin/customers/:accountId/bonus-minutes',async(req,reply)=>{
    if(!requireAdmin(req,reply))return;
    const db=getPool();if(!db)return reply.code(503).send({error:'Database unavailable'});
    const minutes=Number(req.body?.minutes),note=String(req.body?.note || '').trim().slice(0,300);
    if(!Number.isInteger(minutes) || minutes<1 || minutes>1000000)return reply.code(400).send({error:'Enter whole minutes between 1 and 1,000,000.'});
    if(!note)return reply.code(400).send({error:'Write a short reason (for the change history).'});
    const acc=await findAccount(req.params.accountId);if(!acc)return reply.code(404).send({error:'Customer not found'});
    const who=adminIdentity(req)!.email;
    const r=await db.query(`INSERT INTO app_bonus_minutes(app_id,month,minutes,note,granted_by) VALUES ($1,to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM'),$2,$3,$4) RETURNING id::text,month`,[acc.app_id,minutes,note,who]);
    let email='skipped';
    if(req.body?.notify!==false){
      clearMinuteCache(acc.app_id);
      const allowance=(await getCurrentBillingSummary(acc.app_id)).limits.voiceMinutes;
      email=await sendExtraMinutesEmail(acc.email,minutes,r.rows[0].month,allowance);
    }
    await audit(who,'minutes.add',acc.id,{email:acc.email,minutes,month:r.rows[0].month,note,customerEmail:email});
    return {id:r.rows[0].id,month:r.rows[0].month,minutes,customerEmail:email};
  });
  app.delete<{Params:{accountId:string;grantId:string}}>('/v1/admin/customers/:accountId/bonus-minutes/:grantId',async(req,reply)=>{
    if(!requireAdmin(req,reply))return;
    const db=getPool();if(!db)return reply.code(503).send({error:'Database unavailable'});
    if(!/^\d{1,18}$/.test(req.params.grantId))return reply.code(400).send({error:'Invalid grant'});
    const acc=await findAccount(req.params.accountId);if(!acc)return reply.code(404).send({error:'Customer not found'});
    const r=await db.query('DELETE FROM app_bonus_minutes WHERE id=$1 AND app_id=$2 RETURNING minutes,month',[req.params.grantId,acc.app_id]);
    if(!r.rowCount)return reply.code(404).send({error:'Grant not found'});
    await audit(adminIdentity(req)!.email,'minutes.remove',acc.id,{email:acc.email,minutes:r.rows[0].minutes,month:r.rows[0].month});
    return {removed:true};
  });
  // Block: the customer can't sign in, open sessions end at once, and their app can't get new call/chat tokens.
  // Nothing is deleted, and unblocking restores everything.
  app.post<{Params:{accountId:string};Body:{blocked?:boolean;reason?:string}}>('/v1/admin/customers/:accountId/access',async(req,reply)=>{
    if(!requireAdmin(req,reply))return;
    const db=getPool();if(!db)return reply.code(503).send({error:'Database unavailable'});
    const blocked=req.body?.blocked,reason=String(req.body?.reason || '').trim().slice(0,300);
    if(typeof blocked!=='boolean')return reply.code(400).send({error:'Say whether to block or unblock.'});
    if(!reason)return reply.code(400).send({error:'Write a short reason (for the change history).'});
    const acc=await findAccount(req.params.accountId);if(!acc)return reply.code(404).send({error:'Customer not found'});
    if(acc.active===!blocked)return reply.code(400).send({error:blocked?'This customer is already blocked.':'This customer is not blocked.'});
    await db.query('UPDATE apps SET active=$1,portal_version=portal_version+1 WHERE app_id=$2',[!blocked,acc.app_id]);
    await audit(adminIdentity(req)!.email,blocked?'account.block':'account.unblock',acc.id,{email:acc.email,reason});
    return {blocked};
  });
  // Delete: owner only, and never for anyone who has paid (payment records must be kept for accounts/tax).
  app.delete<{Params:{accountId:string};Body:{confirmEmail?:string;reason?:string}}>('/v1/admin/customers/:accountId',async(req,reply)=>{
    if(!requireAdmin(req,reply,'owner'))return;
    const db=getPool();if(!db)return reply.code(503).send({error:'Database unavailable'});
    const acc=await findAccount(req.params.accountId);if(!acc)return reply.code(404).send({error:'Customer not found'});
    const reason=String(req.body?.reason || '').trim().slice(0,300);
    if(String(req.body?.confirmEmail || '').trim().toLowerCase()!==String(acc.email).toLowerCase())return reply.code(400).send({error:'Type the customer’s email exactly to confirm.'});
    if(!reason)return reply.code(400).send({error:'Write a short reason (for the change history).'});
    const paid=await db.query('SELECT (SELECT COUNT(*) FROM billing_payments WHERE app_id=$1)+(SELECT COUNT(*) FROM customer_payments WHERE account_id=$2) AS n',[acc.app_id,acc.id]);
    if(Number(paid.rows[0].n)>0 || (acc.plan!=='free' && acc.subscription_status==='active'))return reply.code(409).send({error:'This customer has payment records or an active subscription, so they can’t be deleted (records must be kept). Block them instead.'});
    const client=await db.connect();
    try{
      await client.query('BEGIN');
      for(const table of ['events','messages','call_sessions','media_sessions','recordings','call_quality_reports','webhooks','app_bonus_minutes']){
        await client.query('SAVEPOINT s');
        try{await client.query(`DELETE FROM ${table} WHERE app_id=$1`,[acc.app_id]);await client.query('RELEASE SAVEPOINT s');}
        catch{await client.query('ROLLBACK TO SAVEPOINT s');} // table not present in this database
      }
      await client.query('DELETE FROM customer_accounts WHERE id=$1',[acc.id]);
      await client.query('DELETE FROM apps WHERE app_id=$1',[acc.app_id]);
      await client.query('COMMIT');
    }catch(err){await client.query('ROLLBACK');throw err;}finally{client.release();}
    await audit(adminIdentity(req)!.email,'account.delete',acc.id,{email:acc.email,appId:acc.app_id,reason});
    return {deleted:true};
  });
  app.get('/v1/admin/overview',async(req,reply)=>{
    if(!requireAdmin(req,reply))return;
    const db=getPool();if(!db)return reply.code(503).send({error:'Database unavailable'});
    const customerApps='SELECT app_id FROM customer_accounts';
    const minutes=(cond:string)=>`ROUND(((COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at,NOW())-GREATEST(started_at,$1::timestamptz))))*2 FROM call_sessions WHERE ${cond} AND COALESCE(ended_at,NOW())>$1::timestamptz),0)
      +COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(left_at,NOW())-GREATEST(joined_at,$1::timestamptz)))) FROM media_sessions WHERE ${cond} AND COALESCE(left_at,NOW())>$1::timestamptz),0))/60)::numeric,1)::float8`;
    const r=await db.query(`SELECT
      (SELECT COUNT(*)::int FROM customer_accounts) customers,
      (SELECT COUNT(*)::int FROM customer_accounts WHERE email_verified_at IS NOT NULL) verified_customers,
      (SELECT COUNT(*)::int FROM customer_accounts WHERE created_at>=${monthStart}) new_this_month,
      (SELECT COUNT(*)::int FROM customer_accounts WHERE created_at>=NOW()-interval '7 days') new_7_days,
      (SELECT COUNT(DISTINCT app_id)::int FROM events WHERE app_id IN (${customerApps}) AND created_at>=NOW()-interval '30 days' AND COALESCE(user_id,'')<>'__portal__') active_30_days,
      (SELECT json_object_agg(plan,n) FROM (SELECT a.plan,COUNT(*)::int n FROM customer_accounts c JOIN apps a ON a.app_id=c.app_id GROUP BY a.plan) t) plans,
      (SELECT COUNT(*)::int FROM apps WHERE plan<>'free' AND subscription_status='active') active_subscriptions,
      ${minutes(`app_id IN (${customerApps})`)} customer_minutes_month,
      ${minutes(`app_id NOT IN (${customerApps})`)} other_minutes_month,
      (SELECT COUNT(*)::int FROM messages WHERE app_id IN (${customerApps}) AND sent_at>=$1::timestamptz) customer_messages_month,
      (SELECT COUNT(*)::int FROM call_sessions WHERE app_id IN (${customerApps}) AND started_at>=$1::timestamptz) customer_calls_month,
      COALESCE((SELECT json_agg(t) FROM (SELECT currency,SUM(amount_minor)::text gross_minor,SUM(refunded_minor)::text refunds_minor,SUM(amount_minor-refunded_minor)::text net_minor
        FROM billing_payments WHERE ${verified} GROUP BY currency ORDER BY currency) t),'[]'::json) revenue_all_time,
      COALESCE((SELECT json_agg(t) FROM (SELECT currency,SUM(amount_minor-refunded_minor)::text net_minor
        FROM billing_payments WHERE ${verified} AND paid_at>=$1::timestamptz GROUP BY currency ORDER BY currency) t),'[]'::json) revenue_month`,
      [new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1)).toISOString()]);
    const recent=await db.query(`SELECT c.id,c.name,c.email,c.created_at,c.email_verified_at,a.plan FROM customer_accounts c JOIN apps a ON a.app_id=c.app_id ORDER BY c.created_at DESC LIMIT 5`);
    return {...r.rows[0],recentSignups:recent.rows,monthStartUtc:new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth(),1)).toISOString()};
  });
  app.get<{Querystring:{page?:string}}>('/v1/admin/payments',async(req,reply)=>{
    if(!requireAdmin(req,reply))return;
    const page=Number(req.query.page || 1);
    if(!Number.isInteger(page) || page<1 || page>100000)return reply.code(400).send({error:'Invalid page'});
    const db=getPool();if(!db)return reply.code(503).send({error:'Database unavailable'});
    const [rows,count]=await Promise.all([
      db.query(`SELECT bp.payment_id,bp.status,bp.amount_minor,bp.refunded_minor,bp.currency,bp.description,bp.paid_at,c.id account_id,c.email,c.name,a.plan
        FROM billing_payments bp LEFT JOIN customer_accounts c ON c.app_id=bp.app_id LEFT JOIN apps a ON a.app_id=bp.app_id ORDER BY bp.paid_at DESC NULLS LAST,bp.payment_id DESC LIMIT 50 OFFSET $1`,[(page-1)*50]),
      db.query('SELECT COUNT(*)::int total FROM billing_payments'),
    ]);
    return {payments:rows.rows,total:count.rows[0].total,page,pageSize:50};
  });
  app.get('/v1/portal/business-profile',async(req,reply)=>{
    const claims=await requirePortalUser(req,reply,secret);if(!claims)return;
    const db=getPool();if(!db)return reply.code(503).send({error:'Database unavailable'});
    const account=await db.query('SELECT id,company FROM customer_accounts WHERE app_id=$1',[claims.appId]);
    if(!account.rows.length)return reply.code(404).send({error:'Customer account not found'});
    const result=await db.query(`SELECT ${profileColumns} FROM customer_business_profiles WHERE account_id=$1`,[account.rows[0].id]);
    return {profile:result.rows[0] || {business_type:'individual',business_name:account.rows[0].company || ''}};
  });
  app.put<{Body:Record<string,unknown>}>('/v1/portal/business-profile',{bodyLimit:8192},async(req,reply)=>{
    const claims=await requirePortalUser(req,reply,secret);if(!claims)return;
    if(!rateLimit(`business-profile:${claims.appId}`,20,60000))return reply.code(429).send({error:'Too many updates'});
    const fields:Record<string,number>={business_type:20,business_name:255,phone:40,website:500,address:1000,city:100,state:100,postal_code:30,country:100,tax_id:40};
    const values:Record<string,string>={};
    for(const [field,max] of Object.entries(fields)){
      const value=req.body?.[field] ?? '';
      if(typeof value!=='string' || value.length>max)return reply.code(400).send({error:`Invalid ${field}`});
      values[field]=value.trim();
    }
    if(!['individual','business'].includes(values.business_type))return reply.code(400).send({error:'Choose individual or business'});
    if(values.website){try{if(!['http:','https:'].includes(new URL(values.website).protocol))throw new Error();}catch{return reply.code(400).send({error:'Website must be an http or https URL'});}}
    const db=getPool();if(!db)return reply.code(503).send({error:'Database unavailable'});
    const names=Object.keys(fields);
    const result=await db.query(`INSERT INTO customer_business_profiles (account_id,${names.join(',')})
      SELECT id,${names.map((_,i)=>`$${i+2}`).join(',')} FROM customer_accounts WHERE app_id=$1
      ON CONFLICT (account_id) DO UPDATE SET ${names.map(n=>`${n}=EXCLUDED.${n}`).join(',')},updated_at=NOW() RETURNING account_id`,[claims.appId,...names.map(n=>values[n])]);
    if(!result.rows.length)return reply.code(404).send({error:'Customer account not found'});
    return {ok:true};
  });
}
