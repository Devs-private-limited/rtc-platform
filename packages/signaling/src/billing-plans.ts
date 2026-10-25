export type BillingPlan = "free" | "starter" | "pro";

export type PlanFeature =
  | "chat"
  | "voice"
  | "video"
  | "groupVoice"
  | "groupVideo"
  | "recording"
  | "transcription"
  | "screenShare";

export interface PlanFeatures {
  chat: boolean;
  voice: boolean;
  video: boolean;
  groupVoice: boolean;
  groupVideo: boolean;
  recording: boolean;
  transcription: boolean;
  screenShare: boolean;
}

export const FEATURE_NAMES: Record<PlanFeature, string> = {
  chat: "Chat",
  voice: "Voice calls",
  video: "Video calls",
  groupVoice: "Group voice",
  groupVideo: "Group video",
  recording: "Call recording",
  transcription: "Transcription",
  screenShare: "Screen share",
};

export interface PlanLimits {
  /** Participant minutes per calendar month (UTC). */
  voiceMinutes: number;
  videoMinutes: number;
  /** Voice plus video, kept for clients that predate the split allowances. */
  callMinutes: number;
  messages: number;
  recordings: number;
  transcriptionMinutes: number;
  qualityReports: number;
}

export interface PlanPrice {
  /** USD per project. Customers in India can pay in INR at checkout. */
  monthlyUsd: number;
  yearlyUsd: number;
}

export interface PlanDefinition {
  name: string;
  description: string;
  price: PlanPrice;
  limits: PlanLimits;
  features: PlanFeatures;
}

/**
 * Flat monthly plans. Limits are allowances, not hard caps: crossing 80% sends a
 * `billing.threshold` alert and the customer is asked to upgrade. Nothing is
 * ever charged per minute.
 */
export const BILLING_PLANS: Record<BillingPlan, PlanDefinition> = {
  free: {
    name: "Free",
    description: "Chat and 1:1 voice calls to build and test with",
    price: { monthlyUsd: 0, yearlyUsd: 0 },
    limits: {
      voiceMinutes: 2000,
      videoMinutes: 0,
      callMinutes: 2000,
      messages: 10000,
      recordings: 0,
      transcriptionMinutes: 0,
      qualityReports: 500,
    },
    features: {
      chat: true,
      voice: true,
      video: false,
      groupVoice: false,
      groupVideo: false,
      recording: false,
      transcription: false,
      screenShare: false,
    },
  },
  starter: {
    name: "Starter",
    description: "Chat + 1:1 and group voice",
    price: { monthlyUsd: 9, yearlyUsd: 90 },
    limits: {
      voiceMinutes: 30000,
      videoMinutes: 0,
      callMinutes: 30000,
      messages: 100000,
      recordings: 100,
      transcriptionMinutes: 300,
      qualityReports: 5000,
    },
    features: {
      chat: true,
      voice: true,
      video: false,
      groupVoice: true,
      groupVideo: false,
      recording: false,
      transcription: false,
      screenShare: false,
    },
  },
  pro: {
    name: "Pro",
    description: "Chat + voice + video and screen sharing",
    price: { monthlyUsd: 29, yearlyUsd: 290 },
    limits: {
      voiceMinutes: 50000,
      videoMinutes: 10000,
      callMinutes: 60000,
      messages: 500000,
      recordings: 1000,
      transcriptionMinutes: 3000,
      qualityReports: 50000,
    },
    features: {
      chat: true,
      voice: true,
      video: true,
      groupVoice: true,
      groupVideo: true,
      recording: true,
      transcription: true,
      screenShare: true,
    },
  },
};

export function getPlanFeatures(plan: BillingPlan): PlanFeatures {
  return BILLING_PLANS[plan].features;
}

export function isBillingPlan(value: unknown): value is BillingPlan {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BILLING_PLANS, value);
}

export interface UsageBreakdown {
  voiceMinutes: number;
  videoMinutes: number;
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
  planDescription: string;
  features: PlanFeatures;
  period: { from: string | null; to: string | null };
  usage: UsageBreakdown;
  limits: PlanLimits;
  limitStatus: {
    voiceMinutes: LimitStatus;
    videoMinutes: LimitStatus;
    callMinutes: LimitStatus;
    messages: LimitStatus;
    recordings: LimitStatus;
    transcriptionMinutes: LimitStatus;
    qualityReports: LimitStatus;
  };
}

function limitStatus(used: number, limit: number): LimitStatus {
  const percent = limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0;
  return { used, limit, percent, exceeded: used > limit };
}

export function computeBillingSummary(
  appId: string,
  plan: BillingPlan,
  usage: UsageBreakdown,
  period: { from: string | null; to: string | null } = { from: null, to: null }
): BillingSummary {
  const def = BILLING_PLANS[plan];
  const { limits } = def;

  return {
    appId,
    plan,
    planName: def.name,
    planDescription: def.description,
    features: def.features,
    period,
    usage,
    limits,
    limitStatus: {
      voiceMinutes: limitStatus(usage.voiceMinutes, limits.voiceMinutes),
      videoMinutes: limitStatus(usage.videoMinutes, limits.videoMinutes),
      callMinutes: limitStatus(usage.callMinutes, limits.callMinutes),
      messages: limitStatus(usage.messagesSent, limits.messages),
      recordings: limitStatus(usage.recordings, limits.recordings),
      transcriptionMinutes: limitStatus(usage.transcriptionMinutes, limits.transcriptionMinutes),
      qualityReports: limitStatus(usage.qualityReports, limits.qualityReports),
    },
  };
}

export function checkThresholdAlerts(summary: BillingSummary) {
  const alerts: Array<{ metric: string; percent: number; exceeded: boolean }> = [];
  for (const [metric, status] of Object.entries(summary.limitStatus)) {
    // The combined total would repeat the voice and video alerts.
    if (metric === "callMinutes") continue;
    if (status.percent >= 80 || status.exceeded) {
      alerts.push({ metric, percent: status.percent, exceeded: status.exceeded });
    }
  }
  return alerts;
}
