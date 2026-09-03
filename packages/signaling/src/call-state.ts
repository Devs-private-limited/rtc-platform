export type CallPhase = "ringing" | "connected";

export interface ActiveCall {
  appId: string;
  callId: string;
  roomId: string;
  callerUserId: string;
  calleeUserId: string;
  phase: CallPhase;
}

const callsById = new Map<string, ActiveCall>();
const callIdByUser = new Map<string, string>();

function userKey(appId: string, userId: string) {
  return `${appId}:${userId}`;
}

export function findUserCall(appId: string, userId: string): ActiveCall | null {
  const callId = callIdByUser.get(userKey(appId, userId));
  if (!callId) return null;
  return callsById.get(callId) ?? null;
}

export function registerRinging(
  appId: string,
  callId: string,
  roomId: string,
  callerUserId: string,
  calleeUserId: string
): { ok: true } | { ok: false; busyUserId: string } {
  if (findUserCall(appId, callerUserId)) {
    return { ok: false, busyUserId: callerUserId };
  }
  if (findUserCall(appId, calleeUserId)) {
    return { ok: false, busyUserId: calleeUserId };
  }

  const call: ActiveCall = {
    appId,
    callId,
    roomId,
    callerUserId,
    calleeUserId,
    phase: "ringing",
  };
  callsById.set(callId, call);
  callIdByUser.set(userKey(appId, callerUserId), callId);
  callIdByUser.set(userKey(appId, calleeUserId), callId);
  return { ok: true };
}

export function markCallConnected(callId: string) {
  const call = callsById.get(callId);
  if (call) call.phase = "connected";
}

export function clearCall(callId: string) {
  const call = callsById.get(callId);
  if (!call) return;
  callsById.delete(callId);
  callIdByUser.delete(userKey(call.appId, call.callerUserId));
  callIdByUser.delete(userKey(call.appId, call.calleeUserId));
}

export function clearUserCalls(appId: string, userId: string) {
  const call = findUserCall(appId, userId);
  if (call) clearCall(call.callId);
}

/** Test helper */
export function resetCallState() {
  callsById.clear();
  callIdByUser.clear();
}
