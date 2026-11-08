import test from "node:test";
import assert from "node:assert/strict";
import { computeBillingSummary, type UsageBreakdown } from "./billing-plans.js";
import { checkMinutes, clearMinuteCache } from "./usage-limits.js";

const usage = (voice: number, video = 0): UsageBreakdown => ({
  voiceMinutes: voice, videoMinutes: video, callMinutes: voice + video, messagesSent: 0, recordings: 0,
  transcriptionMinutes: 0, qualityReports: 0, callsConnected: 0, callsEnded: 0, totalEvents: 0,
});

test("calls are refused once the month's minutes are used up, extra minutes reopen them", async () => {
  clearMinuteCache();
  const starter = (voice: number, bonus = 0) => async () => computeBillingSummary("app1", "starter", usage(voice), undefined, bonus);
  assert.equal((await checkMinutes("app1", "voice", starter(29_999))).allowed, true);
  clearMinuteCache("app1");
  const full = await checkMinutes("app1", "voice", starter(30_000));
  assert.equal(full.allowed, false);
  assert.match(full.message!, /used all its voice call minutes for this month \(30,000 of 30,000\)/);
  // Cached for a minute: a cheaper check right after doesn't hit the database again.
  assert.equal((await checkMinutes("app1", "voice", starter(0))).allowed, false);
  clearMinuteCache("app1");
  assert.equal((await checkMinutes("app1", "voice", starter(30_000, 5_000))).allowed, true);
});

test("video limit is separate; a plan without video is left to the plan-feature check", async () => {
  clearMinuteCache();
  const pro = async () => computeBillingSummary("app2", "pro", usage(100, 10_000));
  assert.equal((await checkMinutes("app2", "video", pro)).allowed, false);
  assert.equal((await checkMinutes("app2", "voice", pro)).allowed, true);
  clearMinuteCache();
  const starter = async () => computeBillingSummary("app3", "starter", usage(0, 0));
  assert.equal((await checkMinutes("app3", "video", starter)).allowed, true);
});

test("usage that can't be read never blocks calls", async () => {
  clearMinuteCache();
  const broken = async () => { throw new Error("db down"); };
  assert.equal((await checkMinutes("app4", "voice", broken)).allowed, true);
});
