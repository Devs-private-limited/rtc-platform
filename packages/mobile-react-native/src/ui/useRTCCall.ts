import { useCallback, useEffect, useRef, useState } from "react";
import { Vibration } from "react-native";
import type { RTCExpress } from "../index";
import { requestCallPermissions } from "./permissions";
import { isSpeaking } from "./theme";

export type CallPhase = "ringing" | "connecting" | "connected" | "ended";
export type CallEndReason = "ended" | "declined" | "missed" | "cancelled" | "failed";

export interface RTCCall {
  callId?: string;
  roomId?: string;
  /** The other person's RTCExpress user ID. */
  peerUserId: string;
  video: boolean;
  direction: "incoming" | "outgoing";
  phase: CallPhase;
  /** Incoming call answered on this phone. */
  accepted: boolean;
  /** Time (ms) the call connected; use it for a call timer. */
  connectedAt?: number;
  /** Set when phase is "ended". */
  endReason?: CallEndReason;
  /** Last error message for this call (permission denied, plan limit, network). */
  error?: string;
}

export interface RTCCallController {
  /** The current call, or null when there is none. Kept for a moment after it ends so the screen can say why. */
  call: RTCCall | null;
  muted: boolean;
  cameraOff: boolean;
  /** The other person is talking right now (SFU calls on paid plans; always false in P2P calls). */
  peerSpeaking: boolean;
  /** The call screen is hidden and the app is usable; show <OngoingCallBar> to get back. */
  minimized: boolean;
  /** Hide the call screen but keep the call (Android back button does this too). */
  minimize(): void;
  /** Show the call screen again. */
  restore(): void;
  /** Call someone in the room you joined. Asks for microphone (and camera) permission first. Resolves false if it could not start. */
  startCall(peerUserId: string, options?: { video?: boolean }): Promise<boolean>;
  /** Answer the incoming call. Asks for permissions first. */
  accept(): Promise<boolean>;
  decline(): void;
  hangUp(): void;
  toggleMute(): void;
  toggleCamera(): void;
  switchCamera(): void;
  /** Hide the "Call ended" state right away. */
  dismiss(): void;
}

export interface UseRTCCallOptions {
  /** How long the ended state stays before `call` goes back to null. Default 1500 ms. */
  endedScreenMs?: number;
  /** Ask for Android microphone/camera permission before calling or answering. Default true. */
  askPermissions?: boolean;
  /** Vibrate while an incoming call rings. Default true. */
  vibrate?: boolean;
  /** Called once when a call finishes, e.g. to save it in your call history. */
  onCallEnded?(call: RTCCall): void;
}

const LIVE_STATES = ["ringing", "connecting", "connected"];
const END_STATES = ["ended", "rejected", "failed", "idle"];

/**
 * All the state a 1:1 call screen needs, from the RTCExpress events.
 *
 * ```tsx
 * const call = useRTCCall(rtc);
 * <Button title="Call Bob" onPress={() => call.startCall("bob")} />
 * <CallScreen controller={call} />
 * ```
 * Join a room with `rtc.joinRoom()` before `startCall`: the call is placed in that room.
 */
