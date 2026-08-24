import type { PlatformConfig } from "@rtc/protocol";
import { getIceConfig } from "./ice.js";

export function getPlatformConfig(): PlatformConfig {
  const ice = getIceConfig();
  const sfuUrl = process.env.SFU_URL || null;
  return {
    ...ice,
    sfuUrl,
    features: {
      chat: true,
      voiceP2P: true,
      voiceSfu: Boolean(sfuUrl),
    },
  };
}
