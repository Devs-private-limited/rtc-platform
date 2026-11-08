import React, { useEffect } from "react";
import { BackHandler, Platform, ScrollView, StatusBar, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { RTCVideoView } from "../video";
import { CallAvatar, CallButton, useNow } from "./parts";
import { defaultCallLabels, defaultCallTheme, formatDuration, type RTCCallLabels, type RTCCallTheme } from "./theme";
import type { RTCGroupCallController } from "./useRTCGroupCall";

export interface GroupCallScreenProps {
  /** The value returned by useRTCGroupCall(rtc, myUserId). */
  controller: RTCGroupCallController;
  /** Your own user ID (shown as "You"). */
  userId: string;
  /** Title at the top, e.g. the group name. */
  title?: string;
  displayName?(userId: string): string;
  theme?: Partial<RTCCallTheme>;
  labels?: Partial<RTCCallLabels>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Ready-made group voice/video call UI: one tile per person, a green frame on whoever is speaking,
 * people count + timer, mute / camera / flip / leave. Renders nothing when not in a group call.
 */
export function GroupCallScreen({ controller, userId, title, displayName, theme: themeIn, labels: labelsIn, style }: GroupCallScreenProps) {
  const theme = { ...defaultCallTheme, ...themeIn };
  const t = { ...defaultCallLabels, ...labelsIn };
  const { groupCall: g, speaking, muted, cameraOff } = controller;
  const now = useNow(g?.phase === "connected");

  useEffect(() => {
    if (!g) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [!!g]);

  if (!g) return null;

  const video = g.kind === "video" && Platform.OS === "android";
  const people = [userId, ...g.participants];
  const twoColumns = people.length > 1;
  const name = (u: string) => (u === userId ? t.you : displayName ? displayName(u) : u);
  const status =
    g.phase === "connected" && g.joinedAt
      ? `${g.kind === "video" ? t.videoCall : t.voiceCall} · ${people.length} · ${formatDuration(now - g.joinedAt)}`
      : t.joining;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: theme.background }, style]}>
      <StatusBar barStyle="light-content" />
      <View style={styles.top}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title || (g.kind === "video" ? t.videoCall : t.voiceCall)}
        </Text>
        <Text style={[styles.status, { color: theme.mutedText }]}>{status}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {people.map((u) => {
          const isMe = u === userId;
          const talking = speaking.includes(u) && !(isMe && muted);
          return (
            <View
              key={u}
              style={[
                styles.tile,
                { width: twoColumns ? "47%" : "94%", aspectRatio: video ? 3 / 4 : 1, borderColor: talking ? theme.speaking : "transparent" },
              ]}
            >
              {video && !(isMe && cameraOff) ? (
                isMe ? <RTCVideoView local style={StyleSheet.absoluteFill} /> : <RTCVideoView userId={u} style={StyleSheet.absoluteFill} />
              ) : (
                <CallAvatar name={name(u)} size={twoColumns ? 64 : 96} speaking={talking} theme={theme} />
              )}
              <Text style={[styles.tileName, { color: theme.text }]} numberOfLines={1}>
                {name(u)}
                {isMe && muted ? " 🔇" : ""}
              </Text>
            </View>
          );
        })}
        {g.phase === "connected" && g.participants.length === 0 && (
          <Text style={[styles.hint, { color: theme.mutedText }]}>{t.waitingForOthers}</Text>
        )}
      </ScrollView>

      <View style={styles.buttons}>
        <CallButton icon={muted ? "🔇" : "🎤"} label={muted ? t.unmute : t.mute} active={muted} onPress={controller.toggleMute} theme={theme} />
        {video && <CallButton icon="📷" label={cameraOff ? t.cameraOn : t.cameraOff} active={cameraOff} onPress={controller.toggleCamera} theme={theme} />}
        {video && <CallButton icon="🔄" label={t.flip} onPress={controller.switchCamera} theme={theme} />}
        <CallButton icon="📞" label={t.leave} color={theme.hangUp} rotateIcon onPress={controller.leave} theme={theme} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 1000, elevation: 1000 },
  top: { alignItems: "center", paddingTop: 48, paddingBottom: 12, paddingHorizontal: 24 },
  title: { fontSize: 22, fontWeight: "600" },
  status: { fontSize: 14, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, paddingHorizontal: 8, paddingBottom: 16 },
  tile: { borderRadius: 16, borderWidth: 3, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  tileName: { position: "absolute", left: 8, bottom: 6, right: 8, fontSize: 13, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  hint: { width: "100%", textAlign: "center", marginTop: 16, fontSize: 14 },
  buttons: { flexDirection: "row", justifyContent: "space-evenly", paddingBottom: 40, paddingTop: 12 },
});
