/** Colours and text used by the call screens. Pass a partial object to override any of them. */
export interface RTCCallTheme {
  background: string;
  text: string;
  mutedText: string;
  button: string;
  buttonActive: string;
  buttonActiveText: string;
  accept: string;
  hangUp: string;
  speaking: string;
  avatar: string;
}

export const defaultCallTheme: RTCCallTheme = {
  background: "#0f172a",
  text: "#ffffff",
  mutedText: "#cbd5e1",
  button: "rgba(255,255,255,0.16)",
  buttonActive: "#ffffff",
  buttonActiveText: "#0f172a",
  accept: "#16a34a",
  hangUp: "#dc2626",
  speaking: "#22c55e",
  avatar: "#4f46e5",
};

export interface RTCCallLabels {
  incomingVoice: string;
  incomingVideo: string;
  ringing: string;
  connecting: string;
  voiceCall: string;
  videoCall: string;
  speaking: string;
  answer: string;
  decline: string;
  mute: string;
  unmute: string;
  cameraOff: string;
  cameraOn: string;
  flip: string;
  hangUp: string;
  leave: string;
  you: string;
  joining: string;
  waitingForOthers: string;
  ended: string;
  declined: string;
  missed: string;
  cancelled: string;
  failed: string;
}

export const defaultCallLabels: RTCCallLabels = {
  incomingVoice: "Incoming voice call",
  incomingVideo: "Incoming video call",
  ringing: "Ringing…",
  connecting: "Connecting…",
  voiceCall: "Voice call",
  videoCall: "Video call",
  speaking: "speaking",
  answer: "Answer",
  decline: "Decline",
  mute: "Mute",
  unmute: "Unmute",
  cameraOff: "Camera off",
  cameraOn: "Camera on",
  flip: "Flip",
  hangUp: "End",
  leave: "Leave",
  you: "You",
  joining: "Joining…",
  waitingForOthers: "Waiting for others to join…",
  ended: "Call ended",
  declined: "Call declined",
  missed: "Missed call",
  cancelled: "Call cancelled",
  failed: "Call failed",
};

/** Audio level (0..1) above which someone counts as speaking. */
export const SPEAKING_LEVEL = 0.03;
export const isSpeaking = (level: unknown) => typeof level === "number" && level > SPEAKING_LEVEL;

export const formatDuration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
