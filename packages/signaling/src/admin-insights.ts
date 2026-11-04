import { getPool } from "./db.js";
import { BILLING_PLANS } from "./billing-plans.js";
import { ownerAlertRecipients, sendOwnerEmail, type EmailResult } from "./notify-email.js";

// "Needs attention" for the admin Overview and the weekly summary email.
// Each list is small and ready to show: who, and one line saying why.
export interface AttentionItem { accountId: string; email: string; name: string | null; plan: string; why: string; at?: string | null }
export interface Attention {
  nearLimit: AttentionItem[];
  paymentProblems: AttentionItem[];
  cancellations: AttentionItem[];
  notVerified: AttentionItem[];
  neverUsed: AttentionItem[];
  spikes: AttentionItem[];
}

const MONTH = "(date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')";
// Participant minutes (1:1 calls x2, group per person) since a point in time, for app c.app_id.
const minutesSince = (since: string) => `(COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(cs.ended_at,NOW())-GREATEST(cs.started_at,${since}))))*2 FROM call_sessions cs WHERE cs.app_id=c.app_id AND COALESCE(cs.ended_at,NOW())>${since}),0)
  +COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ms.left_at,NOW())-GREATEST(ms.joined_at,${since})))) FROM media_sessions ms WHERE ms.app_id=c.app_id AND COALESCE(ms.left_at,NOW())>${since}),0))/60`;
const n = (v: unknown) => Math.round(Number(v || 0)).toLocaleString("en-IN");
const PLAN_ROWS = Object.entries(BILLING_PLANS).map(([id, p]) => `('${id}',${p.limits.callMinutes},${p.limits.messages})`).join(",");

export async function getAttention(): Promise<Attention> {
  const db = getPool();
  if (!db) throw new Error("Database unavailable");
  const base = "FROM customer_accounts c JOIN apps a ON a.app_id=c.app_id";
  const [usage, payments, cancels, unverified, unused] = await Promise.all([
    db.query(`WITH lim(plan,minutes,messages) AS (VALUES ${PLAN_ROWS}),
      u AS (SELECT c.id,c.email,c.name,a.plan,a.active,
        ${minutesSince(MONTH)} AS month_min,
        ${minutesSince("NOW()-interval '24 hours'")} AS day_min,
        (SELECT COUNT(*) FROM messages m WHERE m.app_id=c.app_id AND m.sent_at>=${MONTH}) AS month_msgs,
        (SELECT COALESCE(SUM(b.minutes),0) FROM app_bonus_minutes b WHERE b.app_id=c.app_id AND b.month=to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM')) AS bonus
        ${base} WHERE a.active)
      SELECT u.*,lim.minutes+u.bonus AS min_limit,lim.messages AS msg_limit FROM u JOIN lim ON lim.plan=u.plan`),
    db.query(`SELECT c.id,c.email,c.name,a.plan,bp.status,bp.amount_minor,bp.currency,bp.paid_at
      FROM billing_payments bp JOIN customer_accounts c ON c.app_id=bp.app_id JOIN apps a ON a.app_id=bp.app_id
      WHERE bp.status IN ('failed','cancelled') AND COALESCE(bp.paid_at,bp.updated_at)>=NOW()-interval '30 days' ORDER BY COALESCE(bp.paid_at,bp.updated_at) DESC LIMIT 20`),
    db.query(`SELECT c.id,c.email,c.name,a.plan,a.subscription_status,a.subscription_cancel_at_period_end,a.subscription_renews_at,a.billing_event_at ${base}
      WHERE (a.subscription_cancel_at_period_end AND a.plan<>'free')
         OR (a.subscription_status IN ('cancelled','expired','failed','on_hold','paused') AND COALESCE(a.billing_event_at,NOW())>=NOW()-interval '30 days')
      ORDER BY a.billing_event_at DESC NULLS LAST LIMIT 20`),
    db.query(`SELECT c.id,c.email,c.name,a.plan,c.created_at ${base}
      WHERE c.email_verified_at IS NULL AND a.active AND c.created_at<NOW()-interval '3 days' AND c.created_at>=NOW()-interval '60 days' ORDER BY c.created_at DESC LIMIT 20`),
    db.query(`SELECT c.id,c.email,c.name,a.plan,c.created_at ${base}
      WHERE a.active AND c.created_at<NOW()-interval '3 days' AND c.created_at>=NOW()-interval '60 days'
        AND NOT EXISTS (SELECT 1 FROM events e WHERE e.app_id=c.app_id AND COALESCE(e.user_id,'')<>'__portal__')
      ORDER BY c.created_at DESC LIMIT 20`),
  ]);
  const item = (r: any, why: string, at?: string | null): AttentionItem => ({ accountId: r.id, email: r.email, name: r.name, plan: r.plan, why, at: at ?? null });
  const nearLimit: AttentionItem[] = [], spikes: AttentionItem[] = [];
  for (const r of usage.rows) {
    const minPct = r.min_limit > 0 ? (Number(r.month_min) / Number(r.min_limit)) * 100 : 0;
    const msgPct = r.msg_limit > 0 ? (Number(r.month_msgs) / Number(r.msg_limit)) * 100 : 0;
    if (minPct >= 80) nearLimit.push(item(r, `${minPct >= 100 ? "Over" : "Near"} the minutes limit: ${n(r.month_min)} of ${n(r.min_limit)} min (${Math.round(minPct)}%)`));
    else if (msgPct >= 80) nearLimit.push(item(r, `${msgPct >= 100 ? "Over" : "Near"} the message limit: ${n(r.month_msgs)} of ${n(r.msg_limit)} (${Math.round(msgPct)}%)`));
    // A sudden burst: more than a quarter of the monthly allowance (and over 300 min) in 24 hours.
    if (Number(r.day_min) > 300 && Number(r.day_min) > Number(r.min_limit) / 4) spikes.push(item(r, `${n(r.day_min)} minutes in the last 24 hours (plan allows ${n(r.min_limit)} a month)`));
  }
  const money = (minor: unknown, cur: unknown) => `${String(cur || "USD").toUpperCase() === "INR" ? "₹" : "$"}${(Number(minor || 0) / 100).toFixed(2)}`;
  return {
    nearLimit: nearLimit.slice(0, 20),
    paymentProblems: payments.rows.map((r: any) => item(r, `Payment ${r.status}: ${money(r.amount_minor, r.currency)}`, r.paid_at)),
    cancellations: cancels.rows.map((r: any) => item(r, r.subscription_cancel_at_period_end
      ? `Cancels at the end of the period${r.subscription_renews_at ? ` (${new Date(r.subscription_renews_at).toLocaleDateString("en-IN")})` : ""}`
      : `Subscription ${r.subscription_status}, now on Free`, r.billing_event_at)),
    notVerified: unverified.rows.map((r: any) => item(r, "Signed up but never verified their email", r.created_at)),
    neverUsed: unused.rows.map((r: any) => item(r, "Signed up but never used their app (no chat or calls)", r.created_at)),
    spikes: spikes.slice(0, 20),
  };
}

