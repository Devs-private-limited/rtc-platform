import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyDemoRoom, verifyGoogleIdToken } from "./demo-rooms.js";

const CLIENT = "client.apps.googleusercontent.com";
const google = (info: object, ok = true) => async () => ({ ok, json: async () => info });
const future = Math.floor(Date.now() / 1000) + 600;

describe("demo rooms", () => {
  it("accepts a sorted private pair room", () => {
    assert.deepEqual(classifyDemoRoom("dm_111__222"), { kind: "pair", members: ["111", "222"] });
  });
  it("rejects unsorted or same-person pair rooms", () => {
    assert.equal(classifyDemoRoom("dm_222__111").kind, "invalid");
    assert.equal(classifyDemoRoom("dm_111__111").kind, "invalid");
  });
  it("rejects the old shared room and custom names", () => {
    assert.equal(classifyDemoRoom("mobile-test-room").kind, "invalid");
    assert.equal(classifyDemoRoom("").kind, "invalid");
    assert.equal(classifyDemoRoom("my-room").kind, "invalid");
  });
  it("keeps web demo link rooms", () => {
    assert.equal(classifyDemoRoom("test-0123456789abcdef0123").kind, "web");
  });
});

describe("verifyGoogleIdToken", () => {
  it("returns the Google user id for a valid token", async () => {
    assert.equal(await verifyGoogleIdToken("t", CLIENT, google({ aud: CLIENT, iss: "accounts.google.com", sub: "111", exp: future })), "111");
  });
  it("rejects another app's token, expired tokens and Google errors", async () => {
    assert.equal(await verifyGoogleIdToken("t", CLIENT, google({ aud: "other", iss: "accounts.google.com", sub: "111", exp: future })), null);
    assert.equal(await verifyGoogleIdToken("t", CLIENT, google({ aud: CLIENT, iss: "accounts.google.com", sub: "111", exp: 1 })), null);
    assert.equal(await verifyGoogleIdToken("t", CLIENT, google({}, false)), null);
    assert.equal(await verifyGoogleIdToken("", CLIENT, google({ aud: CLIENT, iss: "accounts.google.com", sub: "111", exp: future })), null);
  });
});
