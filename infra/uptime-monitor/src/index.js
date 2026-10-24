// RTCExpress uptime monitor: a Cloudflare Worker on a 5-minute cron.
// Emails the operator when a check goes down (after FAILS_BEFORE_ALERT
// consecutive failures) and again when it recovers. State lives in KV and is
// written only when it changes, to stay well inside the free-tier limits.
import { EmailMessage } from "cloudflare:email";

const CHECKS = [
  { id: "signaling", name: "Signaling API", url: "https://api.devsquarelabs.com/ready" },
  { id: "sfu", name: "Media SFU", url: "https://api.devsquarelabs.com/sfu/ready" },
];
const TIMEOUT_MS = 10_000;
const FAILS_BEFORE_ALERT = 2;

async function probe(check) {
  const started = Date.now();
  try {
    const res = await fetch(check.url, {
      headers: { "user-agent": "rtcexpress-uptime-monitor" },
      cf: { cacheTtl: 0 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    const ok = res.status === 200 && body?.ready === true;
    return { ok, detail: ok ? "ready" : `HTTP ${res.status}, ready=${body?.ready}`, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, detail: err.name === "TimeoutError" ? `timeout after ${TIMEOUT_MS / 1000}s` : String(err), ms: Date.now() - started };
  }
}

function stamp(iso) {
  const ist = new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
  return `${ist} IST (${iso})`;
}

function duration(fromIso, toIso) {
  const mins = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

async function sendEmail(env, subject, text) {
  const raw = [
    `From: RTCExpress Monitor <${env.ALERT_FROM}>`,
    `To: ${env.ALERT_TO}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${env.ALERT_FROM.split("@")[1]}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
  ].join("\r\n");
  await env.ALERT_EMAIL.send(new EmailMessage(env.ALERT_FROM, env.ALERT_TO, raw));
}

async function runChecks(env) {
  const now = new Date().toISOString();
  const results = await Promise.all(CHECKS.map(async (check) => ({ check, result: await probe(check) })));

  for (const { check, result } of results) {
    const key = `state:${check.id}`;
    const prev = await env.STATE.get(key, "json");

    if (!prev) {
      await env.STATE.put(key, JSON.stringify({ up: result.ok, fails: result.ok ? 0 : 1, since: now }));
      await sendEmail(env, `[RTCExpress] Monitoring started: ${check.name} is ${result.ok ? "UP" : "DOWN"}`,
        `Uptime monitoring is now active for ${check.name}.\n\nURL: ${check.url}\nCurrent status: ${result.ok ? "UP" : "DOWN"} (${result.detail}, ${result.ms} ms)\nTime: ${stamp(now)}\n\nYou will get one email when it goes down and one when it recovers.`);
      continue;
    }

    if (result.ok) {
      if (!prev.up) {
        await env.STATE.put(key, JSON.stringify({ up: true, fails: 0, since: now }));
        await sendEmail(env, `[RTCExpress] RECOVERED: ${check.name} is back up`,
          `${check.name} is responding again.\n\nURL: ${check.url}\nDown for: ${duration(prev.since, now)}\nRecovered: ${stamp(now)}\nResponse time: ${result.ms} ms`);
      } else if (prev.fails > 0) {
        await env.STATE.put(key, JSON.stringify({ ...prev, fails: 0 }));
      }
      continue;
    }

    if (!prev.up) continue; // already alerted; nothing to write
    const fails = prev.fails + 1;
    if (fails >= FAILS_BEFORE_ALERT) {
      await env.STATE.put(key, JSON.stringify({ up: false, fails, since: now }));
      await sendEmail(env, `[RTCExpress] DOWN: ${check.name} is not responding`,
        `${check.name} failed ${fails} checks in a row.\n\nURL: ${check.url}\nLast error: ${result.detail}\nDetected: ${stamp(now)}\n\nFirst things to check on the GCP VM:\n  sudo docker compose -f docker-compose.prod.yml ps\n  sudo docker compose -f docker-compose.prod.yml logs --tail=100\n\nYou will get another email when it recovers.`);
    } else {
      await env.STATE.put(key, JSON.stringify({ ...prev, fails }));
    }
  }
  return results.map(({ check, result }) => ({ id: check.id, ...result }));
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runChecks(env).then((r) => console.log(JSON.stringify(r))));
  },
};