// ---- Weekly summary email (Mondays) ----
export async function weeklyNumbers() {
  const db = getPool();
  if (!db) throw new Error("Database unavailable");
  const week = "NOW()-interval '7 days'";
  const r = await db.query(`SELECT
    (SELECT COUNT(*)::int FROM customer_accounts) customers,
    (SELECT COUNT(*)::int FROM customer_accounts WHERE created_at>=${week}) new_customers,
    (SELECT COUNT(*)::int FROM apps WHERE plan<>'free' AND subscription_status='active') paying,
    (SELECT COUNT(DISTINCT app_id)::int FROM events WHERE created_at>=${week} AND COALESCE(user_id,'')<>'__portal__' AND app_id IN (SELECT app_id FROM customer_accounts)) active_customers,
    (SELECT ROUND(((COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at,NOW())-GREATEST(started_at,${week}))))*2 FROM call_sessions WHERE app_id IN (SELECT app_id FROM customer_accounts) AND COALESCE(ended_at,NOW())>${week}),0)
      +COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(left_at,NOW())-GREATEST(joined_at,${week})))) FROM media_sessions WHERE app_id IN (SELECT app_id FROM customer_accounts) AND COALESCE(left_at,NOW())>${week}),0))/60)::numeric)::int) minutes,
    (SELECT COUNT(*)::int FROM messages WHERE sent_at>=${week} AND app_id IN (SELECT app_id FROM customer_accounts)) messages,
    COALESCE((SELECT json_agg(t) FROM (SELECT currency,SUM(amount_minor-refunded_minor)::text net_minor FROM billing_payments WHERE status='succeeded' AND paid_at>=${week} GROUP BY currency) t),'[]'::json) revenue`);
  const signups = await db.query(`SELECT c.id,c.email,c.name,a.plan,c.created_at FROM customer_accounts c JOIN apps a ON a.app_id=c.app_id WHERE c.created_at>=${week} ORDER BY c.created_at DESC LIMIT 15`);
  return { ...r.rows[0], signups: signups.rows };
}

