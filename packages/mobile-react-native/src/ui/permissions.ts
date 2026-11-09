import { PermissionsAndroid, Platform } from "react-native";

/**
 * Android: ask for microphone (and camera for video). Android 13+ also asks once for notifications:
 * without it Android hides the "Ongoing call" notification (with Hang up) while the app is in the
 * background. Saying no to notifications does not block the call.
 * iOS asks by itself the first time media starts.
 */
export async function requestCallPermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const required = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
  const notifications = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
  const askNotifications = typeof Platform.Version === "number" && Platform.Version >= 33 && !!notifications;
  try {
    const result = await PermissionsAndroid.requestMultiple(askNotifications ? [...required, notifications] : required);
    return required.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}
