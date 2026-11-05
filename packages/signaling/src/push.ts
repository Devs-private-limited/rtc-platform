import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { getPool } from "./db.js";
import { findUserCall } from "./call-state.js";

import { storedPushCredentials, apnsCredentials, type FirebaseCredentials as ServiceAccount } from "./push-credentials.js";
import { sendApns, type PushResult } from './apns.js';
const accessTokens = new Map<string, { token: string; expires: number }>();
/** Ringing calls we sent an Android push for (key appId:callId -> callee), so we can cancel the ringing later. */
const pushedRingingCalls = new Map<string, { appId: string; userId: string; expiresAt: number }>();

export async function pushCredentials(appId: string): Promise<ServiceAccount | null> {
  const stored = await storedPushCredentials(appId);
  if (stored !== undefined) return stored;
  const file = process.env.FCM_CONFIG_FILE;
  if (!file) return null;
  const projects = JSON.parse(await readFile(file, "utf8")) as Record<string, ServiceAccount>;
  const credentials = Object.hasOwn(projects, appId) ? projects[appId] : null;
  if (!credentials) return null;
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(credentials.project_id) || typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string") {
    throw new Error("Invalid FCM project configuration");
  }
  return credentials;
}

async function accessToken(credentials: ServiceAccount) {
  const key = createHash("sha256").update(JSON.stringify(credentials)).digest("hex");
  const cached = accessTokens.get(key);
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const assertion = jwt.sign({ scope: "https://www.googleapis.com/auth/firebase.messaging" }, credentials.private_key, {
    algorithm: "RS256", issuer: credentials.client_email, audience: "https://oauth2.googleapis.com/token", expiresIn: 3600,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(5000),
  });
  const result = await response.json() as { access_token?: string; expires_in?: number };
  if (!response.ok || !result.access_token) throw new Error("FCM authorization failed");
  accessTokens.set(key, { token: result.access_token, expires: Date.now() + Math.min(result.expires_in || 3600, 3600) * 1000 });
  return result.access_token;
}

export async function sendFcm(credentials: ServiceAccount, token: string, data: Record<string,string>, ttl: number, notification?: {title:string;body:string}): Promise<PushResult> {
  try {
    const bearer=await accessToken(credentials);
    const response=await fetch(`https://fcm.googleapis.com/v1/projects/${credentials.project_id}/messages:send`,{
      method:'POST',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},
      body:JSON.stringify({message:{token,android:{priority:'HIGH',ttl:`${ttl}s`},data,...(notification?{notification}:{})}}),signal:AbortSignal.timeout(5000),
    });
    const result=await response.json() as {error?:{details?:Array<{errorCode?:string}>}};
    return {success:response.ok,status:response.status,invalidToken:result.error?.details?.some(d=>d.errorCode==='UNREGISTERED'),retryable:response.status===429 || response.status>=500};
  } catch {return {success:false,status:null,retryable:true};}
}

