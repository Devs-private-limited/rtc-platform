import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendCallPush, sendMissedCallPush, MISSED_CALL_TTL_SECONDS } from "./push.js";
import { getPool, closeDb } from "./db.js";
import { registerRinging, resetCallState } from "./call-state.js";

test("push credentials and tokens remain scoped to their project and expired devices are removed", async (t) => {
  const previousDb = process.env.DATABASE_URL, previousConfig = process.env.FCM_CONFIG_FILE;
  const dir = await mkdtemp(join(tmpdir(), "rtc-push-test-")); const file = join(dir, "credentials.json");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(file, JSON.stringify({ app: { project_id: "test-project", client_email: "test@example.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }) } }), { mode: 0o600 });
  process.env.DATABASE_URL = "postgresql://unused/test"; process.env.FCM_CONFIG_FILE = file;
  t.after(async () => { await closeDb(); await unlink(file); await rmdir(dir); resetCallState();
    if (previousDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDb;
    if (previousConfig === undefined) delete process.env.FCM_CONFIG_FILE; else process.env.FCM_CONFIG_FILE = previousConfig;
  });
  let removed = false; const sends: string[] = [];
  t.mock.method(getPool()!, "query", async (sql: string, args: unknown[]) => {
    if (sql.includes("FROM push_credentials")) return { rows: [] };
    if (args[0] === 'other-app') return { rowCount:0,rows:[] };
    assert.equal(args[0], "app");
    if (sql.startsWith("SELECT")) { assert.equal(args[1], "bob"); return { rowCount: 1, rows: [{ installation_id: "device", token: "device-token" }] }; }
    if (sql.startsWith("DELETE")) { assert.equal(args[2], "device-token"); removed = true; }
    return { rowCount: 1, rows: [] };
  });
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    sends.push(url);
    if (url.includes("oauth2")) return new Response('{"access_token":"test-access","expires_in":3600}');
    const message = JSON.parse(options.body as string).message;
    assert.equal(message.token, "device-token"); assert.equal(message.data.callId, "call");
    assert.equal(message.android.priority, "HIGH"); assert.match(message.android.ttl, /^\d+s$/);
    return new Response('{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}', { status: 404 });
  });
  resetCallState(); registerRinging("app", "call", "room", "alice", "bob");
  await sendCallPush("other-app", { toUserId: "bob", callId: "call" }); assert.equal(sends.length, 0);
  await sendCallPush("app", { toUserId: "bob", callId: "call" }); assert.equal(sends.length, 2); assert.equal(removed, true);
});

test("missed-call alerts go to the callee's alert devices as a visible notification kept for a day", async (t) => {
  const previousDb = process.env.DATABASE_URL, previousConfig = process.env.FCM_CONFIG_FILE;
  const dir = await mkdtemp(join(tmpdir(), "rtc-missed-test-")); const file = join(dir, "credentials.json");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await writeFile(file, JSON.stringify({ app: { project_id: "test-project", client_email: "missed@example.com", private_key: privateKey.export({ format: "pem", type: "pkcs8" }) } }), { mode: 0o600 });
  process.env.DATABASE_URL = "postgresql://unused/test"; process.env.FCM_CONFIG_FILE = file;
  t.after(async () => { await closeDb(); await unlink(file); await rmdir(dir);
    if (previousDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDb;
    if (previousConfig === undefined) delete process.env.FCM_CONFIG_FILE; else process.env.FCM_CONFIG_FILE = previousConfig;
  });
  const recorded: unknown[][] = []; let sent: Record<string, any> | null = null;
  t.mock.method(getPool()!, "query", async (sql: string, args: unknown[]) => {
    if (sql.includes("FROM push_credentials")) return { rows: [] };
    if (sql.startsWith("SELECT")) {
      assert.equal(args[0], "app"); assert.equal(args[1], "bob"); assert.match(sql, /push_type = 'alert'/);
      return { rowCount: 1, rows: [{ installation_id: "device", token: "alert-token", platform: "android" }] };
    }
    if (sql.startsWith("INSERT INTO push_deliveries")) recorded.push(args);
    return { rowCount: 1, rows: [] };
  });
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.includes("oauth2")) return new Response('{"access_token":"test-access","expires_in":3600}');
    sent = JSON.parse(options.body as string).message;
    return new Response("{}", { status: 200 });
  });
  await sendMissedCallPush("app", { callId: "call-9", roomId: "ride-1", callerUserId: "alice", calleeUserId: "bob", callType: "voice" });
  assert.ok(sent, "an FCM message was sent");
  assert.equal(sent!.token, "alert-token");
  assert.equal(sent!.data.type, "rtc_missed_call");
  assert.equal(sent!.data.fromUserId, "alice");
  assert.equal(sent!.data.callId, "call-9");
  assert.equal(sent!.notification.title, "Missed call");
  assert.equal(sent!.android.ttl, `${MISSED_CALL_TTL_SECONDS}s`);
  assert.equal(MISSED_CALL_TTL_SECONDS, 86400);
  assert.equal(recorded.length, 1); assert.equal(recorded[0][1], "call-9"); assert.equal(recorded[0][3], true); assert.equal(recorded[0][6], "alert");
});
