import type { IceConfigResponse } from "@rtc/protocol";

export function getIceConfig(): IceConfigResponse {
  const iceServers: IceConfigResponse["iceServers"] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  const turnUrl = process.env.TURN_URL;
  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      username: process.env.TURN_USERNAME || "rtc",
      credential: process.env.TURN_PASSWORD || "rtc-turn-secret",
    });
  }

  return { iceServers };
}
