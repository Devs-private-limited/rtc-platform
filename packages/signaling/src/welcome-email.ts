// Welcome email: sent once, automatically, right after a customer verifies their email.
// The owner edits the text in the admin panel (Emails page); until then the default below is used.
// Like the other customer emails it is "best effort": it never throws into the verify flow.
import { getPool } from "./db.js";
import { branded, escHtml, send, website, type EmailResult } from "./notify-email.js";

export interface WelcomeTemplate {
  enabled: boolean;
  subject: string;
  body: string;
  buttonText: string;
  buttonLink: string;
  replyTo: string;
}

export const WELCOME_PLACEHOLDERS = [
  ["{name}", "First name from sign-up (or “there” if not given)"],
  ["{project}", "Their project name"],
  ["{email}", "Their email address"],
  ["{console_link}", "Link to their console"],
  ["{docs_link}", "Link to the docs / quickstarts"],
] as const;

export const DEFAULT_WELCOME: WelcomeTemplate = {
  enabled: true,
  subject: "Welcome to RTCExpress: let's get your first call working",
  body: [
    "Hi {name},",
    "Thanks for verifying your email. Your RTCExpress project is ready, and your free trial includes 2,000 minutes of 1:1 voice calls and 10,000 chat messages. No card needed.",
    "The quickest way to see it working is to make a test call to yourself:\n1. Open your console and copy your App ID.\n2. Pick the quickstart for your platform (Web, Android, Flutter or React Native): {docs_link}\n3. Run it on two devices and call yourself.",
    "Most developers get their first call or chat message working in about 10 minutes.",
    "One quick question: what are you building, and which platform are you using? Just reply to this email and tell me. I read every reply and can send you the exact guide for your setup.",
    "The RTCExpress team",
  ].join("\n\n"),
  buttonText: "Open my console",
  buttonLink: "{console_link}",
  replyTo: "support@devsquarelabs.com",
};

export const LIMITS = { subject: 200, body: 5000, buttonText: 60, buttonLink: 500, replyTo: 320 };

/** Checks an edited template from the admin panel. Returns an error message, or null if it is fine. */
export function validateWelcome(t: Partial<WelcomeTemplate>): string | null {
  if (typeof t.enabled !== "boolean") return "Choose whether the email is on or off.";
  for (const k of ["subject", "body", "buttonText", "buttonLink", "replyTo"] as const) {
    if (typeof t[k] !== "string") return `Missing ${k}.`;
    if (t[k]!.length > LIMITS[k]) return `${k === "buttonText" ? "Button text" : k === "buttonLink" ? "Button link" : k === "replyTo" ? "Reply-to" : k[0].toUpperCase() + k.slice(1)} is too long (max ${LIMITS[k]} characters).`;
  }
  if (!t.subject!.trim()) return "Subject can't be empty.";
  if (!t.body!.trim()) return "The email text can't be empty.";
  if (t.buttonText!.trim() && !t.buttonLink!.trim()) return "Add a button link, or clear the button text to send without a button.";
  const link = t.buttonLink!.trim();
  if (link && !link.startsWith("{") && !/^https:\/\/[^\s]+$/i.test(link)) return "Button link must start with https:// (or be {console_link} / {docs_link}).";
  const reply = t.replyTo!.trim();
  if (reply && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(reply)) return "Reply-to must be one email address, or empty.";
  return null;
}

export async function getWelcomeTemplate(): Promise<{ template: WelcomeTemplate; isDefault: boolean; updatedBy: string | null; updatedAt: string | null }> {
  const db = getPool();
  if (db) {
    try {
      const r = await db.query(`SELECT enabled, subject, body, button_text, button_link, reply_to, updated_by, updated_at FROM email_templates WHERE key = 'welcome'`);
      if (r.rowCount) {
        const row = r.rows[0];
        return {
          template: { enabled: row.enabled, subject: row.subject, body: row.body, buttonText: row.button_text || "", buttonLink: row.button_link || "", replyTo: row.reply_to || "" },
          isDefault: false, updatedBy: row.updated_by, updatedAt: row.updated_at,
        };
      }
    } catch { /* table not there yet (old database or tests): use the default */ }
  }
  return { template: { ...DEFAULT_WELCOME }, isDefault: true, updatedBy: null, updatedAt: null };
}

