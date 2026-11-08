import { getPool } from "./db.js";
import { currentMonth } from "./usage-period.js";
import { getAppPlan } from "./apps.js";
import {
  type BillingPlan,
  type BillingSummary,
  type UsageWindow,
  type UsageBreakdown,
  BILLING_PLANS,
  checkThresholdAlerts,
  computeBillingSummary,
} from "./billing-plans.js";
import { getMeteringSummary } from "./metering.js";
import { countQualityReportsForApp } from "./quality.js";
import { countRecordingsForApp } from "./recordings.js";

export type { BillingPlan, BillingSummary, UsageBreakdown, UsageWindow };
export { BILLING_PLANS };

const lastAlertAt = new Map<string, number>();
const ALERT_COOLDOWN_MS = 60_000;

async function getUsageBreakdown(
  appId: string,
  opts: { from?: string; to?: string } = {}
): Promise<UsageBreakdown> {
  const metering = await getMeteringSummary(appId, opts);

  const db = getPool();
  let recordings = 0;
  let transcriptionMinutes = 0;

  if (db) {
    const recParams: unknown[] = [appId];
    let recFilter = "app_id = $1";
    if (opts.from) {
      recParams.push(opts.from);
      recFilter += ` AND created_at >= $${recParams.length}`;
    }
    if (opts.to) {
      recParams.push(opts.to);
      recFilter += ` AND created_at <= $${recParams.length}`;
    }

    const recResult = await db.query(
      `SELECT
         COUNT(*)::int AS count,
         COALESCE(SUM(duration_ms) FILTER (WHERE transcript IS NOT NULL), 0)::bigint AS transcribed_ms
       FROM recordings WHERE ${recFilter}`,
      recParams
    );
    recordings = recResult.rows[0]?.count ?? 0;
    const transcribedMs = Number(recResult.rows[0]?.transcribed_ms ?? 0);
    transcriptionMinutes = Math.round((transcribedMs / 60_000) * 100) / 100;
  } else {
    recordings = await countRecordingsForApp(appId, opts);
    transcriptionMinutes = 0;
  }

  const qualityReports = await countQualityReportsForApp(appId, opts);

  return {
    voiceMinutes: metering.voiceMinutes,
    videoMinutes: metering.videoMinutes,
    callMinutes: metering.callMinutes,
    messagesSent: metering.messagesSent,
    recordings,
    transcriptionMinutes,
    qualityReports,
    callsConnected: metering.callsConnected,
    callsEnded: metering.callsEnded,
    totalEvents: metering.totalEvents,
  };
}

export async function getBillingSummary(
  appId: string,
  opts: { from?: string; to?: string } = {}
): Promise<BillingSummary> {
  const plan = await getAppPlan(appId);
  const usage = await getUsageBreakdown(appId, opts);
  return computeBillingSummary(appId, plan, usage, {
    from: opts.from ?? null,
    to: opts.to ?? null,
  }, await getBonusMinutes(appId, opts.from));
}

/**
 * The usage that counts now. Free = one-time trial (all usage ever; over for good once the project
 * has paid). Paid with a subscription = since the last payment (renewal date minus one month or
 * year); the window only moves when Dodo confirms the next payment. Paid without a subscription
 * (set by an admin) = calendar month.
 */
export async function getUsageWindow(appId: string, now = new Date()): Promise<UsageWindow> {
  const db = getPool();
  const month = currentMonth(now);
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
  if (!db) return { kind: "month", from: month.from, to: month.to, resetsAt: nextMonth, yearly: false, trialOver: false };
  const r = await db.query(
    `SELECT plan, billing_period, subscription_renews_at, dodo_subscription_id FROM apps WHERE app_id = $1`,
    [appId]
  );
  const row = r.rows[0] as { plan?: string; billing_period?: string | null; subscription_renews_at?: Date | string | null; dodo_subscription_id?: string | null } | undefined;
  const plan = row?.plan || "free";
  if (plan === "free") {
    return { kind: "trial", from: null, to: now.toISOString(), resetsAt: null, yearly: false, trialOver: Boolean(row?.dodo_subscription_id) };
  }
  const yearly = row?.billing_period === "yearly";
  if (row?.subscription_renews_at) {
    const renews = new Date(row.subscription_renews_at);
    const start = new Date(renews);
    if (yearly) start.setUTCFullYear(start.getUTCFullYear() - 1);
    else start.setUTCMonth(start.getUTCMonth() - 1);
    return { kind: "subscription", from: start.toISOString(), to: now.toISOString(), resetsAt: renews.toISOString(), yearly, trialOver: false };
  }
  return { kind: "month", from: month.from, to: month.to, resetsAt: nextMonth, yearly: false, trialOver: false };
}

/** Billing summary for the period that counts right now (what limits and the console use). */
export async function getCurrentBillingSummary(appId: string): Promise<BillingSummary> {
  const window = await getUsageWindow(appId);
  const opts = { ...(window.from ? { from: window.from } : {}), to: window.to };
  const [plan, usage, bonus] = await Promise.all([getAppPlan(appId), getUsageBreakdown(appId, opts), getBonusMinutesSince(appId, window.from)]);
  return computeBillingSummary(appId, plan, usage, { from: window.from, to: window.to }, bonus, window);
}

/** Extra minutes an admin gave since `from` (all of them for the trial). */
export async function getBonusMinutesSince(appId: string, from: string | null) {
  const db = getPool();
  if (!db) return 0;
  try {
    const r = from
      ? await db.query("SELECT COALESCE(SUM(minutes),0)::int AS total FROM app_bonus_minutes WHERE app_id = $1 AND created_at >= $2", [appId, from])
      : await db.query("SELECT COALESCE(SUM(minutes),0)::int AS total FROM app_bonus_minutes WHERE app_id = $1", [appId]);
    return Number(r.rows[0]?.total ?? 0);
  } catch {
    return 0;
  }
}

/** Extra minutes an admin gave this project for the month of `from` (default: this month, UTC). */
export async function getBonusMinutes(appId: string, from?: string) {
  const db = getPool();
  if (!db) return 0;
  const month = (from ? new Date(from) : new Date()).toISOString().slice(0, 7);
  try {
    const r = await db.query("SELECT COALESCE(SUM(minutes),0)::int AS total FROM app_bonus_minutes WHERE app_id = $1 AND month = $2", [appId, month]);
    return Number(r.rows[0]?.total ?? 0);
  } catch {
    return 0; // table not migrated yet
  }
}

export async function maybeDispatchBillingAlert(
  appId: string,
  dispatch: (type: string, payload: Record<string, unknown>) => void
) {
  const key = appId;
  const now = Date.now();
  if (now - (lastAlertAt.get(key) ?? 0) < ALERT_COOLDOWN_MS) return;

  const summary = await getCurrentBillingSummary(appId);
  const alerts = checkThresholdAlerts(summary);
  if (!alerts.length) return;

  lastAlertAt.set(key, now);
  dispatch("billing.threshold", {
    appId,
    plan: summary.plan,
    alerts,
    usage: summary.usage,
    limits: summary.limits,
  });
}
