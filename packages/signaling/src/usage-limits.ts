// Monthly minute allowances are real limits: when a project has used all its voice (or video)
// minutes for the month, new calls are refused with a clear message until the next month, an
// upgrade, or extra minutes. Calls already running are never cut. The account owner gets an
// email at 80% and at 100% (once per month per kind).
import { getPool } from "./db.js";
import { getBillingSummary, type BillingSummary } from "./billing.js";
import { currentMonth } from "./usage-period.js";
import { sendUsageLimitEmail } from "./notify-email.js";

export type MinuteKind = "voice" | "video";

export interface MinuteCheck {
  allowed: boolean;
  used: number;
  limit: number;
  message?: string;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; result: MinuteCheck }>();

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const nextMonthName = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
};

/** Forget cached usage for a project (after a plan change or extra minutes). */
export function clearMinuteCache(appId?: string) {
  if (!appId) cache.clear();
  else for (const key of [...cache.keys()]) if (key.startsWith(`${appId}:`)) cache.delete(key);
}

/** Can this project start another call of this kind this month? Cached for a minute. */
export async function checkMinutes(
  appId: string,
  kind: MinuteKind,
  loadSummary: (appId: string) => Promise<BillingSummary> = (id) => getBillingSummary(id, currentMonth())
): Promise<MinuteCheck> {
  const key = `${appId}:${kind}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;
  let result: MinuteCheck;
  try {
    const summary = await loadSummary(appId);
    const status = kind === "video" ? summary.limitStatus.videoMinutes : summary.limitStatus.voiceMinutes;
    // A 0 allowance means the plan doesn't include it: the plan-feature check already handles that.
    const allowed = status.limit <= 0 || status.used < status.limit;
    result = {
      allowed,
      used: status.used,
      limit: status.limit,
      message: allowed
        ? undefined
        : `This app has used all its ${kind} call minutes for this month (${fmt(status.used)} of ${fmt(status.limit)}). ` +
          `Calls start again on ${nextMonthName()}, or the app owner can upgrade the plan in the RTCExpress console.`,
    };
  } catch {
    // Never block calls because usage could not be read (database hiccup).
    result = { allowed: true, used: 0, limit: 0 };
  }
  cache.set(key, { at: Date.now(), result });
  return result;
}

const lastCheck = new Map<string, number>();

/**
 * Email the account owner when voice/video minutes cross 80% or 100% this month. Each level is
 * sent once per month (a database row makes that true even with several server instances).
 */
export async function maybeSendUsageEmails(appId: string) {
  const now = Date.now();
  if (now - (lastCheck.get(appId) ?? 0) < 30_000) return;
  lastCheck.set(appId, now);
  const db = getPool();
  if (!db) return;
  try {
    const month = new Date().toISOString().slice(0, 7);
    const summary = await getBillingSummary(appId, currentMonth());
    for (const kind of ["voice", "video"] as const) {
      const status = kind === "video" ? summary.limitStatus.videoMinutes : summary.limitStatus.voiceMinutes;
      if (status.limit <= 0) continue;
      const level = status.used >= status.limit ? 100 : status.percent >= 80 ? 80 : 0;
      if (!level) continue;
      if (level === 100) clearMinuteCache(appId); // refuse new calls right away
      const claimed = await db.query(
        `INSERT INTO usage_alert_log (app_id, month, metric, level) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING RETURNING app_id`,
        [appId, month, `${kind}Minutes`, level]
      );
      if (!claimed.rowCount) continue;
      const owner = await db.query("SELECT email FROM customer_accounts WHERE app_id = $1", [appId]);
      const email = owner.rows[0]?.email as string | undefined;
      if (!email) continue;
      const result = await sendUsageLimitEmail(email, {
        kind,
        level,
        used: status.used,
        limit: status.limit,
        planName: summary.planName,
        month,
        resetsOn: nextMonthName(),
      });
      await db.query(
        "UPDATE usage_alert_log SET result = $5 WHERE app_id = $1 AND month = $2 AND metric = $3 AND level = $4",
        [appId, month, `${kind}Minutes`, level, result]
      );
    }
  } catch {
    // Best effort: a failed email must never break a call.
  }
}
