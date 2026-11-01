import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getPool } from "./db.js";
import { isValidPassword } from "./customers.js";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export function emailConfigured() { return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM && process.env.PUBLIC_WEBSITE_URL); }

export async function requestAccountLink(email: string, purpose: "verify" | "reset") {
  const db = getPool(); if (!db) throw new Error("Database unavailable");
  if (!emailConfigured()) throw new Error("Account email delivery is not configured");
  const website = new URL(process.env.PUBLIC_WEBSITE_URL!);
  if (website.protocol !== "https:" && website.hostname !== "localhost") throw new Error("Website URL must use HTTPS");
  const found = await db.query(`SELECT id, email FROM customer_accounts WHERE LOWER(email) = $1`, [email.toLowerCase()]);
  if (!found.rowCount) return;
  const account = found.rows[0];
  const token = randomBytes(32).toString("hex");
  await db.query(`INSERT INTO account_tokens (token_hash, account_id, purpose, expires_at) VALUES ($1,$2,$3,NOW() + INTERVAL '30 minutes')`, [tokenHash(token), account.id, purpose]);
  website.hash = `/account/${purpose}?token=${token}`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [account.email], subject: purpose === "verify" ? "Verify your RTCExpress email" : "Reset your RTCExpress password",
        text: `Open this link to ${purpose === "verify" ? "verify your email" : "reset your password"}:\n${website.href}\n\nThis link expires in 30 minutes and can be used once. If you did not request it, ignore this email.\n\nRTCExpress by Devsquare Labs\n${website.origin}`,
        html: accountEmailHtml(purpose, website.href, website.origin) }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error("Email provider rejected delivery");
  } catch (error) {
    await db.query(`DELETE FROM account_tokens WHERE token_hash = $1`, [tokenHash(token)]);
    throw error;
  }
}

const escHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// Branded HTML email (table layout + inline styles so Gmail/Outlook show it the same way).
export function accountEmailHtml(purpose: "verify" | "reset", link: string, origin: string) {
  const verify = purpose === "verify";
  const title = verify ? "Confirm your email address" : "Reset your password";
  const intro = verify
    ? "Thanks for signing up for RTCExpress. Please confirm this is your email address, so billing receipts and account emails reach you."
    : "We received a request to reset the password for your RTCExpress account. Click the button below to choose a new one.";
  const button = verify ? "Verify my email" : "Set a new password";
  const href = escHtml(link), site = escHtml(origin);
  const font = "font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#F3F6F4;">
<div style="display:none;max-height:0;overflow:hidden;">${verify ? "One click to confirm your RTCExpress email." : "Choose a new RTCExpress password."}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F6F4;padding:32px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 0 20px 4px;${font}">
  <a href="${site}" style="text-decoration:none;color:#10261F;"><img src="${site}/apple-touch-icon.png" width="36" height="36" alt="" style="vertical-align:middle;border:0;border-radius:9px;"><span style="vertical-align:middle;font-size:20px;font-weight:700;color:#10261F;margin-left:10px;">RTCExpress</span></a>
</td></tr>
<tr><td style="background:#FFFFFF;border:1px solid #DCE5DF;border-radius:14px;padding:36px 32px;${font}">
  <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#10261F;">${title}</h1>
  <p style="margin:0 0 26px;font-size:16px;line-height:1.6;color:#42564E;">${intro}</p>
  <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#087E72;">
    <a href="${href}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;${font}">${button}</a>
  </td></tr></table>
  <p style="margin:26px 0 0;font-size:14px;line-height:1.6;color:#42564E;">This link expires in <strong>30 minutes</strong> and works once. If you didn't ${verify ? "create an RTCExpress account" : "ask for this"}, you can safely ignore this email.</p>
  <p style="margin:22px 0 0;padding-top:18px;border-top:1px solid #E1E8E3;font-size:13px;line-height:1.6;color:#6B7D75;">Button not working? Copy this link into your browser:<br><a href="${href}" style="color:#087E72;word-break:break-all;">${href}</a></p>
</td></tr>
<tr><td style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:#6B7D75;${font}">
  RTCExpress by Devsquare Labs · Chennai, India<br>
  Chat, voice and video SDKs for your app · <a href="${site}" style="color:#087E72;text-decoration:none;">${escHtml(new URL(origin).host)}</a><br>
  Need help? Write to support@devsquarelabs.com
</td></tr>
</table></td></tr></table></body></html>`;
}

export async function consumeAccountLink(token: string, purpose: "verify" | "reset", password?: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid or expired link");
  if (purpose === "reset" && !isValidPassword(password || "")) throw new Error("Password must be at least 8 characters and at most 72 UTF-8 bytes");
  const db = getPool(); if (!db) throw new Error("Database unavailable");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT t.account_id, ca.app_id FROM account_tokens t JOIN customer_accounts ca ON ca.id = t.account_id WHERE t.token_hash = $1 AND t.purpose = $2 AND t.expires_at > NOW() FOR UPDATE OF t, ca`, [tokenHash(token), purpose]);
    if (!found.rowCount) throw new Error("Invalid or expired link");
    const { account_id, app_id } = found.rows[0];
    if (purpose === "verify") await client.query(`UPDATE customer_accounts SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`, [account_id]);
    else {
      await client.query(`UPDATE customer_accounts SET password_hash = $1 WHERE id = $2`, [await bcrypt.hash(password!, 12), account_id]);
      await client.query(`UPDATE apps SET portal_version = portal_version + 1 WHERE app_id = $1`, [app_id]);
    }
    await client.query(`DELETE FROM account_tokens WHERE account_id = $1 AND purpose = $2`, [account_id, purpose]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function changeAccountSecurity(appId: string, currentPassword: string, newPassword?: string) {
  if (newPassword !== undefined && !isValidPassword(newPassword)) throw new Error("Password must be at least 8 characters and at most 72 UTF-8 bytes");
  const db = getPool(); if (!db) throw new Error("Database unavailable");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT id, password_hash FROM customer_accounts WHERE app_id = $1 FOR UPDATE`, [appId]);
    if (!found.rowCount || !await bcrypt.compare(currentPassword, found.rows[0].password_hash)) throw new Error("Current account password is incorrect");
    let appSecret: string | undefined;
    if (newPassword !== undefined) await client.query(`UPDATE customer_accounts SET password_hash = $1 WHERE app_id = $2`, [await bcrypt.hash(newPassword, 12), appId]);
    else {
      appSecret = `sec_${randomBytes(32).toString("hex")}`;
      await client.query(`UPDATE apps SET secret_hash = $1 WHERE app_id = $2`, [await bcrypt.hash(appSecret, 10), appId]);
    }
    await client.query(`UPDATE apps SET portal_version = portal_version + 1 WHERE app_id = $1`, [appId]);
    await client.query(`DELETE FROM account_tokens WHERE account_id = $1 AND purpose = 'reset'`, [found.rows[0].id]);
    await client.query("COMMIT"); return { appSecret };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