export function useRTCCall(client: RTCExpress | null | undefined, options: UseRTCCallOptions = {}): RTCCallController {
  const { endedScreenMs = 1500, askPermissions = true, vibrate = true } = options;
  const [call, setCall] = useState<RTCCall | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [peerSpeaking, setPeerSpeaking] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const callRef = useRef<RTCCall | null>(null);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLoud = useRef(0);
  const onEndedRef = useRef(options.onCallEnded);
  onEndedRef.current = options.onCallEnded;

  const update = useCallback((next: RTCCall | null) => {
    // A new call always opens full screen. (A call that ends while minimized stays in the bar.)
    const prev = callRef.current;
    if (!next || !prev || prev.phase === "ended") setMinimized(false);
    callRef.current = next;
    setCall(next);
  }, []);

  const finish = useCallback(
    (reason: CallEndReason, error?: string) => {
      const c = callRef.current;
      if (!c || c.phase === "ended") return;
      const ended: RTCCall = { ...c, phase: "ended", endReason: reason, error: error ?? c.error };
      update(ended);
      setMuted(false);
      setCameraOff(false);
      setPeerSpeaking(false);
      onEndedRef.current?.(ended);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => {
        if (callRef.current === ended) update(null);
      }, endedScreenMs);
    },
    [endedScreenMs, update],
  );

  // Turn the SDK's "ended/rejected/failed" into something a person understands.
  const reasonFor = (state: string, c: RTCCall): CallEndReason => {
    if (state === "failed") return "failed";
    if (c.connectedAt) return "ended";
    if (c.direction === "incoming") return c.accepted ? "ended" : state === "rejected" ? "declined" : "missed";
    return state === "rejected" ? "declined" : "cancelled";
  };

  useEffect(() => {
    if (!client) return;
    const offs = [
      client.on("callInvite", (p: any) => {
        if (!p?.callId) return;
        const cur = callRef.current;
        if (cur && cur.phase !== "ended") return; // the SDK already declines a second call
        if (clearTimer.current) clearTimeout(clearTimer.current);
        update({
          callId: p.callId,
          roomId: p.roomId,
          peerUserId: p.fromUserId || "Unknown",
          video: p.callType === "video",
          direction: "incoming",
          phase: "ringing",
          accepted: false,
        });
      }),
      client.on("callState", (p: any) => {
        const state: string = p?.state || "";
        const c = callRef.current;
        if (!c || c.phase === "ended") return;
        if (p?.callId && c.callId && p.callId !== c.callId) return;
        if (END_STATES.includes(state)) {
          finish(reasonFor(state, c));
          return;
        }
        if (!LIVE_STATES.includes(state)) return; // e.g. P2P "checking"
        if (c.direction === "incoming" && !c.accepted) return; // still ringing here
        // Phones on the media server only report "connecting" after answering: that is connected.
        const live = state === "connected" || (state === "connecting" && c.direction === "incoming");
        const phase: CallPhase = live ? "connected" : state === "connecting" ? "connecting" : c.phase;
        update({
          ...c,
          callId: c.callId || p?.callId,
          roomId: c.roomId || p?.roomId,
          phase,
          connectedAt: c.connectedAt || (live ? Date.now() : undefined),
        });
      }),
      client.on("error", (p: any) => {
        const c = callRef.current;
        if (!c || c.phase === "ended") return;
        const message = p?.message || "Something went wrong";
        // callUser failed before the SDK reported "ringing" (no room joined, already in a call, plan limit).
        if (c.direction === "outgoing" && !c.callId) finish("failed", message);
        else update({ ...c, error: message });
      }),
      client.on("audioLevels", (levels: any) => {
        const c = callRef.current;
        if (!c || c.phase !== "connected") return;
        const now = Date.now();
        if (isSpeaking(levels?.[c.peerUserId])) lastLoud.current = now;
        const talking = now - lastLoud.current < 500;
        setPeerSpeaking((cur) => (cur === talking ? cur : talking));
      }),
      client.on("disconnected", () => finish(callRef.current?.connectedAt ? "ended" : "failed", "Connection lost")),
    ];
    return () => offs.forEach((off) => off());
  }, [client, finish, update]);

  // Vibrate while an incoming call rings.
  const ringing = call?.direction === "incoming" && call.phase === "ringing";
  useEffect(() => {
    if (!ringing || !vibrate) return;
    try {
      Vibration.vibrate([0, 800, 1200], true);
    } catch {
      /* no VIBRATE permission in the app */
    }
    return () => Vibration.cancel();
  }, [ringing, vibrate]);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  const startCall = useCallback(
    async (peerUserId: string, opts: { video?: boolean } = {}) => {
      if (!client) return false;
      const cur = callRef.current;
      if (cur && cur.phase !== "ended") return false;
      const video = !!opts.video;
      if (clearTimer.current) clearTimeout(clearTimer.current);
      update({ peerUserId, video, direction: "outgoing", phase: "ringing", accepted: false });
      if (askPermissions && !(await requestCallPermissions(video))) {
        finish("failed", video ? "Camera and microphone permission are needed for a video call." : "Microphone permission is needed for a call.");
        return false;
      }
      client.callUser(peerUserId, video);
      return true;
    },
    [askPermissions, client, finish, update],
  );

  const accept = useCallback(async () => {
    const c = callRef.current;
    if (!client || !c || c.direction !== "incoming" || c.phase !== "ringing") return false;
    if (askPermissions && !(await requestCallPermissions(c.video))) {
      client.rejectCall();
      finish("failed", "Microphone permission is needed to answer.");
      return false;
    }
    update({ ...c, accepted: true, phase: "connecting" });
    client.acceptCall();
    return true;
  }, [askPermissions, client, finish, update]);

  const decline = useCallback(() => {
    if (!callRef.current) return;
    client?.rejectCall();
    finish("declined");
  }, [client, finish]);

  const hangUp = useCallback(() => {
    const c = callRef.current;
    if (!c) return;
    if (c.direction === "incoming" && !c.accepted) {
      decline();
      return;
    }
    client?.endCall();
    finish(c.connectedAt ? "ended" : "cancelled");
  }, [client, decline, finish]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      client?.muteMicrophone(!m);
      return !m;
    });
  }, [client]);

  const toggleCamera = useCallback(() => {
    setCameraOff((off) => {
      client?.muteCamera(!off);
      return !off;
    });
  }, [client]);

  const switchCamera = useCallback(() => client?.switchCamera(), [client]);

  const dismiss = useCallback(() => {
    if (callRef.current?.phase === "ended") update(null);
  }, [update]);

  const minimize = useCallback(() => {
    const c = callRef.current;
    // An incoming call must be answered or declined first.
    if (c && c.phase !== "ended" && !(c.direction === "incoming" && c.phase === "ringing")) setMinimized(true);
  }, []);
  const restore = useCallback(() => setMinimized(false), []);

  return { call, muted, cameraOff, peerSpeaking, minimized, minimize, restore, startCall, accept, decline, hangUp, toggleMute, toggleCamera, switchCamera, dismiss };
}
