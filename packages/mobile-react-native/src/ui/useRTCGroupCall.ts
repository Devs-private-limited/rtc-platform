import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import type { RTCExpress } from "../index";
import { requestCallPermissions } from "./permissions";
import { isSpeaking } from "./theme";

export interface RTCGroupCall {
  roomId?: string;
  kind: "voice" | "video";
  /** "joining" until the media server confirms, then "connected". */
  phase: "joining" | "connected";
  /** Other people in the call (you are not in this list). */
  participants: string[];
  joinedAt?: number;
}

export interface RTCGroupCallController {
  groupCall: RTCGroupCall | null;
  /** User IDs talking right now (you included), from the server's audio levels. */
  speaking: string[];
  muted: boolean;
  cameraOff: boolean;
  /** Last error, e.g. "Group video calls are not included in your current plan". Cleared on the next join. */
  error: string | null;
  /** The group call screen is hidden; show <OngoingCallBar> to get back. */
  minimized: boolean;
  minimize(): void;
  restore(): void;
  /** This phone is sharing its screen. */
  sharingScreen: boolean;
  /** Others sharing their screen right now, newest last. */
  screenSharers: string[];
  toggleScreenShare(): void;
  canShareScreen: boolean;
  /** Join group voice or video in the room you joined with rtc.joinRoom(). */
  join(kind: "voice" | "video"): Promise<boolean>;
  leave(): void;
  toggleMute(): void;
  toggleCamera(): void;
  switchCamera(): void;
}

/**
 * State for a group voice/video call in the current room (Android; plan must include group calls).
 * `userId` is your own user ID, so you are not listed as a participant.
 */
export function useRTCGroupCall(
  client: RTCExpress | null | undefined,
  userId: string,
  options: { askPermissions?: boolean } = {},
): RTCGroupCallController {
  const { askPermissions = true } = options;
  const [groupCall, setGroupCall] = useState<RTCGroupCall | null>(null);
  const [speaking, setSpeaking] = useState<string[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [screenSharers, setScreenSharers] = useState<string[]>([]);
  const ref = useRef<RTCGroupCall | null>(null);
  const lastLoud = useRef<Record<string, number>>({});

  const update = useCallback((fn: (g: RTCGroupCall | null) => RTCGroupCall | null) => {
    const next = fn(ref.current);
    ref.current = next;
    setGroupCall(next);
  }, []);

  const reset = useCallback(() => {
    update(() => null);
    setMinimized(false);
    setSharingScreen(false);
    setScreenSharers([]);
    setSpeaking([]);
    setMuted(false);
    setCameraOff(false);
    lastLoud.current = {};
  }, [update]);

  const leave = useCallback(() => {
    const g = ref.current;
    if (!g) return;
    if (g.kind === "video") client?.leaveVideoRoom();
    else client?.leaveVoiceRoom();
    reset();
  }, [client, reset]);

  useEffect(() => {
    if (!client) return;
    const addPeople = (ids: string[]) =>
      update((g) => {
        if (!g) return g;
        const fresh = ids.filter((u) => u && u !== userId && !g.participants.includes(u));
        return fresh.length ? { ...g, participants: [...g.participants, ...fresh] } : g;
      });
    const offs = [
      client.on("groupMedia", (p: any) => {
        const g = ref.current;
        if (!g || p?.kind !== g.kind) return;
        if (p.joined) update((cur) => (cur ? { ...cur, roomId: p.roomId, phase: "connected", joinedAt: cur.joinedAt || Date.now() } : cur));
        else reset();
      }),
      client.on("mediaParticipant", (p: any) => {
        if (!ref.current || !p?.userId || p.userId === userId) return;
        if (p.joined) addPeople([p.userId]);
        else {
          update((g) => (g ? { ...g, participants: g.participants.filter((u) => u !== p.userId) } : g));
          setScreenSharers((cur) => cur.filter((u) => u !== p.userId));
        }
      }),
      client.on("screenShare", (p: any) => {
        if (!ref.current) return;
        if (p?.local) setSharingScreen(!!p.active);
        else if (p?.userId) setScreenSharers((cur) => [...cur.filter((u) => u !== p.userId), ...(p.active ? [p.userId as string] : [])]);
      }),
      client.on("audioLevels", (levels: any) => {
        if (!ref.current) return;
        const now = Date.now();
        const entries = Object.entries((levels || {}) as Record<string, number>);
        for (const [u, level] of entries) if (isSpeaking(level)) lastLoud.current[u] = now;
        const next = Object.keys(lastLoud.current).filter((u) => now - lastLoud.current[u] < 500).sort();
        setSpeaking((cur) => (cur.join() === next.join() ? cur : next));
        // Someone who joined before us shows up in the levels first.
        addPeople(entries.map(([u]) => u));
      }),
      client.on("error", (p: any) => {
        if (!ref.current) return;
        const message: string = p?.message || "Group call error";
        if (/not included in|Could not join group|Call could not start/i.test(message)) {
          setError(message);
          leave();
        }
      }),
      client.on("disconnected", () => {
        if (ref.current) {
          setError("Connection lost");
          reset();
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [client, leave, reset, update, userId]);

  const join = useCallback(
    async (kind: "voice" | "video") => {
      if (!client || ref.current) return false;
      setError(null);
      if (askPermissions && !(await requestCallPermissions(kind === "video"))) {
        setError(kind === "video" ? "Camera and microphone permission are needed." : "Microphone permission is needed.");
        return false;
      }
      update(() => ({ kind, phase: "joining", participants: [] }));
      if (kind === "video") client.joinVideoRoom();
      else client.joinVoiceRoom();
      return true;
    },
    [askPermissions, client, update],
  );

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

  const toggleScreenShare = useCallback(() => {
    if (!client || ref.current?.phase !== "connected") return;
    try {
      if (sharingScreen) client.stopScreenShare();
      else client.startScreenShare();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, sharingScreen]);

  const minimize = useCallback(() => {
    if (ref.current) setMinimized(true);
  }, []);
  const restore = useCallback(() => setMinimized(false), []);

  const canShareScreen = Platform.OS === "android";

  return { groupCall, speaking, muted, cameraOff, error, minimized, minimize, restore, sharingScreen, screenSharers, toggleScreenShare, canShareScreen, join, leave, toggleMute, toggleCamera, switchCamera };
}
