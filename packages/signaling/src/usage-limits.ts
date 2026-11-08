// Usage limits are real limits:
// - Free is a one-time trial (voice minutes + chat messages for the life of the project). When it
//   is used up, or once the project has ever paid, nothing more is included until a plan is bought.
// - Paid plans: the allowance is per paid month (yearly: 12x for the whole year), counted from the
//   customer's own payment date, and starts again when Dodo confirms the next payment.
// When something is used up, new calls / group joins / messages are refused with a clear message.
// Calls already running are never cut. The account owner is emailed at 80% and 100%.
import { getPool } from "./db.js";
import { getDemoAppId } from "./apps.js";
import { getCurrentBillingSummary, type BillingSummary } from "./billing.js";
import { sendUsageLimitEmail } from "./notify-email.js";

export type MinuteKind = "voice" | "video";
export type LimitKind = MinuteKind | "messages";

export interface LimitCheck {
  allowed: boolean;
  used: number;
  limit: number;
  message?: string;
}
/** @deprecated name kept for imports */
export type MinuteCheck = LimitCheck;

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; result: LimitCheck }>();

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const noun = (kind: LimitKind) => (kind === "messages" ? "chat messages" : `${kind} call minutes`);

/** Forget cached usage for a project (after a plan change or extra minutes). */
export function clearMinuteCache(appId?: string) {
  if (!appId) cache.clear();
  else for (const key of [...cache.keys()]) if (key.startsWith(`${appId}:`)) cache.delete(key);
}

function statusFor(summary: BillingSummary, kind: LimitKind) {
  const s = summary.limitStatus;
  return kind === "video" ? s.videoMinutes : kind === "messages" ? s.messages : s.voiceMinutes;
}

/** Why the limit applies and when it comes back, in plain words for the caller's app. */
export function limitMessage(summary: BillingSummary, kind: LimitKind): string {
  const w = summary.window;
  const status = statusFor(summary, kind);
  if (w?.trialOver) {
    return `This app's free trial has ended and it has no active plan. The app owner can choose a plan in the RTCExpress console to turn ${noun(kind)} back on.`;
  }
  const used = `(${fmt(status.used)} of ${fmt(status.limit)})`;
  if (!w || w.kind === "trial") {
    return `This app has used all the ${noun(kind)} in its free trial ${used}. The app owner can choose a plan in the RTCExpress console to continue.`;
  }
  const when = w.resetsAt ? day(w.resetsAt) : "the next period";
  const period = w.kind === "subscription" ? (w.yearly ? "this year" : "this billing month") : "this month";
  return `This app has used all its ${noun(kind)} for ${period} ${used}. They start again on ${when} when the plan renews, or the app owner can upgrade in the RTCExpress console.`;
}

/** Decide from a billing summary (pure: easy to test). */
export function decide(summary: BillingSummary, kind: LimitKind): LimitCheck {
  const status = statusFor(summary, kind);
  if (summary.window?.trialOver) return { allowed: false, used: status.used, limit: 0, message: limitMessage(summary, kind) };
  // A 0 allowance on a paid plan means the plan doesn't include it: the plan-feature check handles that.
  const allowed = status.limit <= 0 || status.used < status.limit;
  return { allowed, used: status.used, limit: status.limit, message: allowed ? undefined : limitMessage(summary, kind) };
}

/** Can this project start another call / send another message now? Cached for a minute. */
export async function checkMinutes(
  appId: string,
  kind: LimitKind,
  loadSummary: (appId: string) => Promise<BillingSummary> = getCurrentBillingSummary
): Promise<LimitCheck> {
  // Our own public demo (web demo + demo APKs) is not a customer project: never limit it.
  if (appId === getDemoAppId()) return { allowed: true, used: 0, limit: 0 };
  const key = `${appId}:${kind}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  let result: LimitCheck;
  try {
    result = decide(await loadSummary(appId), kind);
  } catch {
    // Never block because usage could not be read (database hiccup).
    result = { allowed: true, used: 0, limit: 0 };
  }
  cache.set(key, { at: Date.now(), result });
  return result;
}

const lastCheck = new Map<string, number>();

/**
 * Email the account owner when voice/video minutes or chat messages cross 80% or 100% of the
 * current allowance (trial, paid month or paid year). Each level is sent once per period
 * (a database row makes that true even with several server instances).
 */
export async function maybeSendUsageEmails(appId: string) {
  const now = Date.now();
  if (now - (lastCheck.get(appId) ?? 0) < 30_000) return;
  lastCheck.set(appId, now);
  const db = getPool();
  if (!db) return;
  try {
    const summary = await getCurrentBillingSummary(appId);
    const w = summary.window;
    if (!w || w.trialOver) return;
    const base = w.kind === "trial" ? "trial" : (w.from || "").slice(0, 10);
    for (const kind of ["voice", "video", "messages"] as const) {
      const status = statusFor(summary, kind);
      if (status.limit <= 0) continue;
      // Keyed by the allowance too: after a minute pack, a new 80% / 100% email can follow.
      const periodKey = `${base}:${status.limit}`;
      const level = status.used >= status.limit ? 100 : status.percent >= 80 ? 80 : 0;
      if (!level) continue;
      if (level === 100) clearMinuteCache(appId); // refuse right away
      const metric = kind === "messages" ? "messages" : `${kind}Minutes`;
      const claimed = await db.query(
        `INSERT INTO usage_alert_log (app_id, period, metric, level) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING RETURNING app_id`,
        [appId, periodKey, metric, level]
      );
      if (!claimed.rowCount) continue;
      const owner = await db.query("SELECT email FROM customer_accounts WHERE app_id = $1", [appId]);
      const email = owner.rows[0]?.email as string | undefined;
      if (!email) continue;
      const result = await sendUsageLimitEmail(email, {
        kind,
        level: level as 80 | 100,
        used: status.used,
        limit: status.limit,
        planName: summary.planName,
        trial: w.kind === "trial",
        yearly: w.yearly,
        resetsOn: w.resetsAt ? day(w.resetsAt) : null,
      });
      await db.query(
        "UPDATE usage_alert_log SET result = $5 WHERE app_id = $1 AND period = $2 AND metric = $3 AND level = $4",
        [appId, periodKey, metric, level, result]
      );
    }
  } catch {
    // Best effort: a failed email must never break a call.
  }
}
