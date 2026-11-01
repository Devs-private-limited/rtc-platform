import test from "node:test";
import assert from "node:assert/strict";
import { tokenHash, requestAccountLink, consumeAccountLink } from "./account-security.js";
import { isValidPassword } from "./customers.js";
import { getPool, closeDb } from "./db.js";
import { requirePortalUser } from "./portal-auth.js";
import { issueToken } from "./auth.js";
import Fastify from "fastify";

test("password validation does not permit bcrypt truncation", () => {
  assert.equal(isValidPassword("a".repeat(72)), true);
  assert.equal(isValidPassword("a".repeat(73)), false);
  assert.equal(isValidPassword("🙂".repeat(19)), false);
  assert.equal(isValidPassword("short"), false);
});

test("email links store a hash, use the configured website, and expire", async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: "postgresql://unused/test", RESEND_API_KEY: "test-only", EMAIL_FROM: "test@example.com", PUBLIC_WEBSITE_URL: "https://example.com" });
  t.after(async () => { await closeDb(); for (const key of ["DATABASE_URL","RESEND_API_KEY","EMAIL_FROM","PUBLIC_WEBSITE_URL"]) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  let savedHash = ""; let emailText = "";
  t.mock.method(getPool()!, "query", async (sql: string, args: unknown[]) => {
    if (sql.startsWith("SELECT")) return { rowCount: 1, rows: [{ id: "account", email: "person@example.com" }] };
    assert.match(sql, /30 minutes/); savedHash = String(args[0]); return { rowCount: 1, rows: [] };
  });
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://api.resend.com/emails"); emailText = JSON.parse(options.body as string).text;
    return new Response('{"id":"mail"}', { status: 200 });
  });
  await requestAccountLink("person@example.com", "reset");
  const token = emailText.match(/token=([a-f0-9]{64})/)![1];
  assert.match(emailText, /https:\/\/example.com\/#\/account\/reset/);
  assert.equal(savedHash, tokenHash(token)); assert.notEqual(savedHash, token);
  await assert.rejects(consumeAccountLink("bad-token", "verify"), /Invalid/);
});

test("password/secret session version changes revoke old portal tokens", async (t) => {
  const previous = process.env.DATABASE_URL; process.env.DATABASE_URL = "postgresql://unused/test";
  t.after(async () => { await closeDb(); if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; });
  t.mock.method(getPool()!, "query", async () => ({ rows: [{ portal_version: 2 }] }));
  const app = Fastify(); t.after(() => app.close());
  app.get("/private", async (req, reply) => { if (await requirePortalUser(req, reply, "test")) return { ok: true }; });
  const request = (version: number) => app.inject({ url: "/private", headers: { authorization: `Bearer ${issueToken({ appId: "a", userId: "__portal__", sessionVersion: version }, "test")}` } });
  assert.equal((await request(1)).statusCode, 401);
  assert.equal((await request(2)).statusCode, 200);
});

test("verification email: public page refuses it; console sends it only to the signed-in customer's own email", async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: "postgresql://unused/test", RESEND_API_KEY: "test-only", EMAIL_FROM: "test@example.com", PUBLIC_WEBSITE_URL: "https://example.com" });
  t.after(async () => { await closeDb(); for (const key of ["DATABASE_URL","RESEND_API_KEY","EMAIL_FROM","PUBLIC_WEBSITE_URL"]) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  let verified = false; const sentTo: string[] = [];
  t.mock.method(getPool()!, "query", async (sql: string) => {
    if (sql.includes("portal_version")) return { rowCount: 1, rows: [{ portal_version: 0 }] };
    if (sql.includes("WHERE app_id")) return { rowCount: 1, rows: [{ id: "acc", email: "owner@example.com", name: null, company: null, app_id: "app-v", created_at: "2026-11-01", email_verified_at: verified ? "2026-11-01" : null }] };
    if (sql.startsWith("SELECT")) return { rowCount: 1, rows: [{ id: "acc", email: "owner@example.com" }] };
    return { rowCount: 1, rows: [] };
  });
  t.mock.method(globalThis, "fetch", async (_url: string, options: RequestInit) => { sentTo.push(...JSON.parse(options.body as string).to); return new Response("{}", { status: 200 }); });
  const { registerAccountSecurityRoutes } = await import("./routes/account-security.js");
  const app = Fastify(); t.after(() => app.close()); await registerAccountSecurityRoutes(app, "test");
  const publicVerify = await app.inject({ method: "POST", url: "/v1/auth/email-link", payload: { email: "owner@example.com", purpose: "verify" } });
  assert.equal(publicVerify.statusCode, 400); assert.equal(sentTo.length, 0);
  const auth = { authorization: `Bearer ${issueToken({ appId: "app-v", userId: "__portal__", sessionVersion: 0 }, "test")}` };
  assert.equal((await app.inject({ method: "POST", url: "/v1/portal/send-verification" })).statusCode, 401);
  const sent = await app.inject({ method: "POST", url: "/v1/portal/send-verification", headers: auth });
  assert.equal(sent.statusCode, 200); assert.deepEqual(sentTo, ["owner@example.com"]);
  verified = true;
  const already = await app.inject({ method: "POST", url: "/v1/portal/send-verification", headers: auth });
  assert.equal(already.json().verified, true); assert.equal(sentTo.length, 1);
});
