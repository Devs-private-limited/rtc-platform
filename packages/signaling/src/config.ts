import type { PlatformConfig } from "@rtc/protocol";
import { getAppPlan } from "./apps.js";
import { getPlanFeatures, type BillingPlan } from "./billing-plans.js";
import { getIceConfig } from "./ice.js";

function resolvePlatformFeatures(plan: BillingPlan, sfuUrl: string | null): PlatformConfig["features"] {
  const features = getPlanFeatures(plan);
  const sfuAvailable = Boolean(sfuUrl);
  return {
    chat: features.chat,
    voiceP2P: features.voice,
    voiceSfu: features.voice && features.groupVoice && sfuAvailable,
    videoP2P: features.video,
    videoSfu: features.video && features.groupVideo && sfuAvailable,
  };
}

export async function getPlatformConfig(appId?: string): Promise<PlatformConfig> {
  const ice = getIceConfig();
  const sfuUrl = process.env.SFU_URL || null;
  if (!appId) {
    const sfuAvailable = Boolean(sfuUrl);
    return {
      ...ice,
      sfuUrl,
      features: {
        chat: true,
        voiceP2P: true,
        voiceSfu: sfuAvailable,
        videoP2P: true,
        videoSfu: sfuAvailable,
      },
    };
  }
  const plan = await getAppPlan(appId);
  return {
    ...ice,
    sfuUrl,
    features: resolvePlatformFeatures(plan, sfuUrl),
  };
}
