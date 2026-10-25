import test from "node:test";
import assert from "node:assert/strict";
import { BILLING_PLANS, checkThresholdAlerts, computeBillingSummary, isBillingPlan, type UsageBreakdown } from "./billing-plans.js";

const usage: UsageBreakdown = {
  voiceMinutes: 0, videoMinutes: 0, callMinutes: 0, messagesSent: 0, recordings: 0,
  transcriptionMinutes: 0, qualityReports: 0, callsConnected: 0, callsEnded: 0, totalEvents: 0,
};

test("plans match the published prices and allowances", () => {
  assert.deepEqual(BILLING_PLANS.free.price, { monthlyUsd: 0, yearlyUsd: 0 });
  assert.deepEqual(BILLING_PLANS.starter.price, { monthlyUsd: 9, yearlyUsd: 90 });
  assert.deepEqual(BILLING_PLANS.pro.price, { monthlyUsd: 29, yearlyUsd: 290 });
  assert.equal(BILLING_PLANS.free.limits.voiceMinutes, 2000);
  assert.equal(BILLING_PLANS.starter.limits.voiceMinutes, 30000);
  assert.equal(BILLING_PLANS.pro.limits.voiceMinutes, 50000);
  assert.equal(BILLING_PLANS.pro.limits.videoMinutes, 10000);
  for (const plan of Object.values(BILLING_PLANS)) {
    assert.equal(plan.limits.callMinutes, plan.limits.voiceMinutes + plan.limits.videoMinutes);
  }
});

test("free plan includes 1:1 voice but not group calls or video", () => {
  const { features } = BILLING_PLANS.free;
  assert.equal(features.voice, true);
  assert.equal(features.groupVoice, false);
  assert.equal(features.video, false);
});

test("voice and video allowances are tracked separately", () => {
  const summary = computeBillingSummary("test", "pro", { ...usage, voiceMinutes: 40000, videoMinutes: 11000, callMinutes: 51000 });
  assert.equal(summary.limitStatus.voiceMinutes.exceeded, false);
  assert.equal(summary.limitStatus.videoMinutes.exceeded, true);
  assert.equal(summary.limitStatus.voiceMinutes.percent, 80);
});

test("the summary carries no per-minute charges", () => {
  const summary = computeBillingSummary("test", "starter", { ...usage, voiceMinutes: 45000, callMinutes: 45000 });
  assert.equal("estimatedCostUsd" in summary, false);
  assert.equal("overageCostUsd" in summary, false);
});

test("threshold alerts report voice once, not again as the combined total", () => {
  const summary = computeBillingSummary("test", "starter", { ...usage, voiceMinutes: 27000, callMinutes: 27000 });
  assert.deepEqual(checkThresholdAlerts(summary).map((a) => a.metric), ["voiceMinutes"]);
});

test("only actual plan identifiers are accepted", () => {
  for (const value of ["free", "starter", "pro"]) assert.equal(isBillingPlan(value), true);
  for (const value of ["constructor", "toString", "__proto__", "", null, undefined, {}, ["pro"]]) {
    assert.equal(isBillingPlan(value), false);
  }
});
