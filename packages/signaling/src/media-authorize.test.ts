import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerMediaAuthorizeRoutes } from "./routes/media-authorize.js";
import { MemoryRoomStore } from "./store/memory.js";
import { MemoryRoomRoleStore } from "./room-roles.js";
import { scopedRooms, scopedRoles } from "./tenant-scope.js";
import { issueToken } from "./auth.js";
import { getPool, closeDb } from "./db.js";

test("media authorization enforces current plan, project membership, and host role", async (t) => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://unused/test";
  t.after(async () => { await closeDb(); if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; });
  let plan = "starter";
  t.mock.method(getPool()!, "query", async () => ({ rows: [{ plan }] }));
  const app = Fastify(); t.after(() => app.close());
  const rooms = new MemoryRoomStore(); const roomRoles = new MemoryRoomRoleStore();
  await scopedRooms(rooms, "app").join("room", "host");
  await scopedRooms(rooms, "app").join("room", "viewer");
  scopedRoles(roomRoles, "app").assign("room", "host", "host");
  scopedRoles(roomRoles, "app").assign("room", "viewer", "audience");
  await registerMediaAuthorizeRoutes(app, { jwtSecret: "test", rooms, roomRoles });
  async function status(action: string, userId = "host", appId = "app") {
    return (await app.inject({ method: "POST", url: "/v1/media/authorize", headers: { authorization: `Bearer ${issueToken({ appId, userId }, "test")}` }, payload: { roomId: "room", action } })).statusCode;
  }
  assert.equal(await status("audio"), 200);
  assert.equal(await status("video"), 403);
  plan = "pro";
  assert.equal(await status("video"), 200);
  assert.equal(await status("recording-start", "viewer"), 403);
  assert.equal(await status("audio", "viewer"), 403);
  assert.equal(await status("read", "viewer"), 200);
  assert.equal(await status("read", "host", "other-app"), 403);
  plan = "free";
  assert.equal(await status("read"), 403);
  assert.equal(await status("recording-stop"), 200);
});

test("1:1 call media rooms are allowed for the two callers only (paid plans use the SFU)", async (t) => {
  const { registerRinging, markCallConnected, resetCallState } = await import("./call-state.js");
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://unused/test";
  t.after(async () => { resetCallState(); await closeDb(); if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; });
  t.mock.method(getPool()!, "query", async () => ({ rows: [{ plan: "pro" }] }));
  const app = Fastify(); t.after(() => app.close());
  const rooms = new MemoryRoomStore(); const roomRoles = new MemoryRoomRoleStore();
  for (const u of ["ajay", "ravi", "other"]) { await scopedRooms(rooms, "app").join("step4-room", u); scopedRoles(roomRoles, "app").assign("step4-room", u, "publisher"); }
  await registerMediaAuthorizeRoutes(app, { jwtSecret: "test", rooms, roomRoles });
  const status = async (userId: string, roomId: string, action = "audio", tokenRoom: string | undefined = "step4-room") =>
    (await app.inject({ method: "POST", url: "/v1/media/authorize", headers: { authorization: `Bearer ${issueToken({ appId: "app", userId, ...(tokenRoom ? { roomId: tokenRoom } : {}) }, "test")}` }, payload: { roomId, action } })).statusCode;

  assert.equal(await status("ajay", "step4-room-call-c1"), 403, "no call yet");
  assert.deepEqual(registerRinging("app", "c1", "step4-room", "ajay", "ravi", "video"), { ok: true });
  markCallConnected("app", "c1");
  assert.equal(await status("ajay", "step4-room-call-c1"), 200);
  assert.equal(await status("ravi", "step4-room-call-c1", "video"), 200);
  assert.equal(await status("ravi", "step4-room-call-c1", "read", undefined), 200);
  assert.equal(await status("other", "step4-room-call-c1"), 403, "not in the call");
  assert.equal(await status("ajay", "step4-room-call-c2"), 403, "wrong call id");
  assert.equal(await status("ajay", "step4-room-call-c1", "audio", "another-room"), 403, "token for another room");
});
