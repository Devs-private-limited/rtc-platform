import { PermissionsAndroid, Platform } from "react-native";

/** Android: ask for microphone (and camera for video). iOS asks by itself the first time media starts. */
export async function requestCallPermissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])];
  try {
    const result = await PermissionsAndroid.requestMultiple(wanted);
    return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}