const escHtml = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const adminBase = () => (process.env.ADMIN_PANEL_URL || "https://api.devsquarelabs.com/admin/").replace(/#.*$/, "");

export async function sendWeeklySummary(): Promise<EmailResult> {
  const [w, att] = await Promise.all([weeklyNumbers(), getAttention()]);
  const revenue = (w.revenue as any[]).length ? (w.revenue as any[]).map((r) => `${r.currency === "INR" ? "₹" : "$"}${(Number(r.net_minor) / 100).toFixed(2)}`).join(" + ") : "$0.00";
  const stats: [string, string][] = [["New customers", n(w.new_customers)], ["Total customers", n(w.customers)], ["Customers who used their app", n(w.active_customers)], ["Call minutes", n(w.minutes)], ["Chat messages", n(w.messages)], ["Paying customers", n(w.paying)], ["Revenue (after refunds)", revenue]];
  const sections: [string, AttentionItem[]][] = [["Near or over their limit (upgrade chance)", att.nearLimit], ["Payment problems", att.paymentProblems], ["Cancelled or cancelling", att.cancellations], ["Unusual usage spikes", att.spikes], ["Never used their app", att.neverUsed], ["Email not verified", att.notVerified]];
  const link = (id: string) => `${adminBase()}#/customers/${id}`;
  const font = "font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;";
  const statHtml = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${stats.map(([k, v]) => `<tr><td style="padding:7px 0;border-bottom:1px solid #EEF2EF;color:#42564E;font-size:15px;">${k}</td><td style="padding:7px 0;border-bottom:1px solid #EEF2EF;text-align:right;font-weight:700;color:#10261F;font-size:15px;">${escHtml(v)}</td></tr>`).join("")}</table>`;
  const signupHtml = (w.signups as any[]).length
    ? `<ul style="margin:0;padding-left:18px;">${(w.signups as any[]).map((s) => `<li style="margin:4px 0;"><a href="${escHtml(link(s.id))}" style="color:#087E72;">${escHtml(s.email)}</a>${s.name ? ` (${escHtml(s.name)})` : ""} · ${escHtml(s.plan)}</li>`).join("")}</ul>`
    : `<p style="margin:0;color:#6B7D75;">No new sign-ups this week.</p>`;
  const needs = sections.filter(([, items]) => items.length);
  const attentionHtml = needs.length
    ? needs.map(([title, items]) => `<p style="margin:14px 0 4px;font-weight:700;color:#10261F;">${title} (${items.length})</p><ul style="margin:0;padding-left:18px;">${items.slice(0, 8).map((i) => `<li style="margin:4px 0;"><a href="${escHtml(link(i.accountId))}" style="color:#087E72;">${escHtml(i.email)}</a>: ${escHtml(i.why)}</li>`).join("")}</ul>`).join("")
    : `<p style="margin:0;color:#6B7D75;">Nothing needs attention. 🎉</p>`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#F3F6F4;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F6F4;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;"><tr><td style="background:#fff;border:1px solid #DCE5DF;border-radius:14px;padding:30px 28px;${font}font-size:15px;line-height:1.55;color:#42564E;">
<h1 style="margin:0 0 4px;font-size:22px;color:#10261F;">RTCExpress: your week</h1><p style="margin:0 0 20px;">The last 7 days, ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.</p>
${statHtml}
<h2 style="margin:26px 0 8px;font-size:17px;color:#10261F;">New sign-ups</h2>${signupHtml}
<h2 style="margin:26px 0 4px;font-size:17px;color:#10261F;">Needs attention</h2>${attentionHtml}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;"><tr><td style="border-radius:10px;background:#087E72;"><a href="${escHtml(adminBase())}#/overview" style="display:inline-block;padding:12px 24px;color:#fff;font-weight:600;text-decoration:none;">Open the admin panel</a></td></tr></table>
</td></tr></table></td></tr></table></body></html>`;
  const text = `RTCExpress: your week\n\n${stats.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nNew sign-ups:\n${(w.signups as any[]).map((s) => `- ${s.email} (${s.plan})`).join("\n") || "none"}\n\nNeeds attention:\n${needs.map(([t, items]) => `${t}:\n${items.slice(0, 8).map((i) => `- ${i.email}: ${i.why}`).join("\n")}`).join("\n\n") || "nothing"}\n\n${adminBase()}#/overview`;
  return sendOwnerEmail(`RTCExpress weekly summary: ${n(w.new_customers)} new, ${n(w.minutes)} min`, text, html);
}

/** Sends the summary once per week, on Monday after 9:00 IST (03:30 UTC). Safe with several server instances. */
export function startWeeklySummary(log: (msg: string) => void) {
  const tick = async () => {
    const now = new Date(), ist = new Date(now.getTime() + 330 * 60000);
    if (ist.getUTCDay() !== 1 || ist.getUTCHours() < 9) return;
    if (!ownerAlertRecipients().length) return;
    const db = getPool(); if (!db) return;
    const key = ist.toISOString().slice(0, 10);
    try {
      const claimed = await db.query("INSERT INTO owner_digest_log(week_key) VALUES ($1) ON CONFLICT DO NOTHING RETURNING week_key", [key]);
      if (!claimed.rowCount) return;
      const result = await sendWeeklySummary();
      await db.query("UPDATE owner_digest_log SET result=$2 WHERE week_key=$1", [key, result]);
      log(`Weekly summary email: ${result}`);
    } catch (err) {
      log(`Weekly summary failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const timer = setInterval(() => void tick(), 15 * 60 * 1000);
  timer.unref();
  void tick();
  return timer;
}
