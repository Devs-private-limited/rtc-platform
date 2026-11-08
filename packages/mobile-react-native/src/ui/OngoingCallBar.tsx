import React from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useNow } from "./parts";
import { defaultCallLabels, formatDuration, type RTCCallLabels } from "./theme";
import type { RTCCallController } from "./useRTCCall";
import type { RTCGroupCallController } from "./useRTCGroupCall";

export interface OngoingCallBarProps {
  /** From useRTCCall(). */
  call?: RTCCallController;
  /** From useRTCGroupCall(). */
  group?: RTCGroupCallController;
  /** e.g. "Family" for the group call. */
  groupTitle?: string;
  displayName?(userId: string): string;
  /** Bar colour. Default green. */
  color?: string;
  labels?: Partial<RTCCallLabels>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Green "Ongoing call · Bob · 1:23 · Tap to return" bar, shown while a call is minimized
 * (back button or the ⌄ arrow). Put it at the top of your root view, above your navigation.
 * Renders nothing when there is no minimized call.
 */
export function OngoingCallBar({ call, group, groupTitle, displayName, color = "#16a34a", labels, style }: OngoingCallBarProps) {
  const t = { ...defaultCallLabels, ...labels };
  const one = call?.minimized ? call.call : null;
  const g = group?.minimized ? group.groupCall : null;
  const now = useNow(!!(one || g));
  if (!one && !g) return null;

  let text: string;
  let onPress: () => void;
  if (one) {
    const name = displayName ? displayName(one.peerUserId) : one.peerUserId;
    const state =
      one.phase === "ended" ? t[one.endReason || "ended"]
      : one.phase === "connected" && one.connectedAt ? formatDuration(now - one.connectedAt)
      : one.phase === "connecting" ? t.connecting
      : t.ringing;
    text = `${name} · ${state}`;
    onPress = call!.restore;
  } else {
    const people = 1 + g!.participants.length;
    text = `${groupTitle || (g!.kind === "video" ? t.videoCall : t.voiceCall)} · ${people} · ${g!.joinedAt ? formatDuration(now - g!.joinedAt) : t.joining}`;
    onPress = group!.restore;
  }
  const ended = one?.phase === "ended";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t.ongoingCall}. ${text}. ${t.tapToReturn}`}
      onPress={onPress}
      disabled={ended}
      style={({ pressed }) => [styles.bar, { backgroundColor: ended ? "#475569" : color, opacity: pressed ? 0.85 : 1 }, style]}
    >
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={1}>
        {text}
      </Text>
      {!ended && <Text style={styles.hint}>{t.tapToReturn}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ffffff" },
  text: { flex: 1, color: "#ffffff", fontSize: 14, fontWeight: "600" },
  hint: { color: "#ffffff", fontSize: 12, opacity: 0.9 },
});
