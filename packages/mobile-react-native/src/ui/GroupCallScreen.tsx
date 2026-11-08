import React, { useEffect } from "react";
import { BackHandler, Platform, ScrollView, StatusBar, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { RTCVideoView } from "../video";
import { CallAvatar, CallButton, MinimizeButton, useNow } from "./parts";
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
  const { groupCall: g, speaking, muted, cameraOff, sharingScreen, screenSharers } = controller;
  const now = useNow(g?.phase === "connected");

  useEffect(() => {
    if (!g || controller.minimized) return;
    // Android back button: keep the call, show the app with the ongoing-call bar (incoming calls must be answered first).
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      controller.minimize();
      return true;
    });
    return () => sub.remove();
  }, [!!g, controller.minimized, controller.minimize]);

  if (!g || controller.minimized) return null;

  const video = g.kind === "video" && Platform.OS === "android";
  const people = [userId, ...g.participants];
  const twoColumns = people.length > 1;
  const name = (u: string) => (u === userId ? t.you : displayName ? displayName(u) : u);
  const presenter = Platform.OS === "android" ? screenSharers[screenSharers.length - 1] : undefined;

  function tile(u: string, small: boolean) {
    const isMe = u === userId;
    const talking = speaking.includes(u) && !(isMe && muted);
    const size = small ? { width: 88, height: video ? 120 : 88 } : { width: twoColumns ? "47%" : "94%", aspectRatio: video ? 3 / 4 : 1 };
    return (
      <View key={u} style={[styles.tile, size as object, { borderColor: talking ? theme.speaking : "transparent" }]}>
        {video && !(isMe && cameraOff) ? (
          isMe ? <RTCVideoView local style={StyleSheet.absoluteFill} /> : <RTCVideoView userId={u} style={StyleSheet.absoluteFill} />
        ) : (
          <CallAvatar name={name(u)} size={small ? 44 : twoColumns ? 64 : 96} speaking={talking} theme={theme} />
        )}
        <Text style={[styles.tileName, small && styles.tileNameSmall, { color: theme.text }]} numberOfLines={1}>
          {name(u)}
          {isMe && muted ? " 🔇" : ""}
        </Text>
      </View>
    );
  }

  const status =
    g.phase === "connected" && g.joinedAt
      ? `${g.kind === "video" ? t.videoCall : t.voiceCall} · ${people.length} · ${formatDuration(now - g.joinedAt)}`
      : t.joining;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: theme.background }, style]}>
      <StatusBar barStyle="light-content" />
      <MinimizeButton onPress={controller.minimize} color={theme.text} />
      <View style={styles.top}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
          {title || (g.kind === "video" ? t.videoCall : t.voiceCall)}
        </Text>
        <Text style={[styles.status, { color: theme.mutedText }]}>{status}</Text>
      </View>

      {!!controller.error && (
        <Text style={[styles.status, { color: theme.mutedText, textAlign: "center", paddingHorizontal: 24 }]}>{controller.error}</Text>
      )}

      {sharingScreen && (
        <View style={[styles.sharingPill, { backgroundColor: theme.hangUp }]}>
          <Text style={styles.sharingText}>● {t.youAreSharing}</Text>
        </View>
      )}

      {presenter ? (
        <>
          {/* Someone shares their screen: the screen big, everyone small in a row below it. */}
          <View style={styles.screenArea}>
            <RTCVideoView screen userId={presenter} style={styles.fill} />
            <Text style={[styles.screenLabel, { color: theme.text }]} numberOfLines={1}>
              {name(presenter)} {t.isSharing}
            </Text>
          </View>
          <ScrollView horizontal style={styles.stripScroll} contentContainerStyle={styles.strip}>
            {people.map((u) => tile(u, true))}
          </ScrollView>
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {people.map((u) => tile(u, false))}
          {g.phase === "connected" && g.participants.length === 0 && (
            <Text style={[styles.hint, { color: theme.mutedText }]}>{t.waitingForOthers}</Text>
          )}
        </ScrollView>
      )}

      <View style={styles.buttons}>
        <CallButton icon={muted ? "🔇" : "🎤"} label={muted ? t.unmute : t.mute} active={muted} onPress={controller.toggleMute} theme={theme} />
        {video && <CallButton icon="📷" label={cameraOff ? t.cameraOn : t.cameraOff} active={cameraOff} onPress={controller.toggleCamera} theme={theme} />}
        {video && <CallButton icon="🔄" label={t.flip} onPress={controller.switchCamera} theme={theme} />}
        {g.phase === "connected" && controller.canShareScreen && (
          <CallButton icon="🖥️" label={sharingScreen ? t.stopSharing : t.shareScreen} active={sharingScreen} onPress={controller.toggleScreenShare} theme={theme} />
        )}
        <CallButton icon="📞" label={t.leave} color={theme.hangUp} rotateIcon onPress={controller.leave} theme={theme} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { zIndex: 1000, elevation: 1000 },
  fill: { flex: 1 },
  screenArea: { flex: 1, marginHorizontal: 8, borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  screenLabel: { position: "absolute", left: 10, top: 8, right: 10, fontSize: 13, textShadowColor: "rgba(0,0,0,0.7)", textShadowRadius: 3 },
  stripScroll: { flexGrow: 0, marginTop: 10 },
  strip: { gap: 8, paddingHorizontal: 8 },
  tileNameSmall: { fontSize: 11, left: 5, bottom: 3 },
  sharingPill: { alignSelf: "center", marginBottom: 8, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  sharingText: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  top: { alignItems: "center", paddingTop: 48, paddingBottom: 12, paddingHorizontal: 24 },
  title: { fontSize: 22, fontWeight: "600" },
  status: { fontSize: 14, marginTop: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, paddingHorizontal: 8, paddingBottom: 16 },
  tile: { borderRadius: 16, borderWidth: 3, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  tileName: { position: "absolute", left: 8, bottom: 6, right: 8, fontSize: 13, textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 3 },
  hint: { width: "100%", textAlign: "center", marginTop: 16, fontSize: 14 },
  buttons: { flexDirection: "row", justifyContent: "space-evenly", paddingBottom: 40, paddingTop: 12 },
});
