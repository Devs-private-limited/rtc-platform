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
 * Free is a ONE-TIME trial (its limits are for the life of the project, and it ends for good once
 * the project has ever paid). Paid plans: the limits below are per paid month, counted from the
 * customer's own payment date; yearly plans get 12x for the whole year, usable any time.
 * When a limit is used up, new calls / messages are refused (usage-limits.ts) and the owner is
 * emailed at 80% and 100%. Nothing is ever charged per minute.
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

/** Which usage counts right now. */
export interface UsageWindow {
  /** trial: Free plan, all usage ever. subscription: since the last payment. month: calendar month (plan set by an admin). */
  kind: "trial" | "subscription" | "month";
  from: string | null;
  to: string;
  /** When the allowance starts again (renewal date / 1st of next month); null for the trial. */
  resetsAt: string | null;
  yearly: boolean;
  /** Free plan after the project has paid before: the trial is over, nothing is included. */
  trialOver: boolean;
}

export interface BillingSummary {
  appId: string;
  /** Present for the current period (absent for "all time" reports). */
  window?: UsageWindow;
  plan: BillingPlan;
  planName: string;
  planDescription: string;
  features: PlanFeatures;
  period: { from: string | null; to: string | null };
  usage: UsageBreakdown;
  limits: PlanLimits;
  /** Extra voice minutes (minute packs + admin grants) for this period, already included in limits. */
  bonusMinutes: number;
  /** Extra video minutes (video minute packs) for this period, already included in limits. */
  bonusVideoMinutes: number;
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
  period: { from: string | null; to: string | null } = { from: null, to: null },
  bonus: number | { voice: number; video: number } = 0,
  window?: UsageWindow
): BillingSummary {
  const bonusMinutes = typeof bonus === "number" ? bonus : bonus.voice;
  const bonusVideoMinutes = typeof bonus === "number" ? 0 : bonus.video;
  const def = BILLING_PLANS[plan];
  // Yearly plans: twelve months of allowance for the whole year, usable any time.
  const k = window?.yearly ? 12 : 1;
  const base: PlanLimits = {
    voiceMinutes: def.limits.voiceMinutes * k,
    videoMinutes: def.limits.videoMinutes * k,
    callMinutes: def.limits.callMinutes * k,
    messages: def.limits.messages * k,
    recordings: def.limits.recordings * k,
    transcriptionMinutes: def.limits.transcriptionMinutes * k,
    qualityReports: def.limits.qualityReports * k,
  };
  // Extra minutes (minute packs, admin grants) for this period raise the allowance.
  const limits = {
    ...base,
    voiceMinutes: base.voiceMinutes + bonusMinutes,
    videoMinutes: base.videoMinutes + bonusVideoMinutes,
    callMinutes: base.callMinutes + bonusMinutes + bonusVideoMinutes,
  };

  return {
    appId,
    ...(window ? { window } : {}),
    plan,
    planName: def.name,
    planDescription: def.description,
    features: def.features,
    period,
    usage,
    limits,
    bonusMinutes,
    bonusVideoMinutes,
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

/**
 * Minute packs: bought once in the console (Dodo one-time product with exactly this name) on a paid
 * plan. The minutes are added to the current paid month (or year) and end when the plan renews.
 */
export const MINUTE_PACKS = {
  voice: { minutes: 20_000, priceUsd: 6, productName: "RTCExpress Voice Minutes Pack", label: "20,000 extra voice minutes" },
  video: { minutes: 5_000, priceUsd: 8, productName: "RTCExpress Video Minutes Pack", label: "5,000 extra video minutes" },
} as const;
export type MinutePack = keyof typeof MINUTE_PACKS;
export const isMinutePack = (v: unknown): v is MinutePack => v === "voice" || v === "video";
