import test from "node:test";
import assert from "node:assert/strict";
import { computeBillingSummary, type UsageBreakdown, type UsageWindow, type BillingPlan } from "./billing-plans.js";
import { checkMinutes, clearMinuteCache, decide } from "./usage-limits.js";

const usage = (voice: number, video = 0, messages = 0): UsageBreakdown => ({
  voiceMinutes: voice, videoMinutes: video, callMinutes: voice + video, messagesSent: messages, recordings: 0,
  transcriptionMinutes: 0, qualityReports: 0, callsConnected: 0, callsEnded: 0, totalEvents: 0,
});
const trial: UsageWindow = { kind: "trial", from: null, to: "2026-11-20T00:00:00Z", resetsAt: null, yearly: false, trialOver: false };
const monthly: UsageWindow = { kind: "subscription", from: "2026-11-05T00:00:00Z", to: "2026-11-20T00:00:00Z", resetsAt: "2026-12-05T00:00:00Z", yearly: false, trialOver: false };
const yearly: UsageWindow = { ...monthly, from: "2026-11-05T00:00:00Z", resetsAt: "2027-11-05T00:00:00Z", yearly: true };
const summary = (plan: BillingPlan, u: UsageBreakdown, window: UsageWindow, bonus = 0) =>
  computeBillingSummary("app", plan, u, { from: window.from, to: window.to }, bonus, window);

test("free plan is a one-time trial: 2,000 minutes and 10,000 messages, then choose a plan", () => {
  assert.equal(decide(summary("free", usage(1_999), trial), "voice").allowed, true);
  const out = decide(summary("free", usage(2_000), trial), "voice");
  assert.equal(out.allowed, false);
  assert.match(out.message!, /free trial \(2,000 of 2,000\).*choose a plan/);
  assert.equal(decide(summary("free", usage(0, 0, 10_000), trial), "messages").allowed, false);
  assert.equal(decide(summary("free", usage(0, 0, 9_999), trial), "messages").allowed, true);
});

test("after a paid plan ends, the trial does not come back", () => {
  const over = decide(summary("free", usage(0), { ...trial, trialOver: true }), "voice");
  assert.equal(over.allowed, false);
  assert.match(over.message!, /free trial has ended and it has no active plan/);
  assert.equal(decide(summary("free", usage(0), { ...trial, trialOver: true }), "messages").allowed, false);
});

test("monthly Starter: 30,000 minutes per paid month, back on the renewal date", () => {
  assert.equal(decide(summary("starter", usage(29_999), monthly), "voice").allowed, true);
  const out = decide(summary("starter", usage(30_000), monthly), "voice");
  assert.equal(out.allowed, false);
  assert.match(out.message!, /this billing month \(30,000 of 30,000\)\. They start again on 5 December 2026/);
  assert.equal(decide(summary("starter", usage(30_000), monthly, 5_000), "voice").allowed, true); // extra minutes
});

test("yearly Starter: 360,000 minutes usable any time in the year", () => {
  const s = summary("starter", usage(200_000), yearly);
  assert.equal(s.limits.voiceMinutes, 360_000);
  assert.equal(decide(s, "voice").allowed, true);
  const out = decide(summary("starter", usage(360_000), yearly), "voice");
  assert.equal(out.allowed, false);
  assert.match(out.message!, /for this year .*5 November 2027/);
});

test("Pro video limit is separate from voice; cache and database errors", async () => {
  const pro = summary("pro", usage(100, 10_000), monthly);
  assert.equal(decide(pro, "video").allowed, false);
  assert.equal(decide(pro, "voice").allowed, true);
  clearMinuteCache();
  assert.equal((await checkMinutes("app9", "voice", async () => summary("starter", usage(30_000), monthly))).allowed, false);
  // Cached for a minute.
  assert.equal((await checkMinutes("app9", "voice", async () => summary("starter", usage(0), monthly))).allowed, false);
  clearMinuteCache("app9");
  assert.equal((await checkMinutes("app9", "voice", async () => summary("starter", usage(0), monthly))).allowed, true);
  assert.equal((await checkMinutes("app10", "voice", async () => { throw new Error("db down"); })).allowed, true);
  // Our own demo project is never limited.
  assert.equal((await checkMinutes(process.env.DEMO_APP_ID || "demo-app", "voice", async () => summary("free", usage(9_999_999), { ...trial, trialOver: true }))).allowed, true);
});
