import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import type { RTCCallTheme } from "./theme";

/** Re-render once a second while `active` (for call timers). */
export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export const initials = (name: string) => {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  const text = parts.length > 1 ? parts[0][0] + parts[1][0] : name.trim().slice(0, 2);
  return (text || "?").toUpperCase();
};

export function CallAvatar({ name, size = 96, speaking, theme }: { name: string; size?: number; speaking?: boolean; theme: RTCCallTheme }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.avatar },
        speaking && { borderColor: theme.speaking, borderWidth: Math.max(3, size / 24) },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.36, color: theme.text }]}>{initials(name)}</Text>
    </View>
  );
}

export function CallButton({
  icon,
  label,
  onPress,
  theme,
  color,
  active,
  size = 64,
  rotateIcon,
  style,
}: {
  icon: string;
  label: string;
  onPress(): void;
  theme: RTCCallTheme;
  /** Solid colour, e.g. theme.accept or theme.hangUp. */
  color?: string;
  /** Toggled on (white button), e.g. while muted. */
  active?: boolean;
  size?: number;
  rotateIcon?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const bg = color || (active ? theme.buttonActive : theme.button);
  return (
    <View style={[styles.btnWrap, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!active }}
        onPress={onPress}
        style={({ pressed }) => [styles.btn, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[styles.btnIcon, { fontSize: size * 0.4 }, rotateIcon && styles.rotate, active && !color && { color: theme.buttonActiveText }]}>{icon}</Text>
      </Pressable>
      <Text style={[styles.btnLabel, { color: theme.mutedText }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Top-left arrow that hides the call screen (the call continues; the ongoing-call bar brings it back). */
export function MinimizeButton({ onPress, color }: { onPress(): void; color: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Minimize call" hitSlop={12} onPress={onPress} style={styles.minimize}>
      <Text style={[styles.minimizeText, { color }]}>⌄</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  minimize: { position: "absolute", left: 12, top: 36, zIndex: 2, width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  minimizeText: { fontSize: 28, lineHeight: 30, marginTop: -8 },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700" },
  btnWrap: { alignItems: "center", minWidth: 72 },
  btn: { alignItems: "center", justifyContent: "center" },
  btnIcon: { color: "#ffffff" },
  rotate: { transform: [{ rotate: "135deg" }] },
  btnLabel: { marginTop: 6, fontSize: 12 },
});
