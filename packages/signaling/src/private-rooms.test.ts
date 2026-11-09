import test from "node:test";
import assert from "node:assert/strict";
import { mayJoinRoom } from "./private-rooms.js";
import { handleClientMessage } from "./handlers.js";
import { MemoryRoomStore } from "./store/memory.js";
import { MemoryRoomRoleStore } from "./room-roles.js";
import type { ClientMessage, ServerMessage, TokenClaims } from "@rtc/protocol";
import type { WebSocket } from "ws";

test("dm_ rooms are only for their two users", () => {
  assert.equal(mayJoinRoom("dm_alice__bob", "alice"), true);
  assert.equal(mayJoinRoom("dm_alice__bob", "bob"), true);
  assert.equal(mayJoinRoom("dm_bob__alice", "alice"), true); // either order
  assert.equal(mayJoinRoom("dm_alice__bob", "mallory"), false);
  assert.equal(mayJoinRoom("dm_alice__bob", "ali"), false);
  assert.equal(mayJoinRoom("dm_alice__bob", "alice__bob"), false);
  assert.equal(mayJoinRoom("dm_alice__alice", "alice"), false);
  assert.equal(mayJoinRoom("dm_alice", "alice"), false);
  assert.equal(mayJoinRoom("dm_a.b@x.com__c_d", "a.b@x.com"), true);
  assert.equal(mayJoinRoom("dm_a.b@x.com__c_d", "c_d"), true);
  assert.equal(mayJoinRoom("support-42", "anyone"), true);
  assert.equal(mayJoinRoom("grp_team", "anyone"), true);
});

function ctxFor(roomId: string, userId: string) {
  const sent: ServerMessage[] = [];
  return {
    message: { type: "join_room", payload: { roomId } } as ClientMessage,
    claims: { appId: "app", userId } as TokenClaims,
    ws: {} as WebSocket,
    rooms: new MemoryRoomStore(), roomRoles: new MemoryRoomRoleStore(),
    send: (_: WebSocket, m: ServerMessage) => { sent.push(m); },
    sendToUser: async () => true,
    dispatch: () => {},
    forceLeaveRoom: async () => {},
    sent,
  };
}

test("join_room refuses a stranger in a dm_ room and admits its members", async () => {
  const stranger = ctxFor("dm_alice__bob", "mallory");
  await handleClientMessage(stranger);
  assert.equal(stranger.sent[0].type, "error");
  assert.equal((stranger.sent[0].payload as { code?: string }).code, "private_room_denied");
  assert.equal(await stranger.rooms.isMember("dm_alice__bob", "mallory"), false);

  const member = ctxFor("dm_alice__bob", "bob");
  await handleClientMessage(member);
  assert.equal(member.sent[0].type, "room_joined");
  assert.equal(await member.rooms.isMember("dm_alice__bob", "bob"), true);
});