export async function saveWelcomeTemplate(t: WelcomeTemplate, by: string) {
  const db = getPool(); if (!db) throw new Error("Database unavailable");
  await db.query(
    `INSERT INTO email_templates (key, enabled, subject, body, button_text, button_link, reply_to, updated_by, updated_at)
     VALUES ('welcome', $1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (key) DO UPDATE SET enabled = EXCLUDED.enabled, subject = EXCLUDED.subject, body = EXCLUDED.body,
       button_text = EXCLUDED.button_text, button_link = EXCLUDED.button_link, reply_to = EXCLUDED.reply_to,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [t.enabled, t.subject.trim(), t.body.trim(), t.buttonText.trim() || null, t.buttonLink.trim() || null, t.replyTo.trim() || null, by]
  );
}

export async function resetWelcomeTemplate() {
  const db = getPool(); if (!db) throw new Error("Database unavailable");
  await db.query(`DELETE FROM email_templates WHERE key = 'welcome'`);
}

export interface WelcomeVars { name: string | null; project: string | null; email: string }

function fill(text: string, v: WelcomeVars) {
  const first = (v.name || "").trim().split(/\s+/)[0];
  const values: Record<string, string> = {
    "{name}": first || "there",
    "{project}": (v.project || "").trim() || "your project",
    "{email}": v.email,
    "{console_link}": `${website()}/#/portal`,
    "{docs_link}": `${website()}/docs`,
  };
  return text.replace(/\{(name|project|email|console_link|docs_link)\}/g, (m) => values[m]);
}

const linkify = (escaped: string) => escaped.replace(/https:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" style="color:#087E72;">${u}</a>`);

/** Subject, plain text and branded HTML for one customer (also used for the admin preview and test email). */
export function renderWelcome(t: WelcomeTemplate, v: WelcomeVars) {
  const subject = fill(t.subject, v).replace(/[\r\n]+/g, " ").trim();
  const paragraphs = fill(t.body, v).replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const href = fill(t.buttonLink, v).trim();
  const button = t.buttonText.trim() && /^https:\/\//i.test(href) ? { text: fill(t.buttonText, v).trim(), href } : undefined;
  const html = branded(subject, paragraphs.map((p) => linkify(escHtml(p)).replace(/\n/g, "<br>")), button);
  const text = `${paragraphs.join("\n\n")}${button ? `\n\n${button.text}: ${button.href}` : ""}`;
  return { subject, text, html, replyTo: t.replyTo.trim() || undefined };
}

export type WelcomeResult = EmailResult | "disabled" | "already-sent" | "not-found";

/**
 * Sends the welcome email to one customer.
 * auto (after verifying): only if the email is switched on and they haven't had it before.
 * manual (admin "Send now"): always sends, even if they had it before or the automatic email is off.
 */
export async function sendWelcomeEmail(accountId: string, mode: "auto" | "manual"): Promise<WelcomeResult> {
  const db = getPool(); if (!db) return "failed";
  try {
    const { template } = await getWelcomeTemplate();
    if (mode === "auto" && !template.enabled) return "disabled";
    // Claim first, so two server instances (or a double click) can't send it twice.
    const claim = await db.query(
      `UPDATE customer_accounts c SET welcome_email_sent_at = NOW() FROM apps a
       WHERE c.id = $1 AND a.app_id = c.app_id ${mode === "auto" ? "AND c.welcome_email_sent_at IS NULL" : ""}
       RETURNING c.email, c.name, a.name AS project_name, (SELECT welcome_email_sent_at FROM customer_accounts WHERE id = $1) AS previous`,
      [accountId]
    );
    if (!claim.rowCount) {
      if (mode === "manual") return "not-found";
      const exists = await db.query(`SELECT 1 FROM customer_accounts WHERE id = $1`, [accountId]);
      return exists.rowCount ? "already-sent" : "not-found";
    }
    const row = claim.rows[0];
    const mail = renderWelcome(template, { name: row.name, project: row.project_name, email: row.email });
    const result = await send([row.email], mail.subject, mail.text, mail.html, mail.replyTo);
    // Not delivered: put the old value back so it shows as "not sent" and can be sent again.
    if (result !== "sent") await db.query(`UPDATE customer_accounts SET welcome_email_sent_at = $2 WHERE id = $1`, [accountId, row.previous]);
    return result;
  } catch {
    return "failed";
  }
}
