import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  clearCall,
  clearUserCalls,
  findUserCall,
  markCallConnected,
  registerRinging,
  resetCallState,
} from "./call-state.js";

describe("call-state", () => {
  beforeEach(() => {
    resetCallState();
  });

  it("registers a ringing call for both participants", () => {
    const result = registerRinging("app1", "call-1", "room-1", "alice", "bob");
    assert.equal(result.ok, true);
    assert.equal(findUserCall("app1", "alice")?.phase, "ringing");
    assert.equal(findUserCall("app1", "bob")?.phase, "ringing");
  });

  it("rejects when caller is already in a call", () => {
    registerRinging("app1", "call-1", "room-1", "alice", "bob");
    const result = registerRinging("app1", "call-2", "room-1", "alice", "carol");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.busyUserId, "alice");
  });

  it("rejects when callee is already in a call", () => {
    registerRinging("app1", "call-1", "room-1", "alice", "bob");
    const result = registerRinging("app1", "call-2", "room-1", "carol", "bob");
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.busyUserId, "bob");
  });

  it("marks a call connected and clears both users on end", () => {
    registerRinging("app1", "call-1", "room-1", "alice", "bob");
    markCallConnected("call-1");
    assert.equal(findUserCall("app1", "alice")?.phase, "connected");
    clearCall("call-1");
    assert.equal(findUserCall("app1", "alice"), null);
    assert.equal(findUserCall("app1", "bob"), null);
  });

  it("clears a user call on disconnect", () => {
    registerRinging("app1", "call-1", "room-1", "alice", "bob");
    clearUserCalls("app1", "alice");
    assert.equal(findUserCall("app1", "alice"), null);
    assert.equal(findUserCall("app1", "bob"), null);
  });
});
