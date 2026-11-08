// Customer notices and owner alerts, sent through Resend (same setup as the account emails).
// Every function here is "best effort": it never throws, and returns what happened so the caller
// (and the admin panel) can show it.
export type EmailResult = "sent" | "not-configured" | "failed";

const escHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const configured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
const website = () => (process.env.PUBLIC_WEBSITE_URL || "https://rtc.devsquarelabs.com").replace(/\/+$/, "");

async function send(to: string[], subject: string, text: string, html?: string, replyTo?: string): Promise<EmailResult> {
  if (!configured() || !to.length) return "not-configured";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text, ...(html ? { html } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

// Same look as the verify/reset emails: logo, white card, one teal button.
function branded(title: string, paragraphs: string[], button?: { text: string; href: string }) {
  const site = escHtml(website());
  const font = "font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#F3F6F4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F6F4;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 0 20px 4px;${font}"><a href="${site}" style="text-decoration:none;color:#10261F;"><img src="${site}/apple-touch-icon.png" width="36" height="36" alt="" style="vertical-align:middle;border:0;border-radius:9px;"><span style="vertical-align:middle;font-size:20px;font-weight:700;color:#10261F;margin-left:10px;">RTCExpress</span></a></td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #DCE5DF;border-radius:14px;padding:36px 32px;${font}">
  <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#10261F;">${escHtml(title)}</h1>
  ${paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#42564E;">${p}</p>`).join("")}
  ${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;"><tr><td style="border-radius:10px;background:#087E72;"><a href="${escHtml(button.href)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;${font}">${escHtml(button.text)}</a></td></tr></table>` : ""}
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:#6B7D75;${font}">RTCExpress by Devsquare Labs · Chennai, India<br>Need help? Write to support@devsquarelabs.com</td></tr>
</table></td></tr></table></body></html>`;
}

const monthName = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const fmt = (n: number) => n.toLocaleString("en-US");

export function sendExtraMinutesEmail(to: string, minutes: number, month: string, newAllowance: number) {
  const m = monthName(month), consoleUrl = `${website()}/#/portal`;
  const title = `${fmt(minutes)} complimentary minutes added`;
  const lines = [
    `Good news: we've added <strong>${fmt(minutes)} complimentary call minutes</strong> to your RTCExpress project, free of charge.`,
    `Your call allowance is now <strong>${fmt(newAllowance)} minutes</strong>. You can see it any time on the Usage card in your console. The extra minutes apply to your current plan period only.`,
    "Thanks for building with RTCExpress.",
  ];
  return send([to], `${title} to your RTCExpress project`, `${lines.join("\n\n").replace(/<[^>]+>/g, "")}\n\nOpen your console: ${consoleUrl}`, branded(title, lines, { text: "Open your console", href: consoleUrl }));
}

/** 80%: "almost used up". 100%: "used up, new calls/messages are paused". Trial, monthly or yearly wording. */
export function sendUsageLimitEmail(
  to: string,
  u: { kind: "voice" | "video" | "messages"; level: 80 | 100; used: number; limit: number; planName: string; trial: boolean; yearly: boolean; resetsOn: string | null }
) {
  const billingUrl = `${website()}/#/portal/billing`;
  const what = u.kind === "messages" ? "chat messages" : `${u.kind} call minutes`;
  const action = u.kind === "messages" ? "chat messages" : `${u.kind} calls`;
  const where = u.trial ? "free trial" : u.yearly ? `${escHtml(u.planName)} plan for this year` : `${escHtml(u.planName)} plan for this billing month`;
  const pct = Math.min(99, Math.floor((u.used / u.limit) * 100));
  const title = u.level === 100
    ? (u.trial ? `Your free trial ${what} are used up` : `Your ${what} are used up`)
    : `You've used ${pct}% of your ${u.trial ? "free trial " : ""}${what}`;
  const usedLine = `Your RTCExpress project has used <strong>${fmt(Math.round(u.used))} of ${fmt(u.limit)}</strong> ${escHtml(what)} included in your ${where}.`;
  const lines = u.level === 100
    ? u.trial
      ? [usedLine, `<strong>New ${escHtml(action)} in your app are now paused.</strong> The free trial is one time only, so choose a plan to turn them back on (it takes effect within a minute).`, "Questions? Just reply to this email."]
      : [usedLine, `<strong>New ${escHtml(action)} in your app are paused until ${escHtml(u.resetsOn || "your plan renews")}</strong>, when your plan renews. Anything already running was not cut.`, "To continue right away, buy a minute pack (one-time: +20,000 voice minutes for $6, or +5,000 video minutes for $8 on Pro) or upgrade your plan in the console. Either takes effect within a minute. Questions? Just reply to this email."]
    : u.trial
      ? [usedLine, `When it is used up, new ${escHtml(action)} in your app will stop. The free trial is one time only.`, "Choose a plan before then so your users aren't interrupted."]
      : [usedLine, `When all ${fmt(u.limit)} are used, <strong>new ${escHtml(action)} in your app will stop until ${escHtml(u.resetsOn || "your plan renews")}</strong>.`, "If you expect more usage before then, buy a minute pack or upgrade your plan in the console to avoid a pause for your users."];
  return send(
    [to],
    title,
    `${lines.join("\n\n").replace(/<[^>]+>/g, "")}\n\nPlans: ${billingUrl}`,
    branded(title, lines, { text: u.level === 100 ? (u.trial ? "Choose a plan" : "Buy minutes or upgrade") : "See options", href: billingUrl }),
    "support@devsquarelabs.com"
  );
}

export function sendPlanChangedEmail(to: string, planName: string, upgrade: boolean) {
  const consoleUrl = `${website()}/#/portal`;
  const title = upgrade ? `You're now on the ${planName} plan` : `Your plan is now ${planName}`;
  const lines = upgrade
    ? [`We've moved your RTCExpress project to the <strong>${escHtml(planName)}</strong> plan, <strong>complimentary from our side</strong>. No payment was taken.`, "The new features and allowances are active right away. Open your console to see what's included."]
    : [`Your RTCExpress project is now on the <strong>${escHtml(planName)}</strong> plan.`, "If you didn't expect this, just reply to this email or write to support@devsquarelabs.com."];
  return send([to], title, `${lines.join("\n\n").replace(/<[^>]+>/g, "")}\n\nOpen your console: ${consoleUrl}`, branded(title, lines, { text: "Open your console", href: consoleUrl }));
}

/** Where owner alerts go: SIGNUP_ALERT_TO, else ENQUIRY_ALERT_TO, else the owner admin emails. */
export function ownerAlertRecipients() {
  const raw = process.env.SIGNUP_ALERT_TO || process.env.ENQUIRY_ALERT_TO || process.env.ADMIN_EMAILS || "";
  return raw.split(",").map((e) => e.trim()).filter(Boolean);
}

export function sendNewSignupAlert(a: { accountId: string; email: string; name: string | null; company: string | null; source?: string; ip?: string; device?: string }) {
  const adminUrl = `${(process.env.ADMIN_PANEL_URL || "https://api.devsquarelabs.com/admin/").replace(/#.*$/, "")}#/customers/${a.accountId}`;
  const rows: [string, string][] = [["Email", a.email], ["Name", a.name || "Not given"], ["Company", a.company || "Not given"], ["Came from", a.source || "Not known"], ["IP", a.ip || "—"], ["Device", a.device || "—"]];
  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:15px;">${rows.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6B7D75;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:6px 0;color:#10261F;">${escHtml(v)}</td></tr>`).join("")}</table>`;
  const title = "New RTCExpress sign-up";
  return send(
    ownerAlertRecipients(),
    `New sign-up: ${a.email}`,
    `${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nOpen in the admin panel: ${adminUrl}`,
    branded(title, ["Someone just created a free RTCExpress account.", table], { text: "Open in admin panel", href: adminUrl }),
    a.email
  );
}

/** Plain email to the owner alert address(es) (weekly summary etc.). */
export function sendOwnerEmail(subject: string, text: string, html: string) {
  return send(ownerAlertRecipients(), subject, text, html);
}
