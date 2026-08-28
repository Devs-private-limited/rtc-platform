export type BillingPlan = "free" | "starter" | "pro";

export interface PlanLimits {
  callMinutes: number;
  messages: number;
  recordings: number;
  transcriptionMinutes: number;
  qualityReports: number;
}

export interface PlanRates {
  callMinute: number;
  message: number;
  recording: number;
  transcriptionMinute: number;
}

export interface PlanDefinition {
  name: string;
  limits: PlanLimits;
  rates: PlanRates;
}

export const BILLING_PLANS: Record<BillingPlan, PlanDefinition> = {
  free: {
    name: "Free",
    limits: {
      callMinutes: 100,
      messages: 1000,
      recordings: 10,
      transcriptionMinutes: 30,
      qualityReports: 500,
    },
    rates: { callMinute: 0, message: 0, recording: 0, transcriptionMinute: 0 },
  },
  starter: {
    name: "Starter",
    limits: {
      callMinutes: 1000,
      messages: 10000,
      recordings: 100,
      transcriptionMinutes: 300,
      qualityReports: 5000,
    },
    rates: {
      callMinute: 0.004,
      message: 0.0001,
      recording: 0.05,
      transcriptionMinute: 0.02,
    },
  },
  pro: {
    name: "Pro",
    limits: {
      callMinutes: 10000,
      messages: 100000,
      recordings: 1000,
      transcriptionMinutes: 3000,
      qualityReports: 50000,
    },
    rates: {
      callMinute: 0.003,
      message: 0.00008,
      recording: 0.04,
      transcriptionMinute: 0.015,
    },
  },
};

export interface UsageBreakdown {
  callMinutes: number;
  messagesSent: number;
  recordings: number;
  transcriptionMinutes: number;
  qualityReports: number;
  callsConnected: number;
  callsEnded: number;
  totalEvents: number;
}

export interface LimitStatus {
  used: number;
  limit: number;
  percent: number;
  exceeded: boolean;
}

export interface BillingSummary {
  appId: string;
  plan: BillingPlan;
  planName: string;
  period: { from: string | null; to: string | null };
  usage: UsageBreakdown;
  limits: PlanLimits;
  limitStatus: {
    callMinutes: LimitStatus;
    messages: LimitStatus;
    recordings: LimitStatus;
    transcriptionMinutes: LimitStatus;
    qualityReports: LimitStatus;
  };
  estimatedCostUsd: number;
  overageCostUsd: number;
}

function limitStatus(used: number, limit: number): LimitStatus {
  const percent = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0;
  return { used, limit, percent, exceeded: used > limit };
}

function roundUsd(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeBillingSummary(
  appId: string,
  plan: BillingPlan,
  usage: UsageBreakdown,
  period: { from: string | null; to: string | null } = { from: null, to: null }
): BillingSummary {
  const def = BILLING_PLANS[plan];
  const { limits, rates } = def;

  const overage = {
    callMinutes: Math.max(0, usage.callMinutes - limits.callMinutes),
    messages: Math.max(0, usage.messagesSent - limits.messages),
    recordings: Math.max(0, usage.recordings - limits.recordings),
    transcriptionMinutes: Math.max(0, usage.transcriptionMinutes - limits.transcriptionMinutes),
    qualityReports: Math.max(0, usage.qualityReports - limits.qualityReports),
  };

  const baseCost =
    usage.callMinutes * rates.callMinute +
    usage.messagesSent * rates.message +
    usage.recordings * rates.recording +
    usage.transcriptionMinutes * rates.transcriptionMinute;

  const overageCost =
    overage.callMinutes * rates.callMinute +
    overage.messages * rates.message +
    overage.recordings * rates.recording +
    overage.transcriptionMinutes * rates.transcriptionMinute;

  return {
    appId,
    plan,
    planName: def.name,
    period,
    usage,
    limits,
    limitStatus: {
      callMinutes: limitStatus(usage.callMinutes, limits.callMinutes),
      messages: limitStatus(usage.messagesSent, limits.messages),
      recordings: limitStatus(usage.recordings, limits.recordings),
      transcriptionMinutes: limitStatus(usage.transcriptionMinutes, limits.transcriptionMinutes),
      qualityReports: limitStatus(usage.qualityReports, limits.qualityReports),
    },
    estimatedCostUsd: roundUsd(baseCost + overageCost),
    overageCostUsd: roundUsd(overageCost),
  };
}

export function checkThresholdAlerts(summary: BillingSummary) {
  const alerts: Array<{ metric: string; percent: number; exceeded: boolean }> = [];
  for (const [metric, status] of Object.entries(summary.limitStatus)) {
    if (status.percent >= 80 || status.exceeded) {
      alerts.push({ metric, percent: status.percent, exceeded: status.exceeded });
    }
  }
  return alerts;
}
