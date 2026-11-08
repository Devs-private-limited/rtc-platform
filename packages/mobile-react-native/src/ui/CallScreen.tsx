import React, { useEffect } from "react";
import { BackHandler, Platform, StatusBar, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { RTCVideoView } from "../video";
import { CallAvatar, CallButton, MinimizeButton, useNow } from "./parts";
import { defaultCallLabels, defaultCallTheme, formatDuration, type RTCCallLabels, type RTCCallTheme } from "./theme";
import type { RTCCall, RTCCallController } from "./useRTCCall";

export interface CallScreenProps {
  /** The value returned by useRTCCall(rtc). */
  controller: RTCCallController;
  /** Show a name instead of the raw user ID, e.g. (id) => contacts[id]?.name ?? id. */
  displayName?(userId: string): string;
  theme?: Partial<RTCCallTheme>;
  /** Change any text, e.g. for another language. */
  labels?: Partial<RTCCallLabels>;
  style?: StyleProp<ViewStyle>;
}

/**
 * Ready-made full-screen 1:1 call UI: incoming (Answer/Decline), outgoing (Ringing…),
 * in-call (timer, mute, camera, flip, end) and a short "Call ended" message.
 * Renders nothing when there is no call. Put it last in your root view so it covers the app.
 */
export function CallScreen({ controller, displayName, theme: themeIn, labels: labelsIn, style }: CallScreenProps) {
  const theme = { ...defaultCallTheme, ...themeIn };
  const t = { ...defaultCallLabels, ...labelsIn };
  const { call, muted, cameraOff, peerSpeaking, sharingScreen, remoteScreenUserId } = controller;
  const now = useNow(call?.phase === "connected");

  // Android back button must not navigate the app behind an active call.
  useEffect(() => {
    if (!call || controller.minimized) return;
    // Android back button: keep the call, show the app with the ongoing-call bar (incoming calls must be answered first).
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      controller.minimize();
      return true;
    });
    return () => sub.remove();
  }, [!!call, controller.minimized, controller.minimize]);

  if (!call || controller.minimized) return null;

  const name = displayName ? displayName(call.peerUserId) : call.peerUserId;
  const ringingHere = call.direction === "incoming" && call.phase === "ringing";
  const ended = call.phase === "ended";
  const connected = call.phase === "connected";
  // The other person shares their screen: screen big, cameras small at the bottom.
  const showScreen = !!remoteScreenUserId && connected && Platform.OS === "android";
  const showVideo = (call.video || showScreen) && !ended && !ringingHere && Platform.OS === "android";
  const showRemote = showVideo && connected;

  return (
    <View style={[StyleSheet.absoluteFill, styles.root, { backgroundColor: theme.background }, style]}>
      <StatusBar barStyle="light-content" />
      {showScreen && (
        <View style={StyleSheet.absoluteFill}>
          <RTCVideoView screen userId={remoteScreenUserId!} style={styles.fill} />
          {call.video && (
            <View style={styles.strip}>
              <View style={styles.stripTile}>
                <RTCVideoView local={false} style={styles.fill} />
              </View>
              <View style={styles.stripTile}>
                {cameraOff ? <CallAvatar name={t.you} size={40} theme={theme} /> : <RTCVideoView local style={styles.fill} />}
              </View>
            </View>
          )}
        </View>
      )}
      {showVideo && !showScreen && (
        <View style={StyleSheet.absoluteFill}>
          {showRemote ? <RTCVideoView local={false} style={styles.fill} /> : !cameraOff && <RTCVideoView local style={styles.fill} />}
          {showRemote && (
            <View style={styles.selfView}>
              {cameraOff ? <CallAvatar name={t.you} size={48} theme={theme} /> : <RTCVideoView local style={styles.fill} />}
            </View>
          )}
        </View>
      )}

      {!ringingHere && !ended && <MinimizeButton onPress={controller.minimize} color={theme.text} />}
      <View style={[styles.top, showVideo && styles.topOverVideo]}>
        {!showVideo && <CallAvatar name={name} size={112} speaking={peerSpeaking || ringingHere} theme={theme} />}
        <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.status, { color: theme.mutedText }]}>
          {showScreen ? `${t.isSharing} · ` : ""}
          {statusText(call, t, now, peerSpeaking)}
        </Text>
        {sharingScreen && !ended && (
          <View style={[styles.sharingPill, { backgroundColor: theme.hangUp }]}>
            <Text style={styles.sharingText}>● {t.youAreSharing}</Text>
          </View>
        )}
        {!!call.error && <Text style={[styles.error, { color: "#fecaca" }]}>{call.error}</Text>}
      </View>

      {!ended && (
        <View style={styles.buttons}>
          {ringingHere ? (
            <>
              <CallButton icon="📞" label={t.decline} color={theme.hangUp} rotateIcon onPress={controller.decline} theme={theme} size={72} />
              <CallButton icon={call.video ? "🎥" : "📞"} label={t.answer} color={theme.accept} onPress={() => void controller.accept()} theme={theme} size={72} />
            </>
          ) : (
            <>
              <CallButton icon={muted ? "🔇" : "🎤"} label={muted ? t.unmute : t.mute} active={muted} onPress={controller.toggleMute} theme={theme} />
              {call.video && <CallButton icon="📷" label={cameraOff ? t.cameraOn : t.cameraOff} active={cameraOff} onPress={controller.toggleCamera} theme={theme} />}
              {call.video && <CallButton icon="🔄" label={t.flip} onPress={controller.switchCamera} theme={theme} />}
              {connected && controller.canShareScreen && (
                <CallButton icon="🖥️" label={sharingScreen ? t.stopSharing : t.shareScreen} active={sharingScreen} onPress={controller.toggleScreenShare} theme={theme} />
              )}
              <CallButton icon="📞" label={t.hangUp} color={theme.hangUp} rotateIcon onPress={controller.hangUp} theme={theme} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

function statusText(call: RTCCall, t: RTCCallLabels, now: number, peerSpeaking: boolean) {
  if (call.phase === "ended") return t[call.endReason || "ended"];
  if (call.direction === "incoming" && call.phase === "ringing") return call.video ? t.incomingVideo : t.incomingVoice;
  if (call.phase === "connected" && call.connectedAt) {
    const base = `${call.video ? t.videoCall : t.voiceCall} · ${formatDuration(now - call.connectedAt)}`;
    return peerSpeaking ? `${base} · ${t.speaking}` : base;
  }
  return call.phase === "connecting" ? t.connecting : t.ringing;
}

const styles = StyleSheet.create({
  root: { zIndex: 1000, elevation: 1000, justifyContent: "space-between" },
  fill: { flex: 1 },
  selfView: { position: "absolute", right: 16, top: 48, width: 104, height: 150, borderRadius: 12, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  top: { alignItems: "center", paddingTop: 96, paddingHorizontal: 24 },
  topOverVideo: { paddingTop: 40, alignItems: "flex-start", paddingLeft: 68, paddingRight: 132, paddingBottom: 8 },
  strip: { position: "absolute", left: 0, right: 0, bottom: 150, flexDirection: "row", justifyContent: "center", gap: 10 },
  stripTile: { width: 96, height: 128, borderRadius: 12, overflow: "hidden", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  sharingPill: { marginTop: 10, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  sharingText: { color: "#ffffff", fontSize: 13, fontWeight: "600" },
  name: { fontSize: 28, fontWeight: "600", marginTop: 20, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 4 },
  status: { fontSize: 15, marginTop: 6, textShadowColor: "rgba(0,0,0,0.5)", textShadowRadius: 4 },
  error: { fontSize: 13, marginTop: 10, textAlign: "center" },
  buttons: { flexDirection: "row", justifyContent: "space-evenly", alignItems: "flex-start", paddingBottom: 56, paddingHorizontal: 6 },
});
