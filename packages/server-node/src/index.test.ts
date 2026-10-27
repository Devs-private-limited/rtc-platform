import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, test } from "node:test";
import { RTCExpressError, RTCExpressServer } from "./index.ts";

let server: Server;
let baseUrl = "";
let lastBody: Record<string, unknown> = {};
let reply: { status: number; body: unknown } = { status: 200, body: {} };

const readJson = (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(JSON.parse(data || "{}")));
  });

before(async () => {
  server = createServer(async (req, res) => {
    lastBody = await readJson(req);
    assert.equal(req.method, "POST");
    assert.equal(req.url, "/v1/token");
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

after(() => server.close());

beforeEach(() => {
  lastBody = {};
  reply = { status: 200, body: { token: "tok_123", expiresIn: 3600 } };
});

const client = () => new RTCExpressServer({ appId: "app_1", appSecret: "secret_1", serverUrl: baseUrl });

test("createToken sends credentials and options, returns the token", async () => {
  const result = await client().createToken({ userId: "alice", roomId: "support-42", role: "host" });
  assert.deepEqual(result, { token: "tok_123", expiresIn: 3600 });
  assert.deepEqual(lastBody, { appId: "app_1", appSecret: "secret_1", userId: "alice", roomId: "support-42", role: "host" });
});

test("optional fields are left out when not given", async () => {
  await client().createToken({ userId: "bob" });
  assert.deepEqual(lastBody, { appId: "app_1", appSecret: "secret_1", userId: "bob" });
});

test("API errors become RTCExpressError with the status and message", async () => {
  reply = { status: 401, body: { error: "Invalid app credentials" } };
  await assert.rejects(client().createToken({ userId: "alice" }), (err: unknown) => {
    assert.ok(err instanceof RTCExpressError);
    assert.equal(err.status, 401);
    assert.equal(err.message, "Invalid app credentials");
    return true;
  });
});

test("rate limiting surfaces as status 429", async () => {
  reply = { status: 429, body: { error: "Too many token requests" } };
  await assert.rejects(client().createToken({ userId: "alice" }), { name: "RTCExpressError", status: 429 });
});

test("a malformed success response is rejected", async () => {
  reply = { status: 200, body: { nope: true } };
  await assert.rejects(client().createToken({ userId: "alice" }), { message: "Unexpected response from RTCExpress" });
});

test("network failures become status 0", async () => {
  const offline = new RTCExpressServer({ appId: "a", appSecret: "s", serverUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
  await assert.rejects(offline.createToken({ userId: "alice" }), { name: "RTCExpressError", status: 0 });
});

test("missing required values fail before any request", async () => {
  assert.throws(() => new RTCExpressServer({ appId: "", appSecret: "s" }), /appId is required/);
  assert.throws(() => new RTCExpressServer({ appId: "a", appSecret: "" }), /appSecret is required/);
  await assert.rejects(client().createToken({ userId: "" }), /userId is required/);
});
