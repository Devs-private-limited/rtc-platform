import type { FastifyInstance } from "fastify";
import { emailConfigured, requestAccountLink, consumeAccountLink, changeAccountSecurity } from "../account-security.js";
import { requirePortalUser } from "../portal-auth.js";
import { rateLimit } from "../rate-limit.js";
import { isValidEmail } from "../leads.js";
import { getCustomerByAppId } from "../customers.js";

export async function registerAccountSecurityRoutes(app: FastifyInstance, secret: string) {
  app.post<{ Body: { email?: string; purpose?: string } }>("/v1/auth/email-link", async (req, reply) => {
    const { email, purpose } = req.body || {};
    // Public: password reset only (a signed-out customer can't use the console). Email verification is
    // requested from the console, where it can only go to the signed-in customer's own address.
    if (purpose === "verify") return reply.status(400).send({ error: "Sign in to your console to verify your email." });
    if (typeof email !== "string" || !isValidEmail(email) || purpose !== "reset") return reply.status(400).send({ error: "Valid email required" });
    if (!rateLimit(`email-ip:${req.ip}`, 10, 900000) || !rateLimit(`email-address:${email.trim().toLowerCase()}`, 3, 900000)) return reply.status(429).send({ error: "Please wait before requesting another email" });
    if (!emailConfigured()) return reply.status(503).send({ error: "Account email delivery is not configured yet. Contact support." });
    try { await requestAccountLink(email.trim(), "reset"); }
    catch { req.log.error("Account email request failed; check provider configuration"); }
    return { message: "If an account exists for this email, a link will be sent. Check your inbox and spam folder." };
  });
  app.post<{ Body: { token?: string; purpose?: string; password?: string } }>("/v1/auth/consume-link", async (req, reply) => {
    if (!rateLimit(`consume:${req.ip}`, 20, 900000)) return reply.status(429).send({ error: "Too many attempts" });
    const { token, purpose, password } = req.body || {};
    if (typeof token !== "string" || (purpose !== "verify" && purpose !== "reset")) return reply.status(400).send({ error: "Invalid link" });
    try { await consumeAccountLink(token, purpose, password); return { message: purpose === "verify" ? "Email verified." : "Password reset. Sign in with your new password." }; }
    catch (error) { return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to use link" }); }
  });
  app.post("/v1/portal/send-verification", async (req, reply) => {
    const claims = await requirePortalUser(req, reply, secret); if (!claims) return;
    const customer = await getCustomerByAppId(claims.appId);
    if (!customer) return reply.status(404).send({ error: "Account not found" });
    if (customer.emailVerified) return { verified: true, message: "Your email is already verified." };
    if (!emailConfigured()) return reply.status(503).send({ error: "Email sending is not set up yet. Contact support." });
    if (!rateLimit(`verify-send:${claims.appId}`, 3, 900000)) return reply.status(429).send({ error: "Email already sent. Check your inbox and spam folder, or try again in 15 minutes." });
    try { await requestAccountLink(customer.email, "verify"); }
    catch { req.log.error("Verification email failed; check provider configuration"); return reply.status(502).send({ error: "Could not send the email right now. Try again in a few minutes." }); }
    return { verified: false, message: `Verification email sent to ${customer.email}. The link works for 30 minutes.` };
  });

  for (const action of ["password", "rotate-secret"] as const) {
    app.post<{ Body: { currentPassword?: string; newPassword?: string } }>(`/v1/portal/${action}`, async (req, reply) => {
      const claims = await requirePortalUser(req, reply, secret); if (!claims) return;
      if (!rateLimit(`security:${claims.appId}`, 5, 900000)) return reply.status(429).send({ error: "Too many attempts" });
      const { currentPassword, newPassword } = req.body || {};
      if (typeof currentPassword !== "string" || currentPassword.length > 128 || (action === "password" && typeof newPassword !== "string")) return reply.status(400).send({ error: "Account password required" });
      try { const result = await changeAccountSecurity(claims.appId, currentPassword, action === "password" ? newPassword : undefined); reply.header("Cache-Control", "no-store"); return { ...result, message: "Updated. All portal sessions have been signed out. Existing RTC tokens remain valid until expiry." }; }
      catch (error) { return reply.status(400).send({ error: error instanceof Error ? error.message : "Unable to update account" }); }
    });
  }
}
