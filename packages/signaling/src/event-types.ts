export const WEBHOOK_EVENT_TYPES = [
  "user.joined",
  "user.left",
  "message.sent",
  "call.ringing",
  "call.connected",
  "call.failed",
  "call.ended",
  "recording.ready",
  "recording.uploaded",
  "transcript.ready",
  "summary.ready",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function isValidEventType(type: string): type is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(type);
}