export async function sendCallPush(appId: string, payload: Record<string, unknown>) {
  const db = getPool();
  if (!db || typeof payload.toUserId !== "string" || typeof payload.callId !== "string") return;
  const credentials = await pushCredentials(appId).catch(()=>null);
  const devices = await db.query(`SELECT installation_id, token,platform,push_type,bundle_id,environment FROM push_devices WHERE app_id = $1 AND user_id = $2 AND (platform='android' OR push_type='voip') AND updated_at > NOW() - INTERVAL '90 days' ORDER BY updated_at DESC LIMIT 10`, [appId, payload.toUserId]);
  if (!devices.rowCount) return;
  await Promise.all(devices.rows.map(async (device) => {
    const call = findUserCall(appId, payload.toUserId as string);
    if (!call || call.callId !== payload.callId || call.phase !== "ringing" || call.ringingExpiresAt <= Date.now()) return;
    const ttl = Math.max(1, Math.floor((call.ringingExpiresAt - Date.now()) / 1000));
    let result:PushResult={success:false,status:null,retryable:false};
    try {
      const data = {
          type: "rtc_call_invite", callId: call.callId, roomId: call.roomId,
          fromUserId: call.callerUserId, callType: call.callType, expiresAt: String(call.ringingExpiresAt),
      };
      if(device.platform==='ios') {
        const ios=await apnsCredentials(appId,device.bundle_id,device.environment);
        if(!ios)return;
        result=await sendApns(ios,device.token,'voip',{aps:{},...data},Date.now()+ttl*1000);
      } else {
        if(!credentials)return;
        result=await sendFcm(credentials,device.token,data,ttl);
        if(result.success) pushedRingingCalls.set(`${appId}:${call.callId}`,{appId,userId:call.calleeUserId,expiresAt:call.ringingExpiresAt});
      }
      if (result.invalidToken) {
        await db.query(`DELETE FROM push_devices WHERE app_id = $1 AND installation_id = $2 AND token = $3`, [appId, device.installation_id, device.token]);
      }
    } catch { /* Persist only status, never device tokens or credentials. */ }
    await db.query(`INSERT INTO push_deliveries (app_id, call_id, installation_id, success, status_code,platform,push_type) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [appId, call.callId, device.installation_id, result.success, result.status,device.platform || 'android',device.push_type || 'alert']);
  }));
}

/** Missed-call alerts are kept by FCM/APNs for a day, so a phone that was off still shows one when it comes back. */
export const MISSED_CALL_TTL_SECONDS = 24 * 60 * 60;

export interface MissedCall {
  callId: string;
  roomId: string;
  callerUserId: string;
  calleeUserId: string;
  callType: "voice" | "video";
}

// Sent when a ringing call ends without an answer (ring timeout, or the caller hung up first).
// Uses the callee's alert tokens, not VoIP tokens: this is an ordinary visible notification.
export async function sendMissedCallPush(appId: string, call: MissedCall) {
  const db = getPool();
  if (!db) return;
  const devices = await db.query(`SELECT installation_id, token, platform, bundle_id, environment FROM push_devices WHERE app_id = $1 AND user_id = $2 AND push_type = 'alert' AND updated_at > NOW() - INTERVAL '90 days' ORDER BY updated_at DESC LIMIT 10`, [appId, call.calleeUserId]);
  if (!devices.rowCount) return;
  const credentials = await pushCredentials(appId).catch(() => null);
  const data = { type: "rtc_missed_call", callId: call.callId, roomId: call.roomId, fromUserId: call.callerUserId, callType: call.callType };
  const notification = { title: "Missed call", body: call.callType === "video" ? "You missed a video call." : "You missed a voice call." };
  const expiresAt = Date.now() + MISSED_CALL_TTL_SECONDS * 1000;
  await Promise.all(devices.rows.map(async (device) => {
    let result: PushResult = { success: false, status: null, retryable: false };
    try {
      if (device.platform === "ios") {
        const ios = await apnsCredentials(appId, device.bundle_id, device.environment);
        if (!ios) return;
        result = await sendApns(ios, device.token, "alert", { aps: { alert: notification, sound: "default" }, ...data }, expiresAt);
      } else {
        if (!credentials) return;
        result = await sendFcm(credentials, device.token, data, MISSED_CALL_TTL_SECONDS, notification);
      }
      if (result.invalidToken) {
        await db.query(`DELETE FROM push_devices WHERE app_id = $1 AND installation_id = $2 AND token = $3`, [appId, device.installation_id, device.token]);
      }
    } catch { /* Persist only status, never device tokens or credentials. */ }
    await db.query(`INSERT INTO push_deliveries (app_id, call_id, installation_id, success, status_code,platform,push_type) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [appId, call.callId, device.installation_id, result.success, result.status, device.platform || "android", "alert"]);
  }));
}

/**
 * The call stopped ringing (caller hung up, callee declined or answered, or no answer).
 * Tell the callee's Android phones to stop the ringing notification: without this a phone
 * that got the call by push (app closed) keeps ringing until the timeout.
 */
export async function sendCallCancelPush(appId: string, callId: unknown, reason: string) {
  if (typeof callId !== "string") return;
  const now = Date.now();
  for (const [key, entry] of pushedRingingCalls) if (entry.expiresAt + 60_000 < now) pushedRingingCalls.delete(key);
  const key = `${appId}:${callId}`;
  const entry = pushedRingingCalls.get(key);
  if (!entry) return;
  pushedRingingCalls.delete(key);
  const db = getPool();
  const credentials = await pushCredentials(appId).catch(() => null);
  if (!db || !credentials) return;
  const devices = await db.query(`SELECT token FROM push_devices WHERE app_id = $1 AND user_id = $2 AND platform = 'android' AND updated_at > NOW() - INTERVAL '90 days' ORDER BY updated_at DESC LIMIT 10`, [appId, entry.userId]);
  await Promise.all(devices.rows.map((device) => sendFcm(credentials, device.token, { type: "rtc_call_cancel", callId, reason }, 60)));
}

/** Test helper */
export function pushedRingingCallCount() {
  return pushedRingingCalls.size;
}
