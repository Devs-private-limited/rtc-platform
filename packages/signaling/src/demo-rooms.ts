/**
 * Who may get a demo token for which room.
 *
 * The mobile demo apps used to put everyone in one shared room, so every person
 * who installed the APK could read everyone's chat history. Now:
 * - 1:1 chats use a private room per pair: `dm_<idA>__<idB>` (ids sorted).
 *   A token for it is issued only to one of those two people, and only after
 *   Google confirms the caller really is that person (Google ID token).
 * - The web demo keeps its random, link-shared rooms (`test-<random>`).
 * - Anything else (e.g. the old shared `mobile-test-room`) is refused, so old
 *   APKs can no longer read the shared history.
 */

export const DEFAULT_DEMO_GOOGLE_CLIENT_ID = "247430827249-jub4m96pfcsbscnh1iclt69b3dmu5kvu.apps.googleusercontent.com";

const PAIR_ROOM = /^dm_([A-Za-z0-9_-]{1,48})__([A-Za-z0-9_-]{1,48})$/;
const WEB_DEMO_ROOM = /^test-[A-Za-z0-9]{8,64}$/;

export type DemoRoomKind = { kind: "pair"; members: [string, string] } | { kind: "web" } | { kind: "invalid" };

export function classifyDemoRoom(roomId: string): DemoRoomKind {
  const pair = PAIR_ROOM.exec(roomId);
  if (pair) {
    const [a, b] = [pair[1], pair[2]];
    // Exactly one canonical name per pair: sorted and two different people.
    if (a < b) return { kind: "pair", members: [a, b] };
    return { kind: "invalid" };
  }
  if (WEB_DEMO_ROOM.test(roomId)) return { kind: "web" };
  return { kind: "invalid" };
}

/** Same id the demo apps use: Google account id, made safe for room names. */
export function demoUserIdFromGoogleSub(sub: string) {
  return sub.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<any> }>;

/** Checks a Google ID token with Google and returns the demo user id, or null if not valid. */
export async function verifyGoogleIdToken(idToken: string, clientId: string, fetchImpl: FetchLike = (u) => fetch(u, { signal: AbortSignal.timeout(8000) })): Promise<string | null> {
  if (!idToken || idToken.length > 4096) return null;
  try {
    const res = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) return null;
    const info = await res.json();
    if (info.aud !== clientId) return null;
    if (info.iss !== "accounts.google.com" && info.iss !== "https://accounts.google.com") return null;
    if (!info.sub || Number(info.exp) * 1000 < Date.now()) return null;
    return demoUserIdFromGoogleSub(String(info.sub));
  } catch {
    return null;
  }
}
