import { createHmac } from "crypto";
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { getIceConfig } from "./ice.js";

describe("getIceConfig", () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it("returns static TURN when no userId", () => {
    process.env.TURN_URL = "turn:example.com:3478";
    process.env.TURN_USERNAME = "rtc";
    process.env.TURN_PASSWORD = "secret";
    const config = getIceConfig();
    assert.equal(config.iceServers.length, 3);
    assert.equal(config.iceServers[2]?.username, "rtc");
  });

  it("returns per-session TURN credentials when userId provided", () => {
    process.env.TURN_URL = "turn:example.com:3478";
    process.env.TURN_PASSWORD = "turn-secret";
    const config = getIceConfig({ userId: "user_a", ttlSec: 3600 });
    const turn = config.iceServers.find((s) => String(s.urls).includes("turn:"));
    assert.ok(turn?.username?.includes("user_a"));
    assert.ok(turn?.credential);
    const [expiry] = turn!.username!.split(":");
    assert.ok(Number(expiry) > Math.floor(Date.now() / 1000));
    const expected = createHmac("sha1", "turn-secret").update(turn!.username!).digest("base64");
    assert.equal(turn!.credential, expected);
  });
});
