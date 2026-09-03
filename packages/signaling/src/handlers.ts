import type { WebSocket } from "ws";
import type {
  CallInvitePayload,
  CallPeerPayload,
  CallQualityReportPayload,
  ClientMessage,
  EndRoomPayload,
  JoinMediaPayload,
  JoinRoomPayload,
  KickUserPayload,
  MuteRemotePayload,
  RecordingReadyPayload,
  RoomMessagePayload,
  ServerMessage,
  TokenClaims,
  WebRtcPayload,
} from "@rtc/protocol";
import type { RoomStore } from "./store/types.js";
import type { RoomRoleStore } from "./room-roles.js";
import { canModerate, canPublish, isAudience } from "./room-roles.js";
import { joinMediaSession, leaveMediaSession } from "./media-sessions.js";
import { MAX_MESSAGE_LENGTH, saveMessage } from "./messages.js";
import { endCallSession, startCallSession } from "./metering.js";
import { saveRecording } from "./recordings.js";
import { saveQualityReport } from "./quality.js";
import { maybeDispatchBillingAlert } from "./billing.js";
import { checkAppFeature } from "./plan-features.js";
import type { PlanFeature } from "./billing-plans.js";
import {
  clearCall,
  clearUserCalls,
  markCallConnected,
  registerRinging,
} from "./call-state.js";

interface HandlerContext {
  message: ClientMessage;
  claims: TokenClaims;
  ws: WebSocket;
  rooms: RoomStore;
  roomRoles: RoomRoleStore;
  send: (ws: WebSocket, message: ServerMessage) => void;
  sendToUser: (userId: string, message: ServerMessage) => Promise<boolean>;
  dispatch: (type: string, payload: Record<string, unknown>) => void;
  forceLeaveRoom: (roomId: string, userId: string, reason: string) => Promise<void>;
}

function assertRoomScope(ctx: HandlerContext, roomId: string, ws: WebSocket) {
  if (ctx.claims.roomId && ctx.claims.roomId !== roomId) {
    ctx.send(ws, {
      type: "error",
      payload: { message: "Token is not valid for this room", code: "room_scope_denied" },
    });
    return false;
  }
  return true;
}

async function relayToUser(
  ctx: HandlerContext,
  toUserId: string,
  type: ServerMessage["type"],
  payload: unknown
) {
  const delivered = await ctx.sendToUser(toUserId, { type, payload } as ServerMessage);
  if (!delivered) {
    ctx.send(ctx.ws, {
      type: "error",
      payload: { message: `User ${toUserId} is offline` },
    });
  }
}

async function requireFeature(
  ctx: HandlerContext,
  feature: PlanFeature
): Promise<boolean> {
  const result = await checkAppFeature(ctx.claims.appId, feature);
  if (result.allowed) return true;
  ctx.send(ctx.ws, {
    type: "error",
    payload: {
      message: result.message,
      code: "plan_feature_denied",
      feature: result.feature,
      plan: result.plan,
    },
  });
  return false;
}

export async function handleClientMessage(ctx: HandlerContext) {
  const { message, claims, ws } = ctx;
  const userId = claims.userId;

  switch (message.type) {
    case "join_room": {
      const { roomId, role } = message.payload as JoinRoomPayload;
      if (!roomId) {
        ctx.send(ws, { type: "error", payload: { message: "roomId is required" } });
        return;
      }
      if (!assertRoomScope(ctx, roomId, ws)) return;
      const requestedRole = role || ctx.claims.role || "publisher";
      const assignedRole = ctx.roomRoles.assign(roomId, userId, requestedRole);
      await ctx.rooms.join(roomId, userId);
      const members = (await ctx.rooms.getMembers(roomId)).filter((id) => id !== userId);
      ctx.send(ws, {
        type: "room_joined",
        payload: { roomId, members, role: assignedRole },
        requestId: message.requestId,
      });
      for (const memberId of members) {
        await ctx.sendToUser(memberId, {
          type: "user_joined",
          payload: { roomId, userId, role: assignedRole },
        });
      }
      ctx.dispatch("user.joined", { roomId, userId, role: assignedRole });
      break;
    }

    case "leave_room": {
      const { roomId } = message.payload as { roomId: string };
      await ctx.rooms.leave(roomId, userId);
      ctx.roomRoles.remove(roomId, userId);
      // Leaving the room ends any group media in it. Done as a direct call
      // rather than a media.left event so subscribers aren't sent a delivery
      // for someone who was never in media — the update matches no rows then.
      void leaveMediaSession(ctx.claims.appId, roomId, userId, "left_room");
      const members = await ctx.rooms.getMembers(roomId);
      for (const memberId of members) {
        await ctx.sendToUser(memberId, {
          type: "user_left",
          payload: { roomId, userId },
        });
      }
      ctx.dispatch("user.left", { roomId, userId });
      break;
    }

    case "send_message": {
      const { roomId, text, clientMsgId } = message.payload as {
        roomId: string;
        text: string;
        clientMsgId?: string;
      };
      if (!(await requireFeature(ctx, "chat"))) return;
      if (typeof text !== "string" || !text.length) {
        ctx.send(ws, { type: "error", payload: { message: "text is required" } });
        return;
      }
      if (text.length > MAX_MESSAGE_LENGTH) {
        ctx.send(ws, {
          type: "error",
          payload: { message: `text exceeds ${MAX_MESSAGE_LENGTH} characters` },
        });
        return;
      }
      if (!(await ctx.rooms.isMember(roomId, userId))) {
        ctx.send(ws, { type: "error", payload: { message: "Join the room first" } });
        return;
      }
      if (!assertRoomScope(ctx, roomId, ws)) return;
      const payload: RoomMessagePayload = {
        roomId,
        fromUserId: userId,
        text,
        sentAt: Date.now(),
        clientMsgId,
      };
      const members = await ctx.rooms.getMembers(roomId);
      for (const memberId of members) {
        if (memberId !== userId) {
          await ctx.sendToUser(memberId, { type: "message", payload });
        }
      }
      // Text is persisted here rather than routed through dispatch, so chat
      // content stays out of the event log and customer webhook payloads.
      void saveMessage(ctx.claims.appId, roomId, userId, text, clientMsgId);
      ctx.dispatch("message.sent", { roomId, fromUserId: userId });
      void maybeDispatchBillingAlert(ctx.claims.appId, (type, payload) =>
        ctx.dispatch(type, payload)
      );
      break;
    }

    case "call_invite": {
      const { roomId, toUserId, callId } = message.payload as CallInvitePayload;
      if (!(await ctx.rooms.isMember(roomId, userId))) {
        ctx.send(ws, { type: "error", payload: { message: "Join the room first" } });
        return;
      }
      if (!assertRoomScope(ctx, roomId, ws)) return;
      const callType = (message.payload as CallInvitePayload).callType || "voice";
      const feature: PlanFeature = callType === "video" ? "video" : "voice";
      if (!(await requireFeature(ctx, feature))) return;

      const busy = registerRinging(ctx.claims.appId, callId, roomId, userId, toUserId);
      if (!busy.ok) {
        ctx.send(ws, {
          type: "error",
          payload: {
            message:
              busy.busyUserId === userId
                ? "You are already in a call"
                : `User ${toUserId} is busy`,
            code: "call_busy",
            busyUserId: busy.busyUserId,
          },
        });
        return;
      }

      const delivered = await ctx.sendToUser(toUserId, {
        type: "call_invite",
        payload: {
          callId,
          roomId,
          fromUserId: userId,
          toUserId,
          callType: (message.payload as CallInvitePayload).callType,
        } satisfies CallPeerPayload,
      });
      if (!delivered) {
        clearCall(callId);
        ctx.send(ctx.ws, {
          type: "error",
          payload: { message: `User ${toUserId} is offline`, code: "user_offline" },
        });
        return;
      }

      ctx.dispatch("call.ringing", {
        callId,
        roomId,
        fromUserId: userId,
        toUserId,
        callType: (message.payload as CallInvitePayload).callType || "voice",
      });
      break;
    }

    case "call_accept":
    case "call_reject":
    case "call_end": {
      const payload = message.payload as CallPeerPayload;
      if (message.type === "call_accept") {
        const callType = payload.callType || "voice";
        const feature: PlanFeature = callType === "video" ? "video" : "voice";
        if (!(await requireFeature(ctx, feature))) return;
        markCallConnected(payload.callId);
      }
      await relayToUser(ctx, payload.toUserId, message.type, {
        ...payload,
        fromUserId: userId,
      });
      const eventType =
        message.type === "call_accept"
          ? "call.connected"
          : message.type === "call_reject"
            ? "call.failed"
            : "call.ended";
      ctx.dispatch(eventType, { ...payload, fromUserId: userId });

      if (message.type === "call_accept") {
        void startCallSession(
          ctx.claims.appId,
          payload.callId,
          payload.roomId,
          payload.toUserId,
          userId
        );
      } else if (message.type === "call_end" || message.type === "call_reject") {
        clearCall(payload.callId);
      }

      if (message.type === "call_end") {
        void endCallSession(ctx.claims.appId, payload.callId, "hangup");
        void maybeDispatchBillingAlert(ctx.claims.appId, (type, p) => ctx.dispatch(type, p));
      } else if (message.type === "call_reject") {
        // No session exists for a call that was never accepted, so this is a
        // no-op in the normal case. It matters when the callee rejects a second
        // invite for a call they had already answered.
        void endCallSession(ctx.claims.appId, payload.callId, "rejected");
      }
      break;
    }

    case "webrtc_offer":
    case "webrtc_answer":
    case "ice_candidate": {
      const payload = message.payload as WebRtcPayload;
      await relayToUser(ctx, payload.toUserId, message.type, {
        ...payload,
        fromUserId: userId,
      });
      break;
    }

    case "sfu_producer": {
      const payload = message.payload as {
        roomId: string;
        producerId: string;
        toUserId?: string;
        callId?: string;
        kind?: "audio" | "video";
        source?: "camera" | "screen";
      };
      if (!payload.roomId || !payload.producerId) {
        ctx.send(ctx.ws, { type: "error", payload: { message: "Invalid SFU payload" } });
        return;
      }
      const role = ctx.roomRoles.get(payload.roomId, userId);
      if (!canPublish(role)) {
        ctx.send(ctx.ws, {
          type: "error",
          payload: {
            message: "Audience members cannot publish media",
            code: "publish_denied",
          },
        });
        return;
      }
      if (payload.kind === "video") {
        const feature: PlanFeature =
          payload.source === "screen" ? "screenShare" : "video";
        if (!(await requireFeature(ctx, feature))) return;
      }
      const messagePayload = {
        roomId: payload.roomId,
        producerId: payload.producerId,
        fromUserId: userId,
        toUserId: payload.toUserId,
        callId: payload.callId,
        kind: payload.kind,
        source: payload.source,
      };
      if (payload.toUserId) {
        await relayToUser(ctx, payload.toUserId, "sfu_producer", messagePayload);
      } else {
        const members = await ctx.rooms.getMembers(payload.roomId);
        for (const memberId of members) {
          if (memberId !== userId) {
            await ctx.sendToUser(memberId, { type: "sfu_producer", payload: messagePayload });
          }
        }
      }
      break;
    }

    case "join_media":
    case "leave_media": {
      const { roomId, kind } = message.payload as JoinMediaPayload;
      if (!roomId) {
        ctx.send(ws, { type: "error", payload: { message: "roomId is required" } });
        return;
      }
      if (kind !== "voice" && kind !== "video") {
        ctx.send(ws, { type: "error", payload: { message: "kind must be voice or video" } });
        return;
      }
      if (!(await ctx.rooms.isMember(roomId, userId))) {
        ctx.send(ws, { type: "error", payload: { message: "Join the room first" } });
        return;
      }
      if (!assertRoomScope(ctx, roomId, ws)) return;

      if (message.type === "join_media") {
        const feature: PlanFeature = kind === "video" ? "groupVideo" : "groupVoice";
        if (!(await requireFeature(ctx, feature))) return;
        const role = ctx.roomRoles.get(roomId, userId);
        if (isAudience(role)) {
          ctx.send(ws, {
            type: "error",
            payload: {
              message: "Audience role can only subscribe — use recv-only SFU join",
              code: "audience_publish_denied",
            },
          });
          return;
        }
      }

      const joining = message.type === "join_media";
      const members = (await ctx.rooms.getMembers(roomId)).filter((id) => id !== userId);
      for (const memberId of members) {
        await ctx.sendToUser(memberId, {
          type: joining ? "media_participant_joined" : "media_participant_left",
          payload: { roomId, userId, kind },
        });
      }

      if (joining) {
        void joinMediaSession(ctx.claims.appId, roomId, userId, kind);
      } else {
        void leaveMediaSession(ctx.claims.appId, roomId, userId, "left");
      }
      ctx.dispatch(joining ? "media.joined" : "media.left", { roomId, userId, kind });
      void maybeDispatchBillingAlert(ctx.claims.appId, (type, p) => ctx.dispatch(type, p));
      break;
    }

    case "kick_user": {
      const { roomId, targetUserId } = message.payload as KickUserPayload;
      if (!roomId || !targetUserId) {
        ctx.send(ws, { type: "error", payload: { message: "roomId and targetUserId required" } });
        return;
      }
      if (!canModerate(ctx.roomRoles.get(roomId, userId))) {
        ctx.send(ws, { type: "error", payload: { message: "Only host can kick users", code: "forbidden" } });
        return;
      }
      await ctx.forceLeaveRoom(roomId, targetUserId, "kicked");
      ctx.dispatch("user.kicked", { roomId, userId: targetUserId, byUserId: userId });
      break;
    }

    case "mute_remote": {
      const payload = message.payload as MuteRemotePayload;
      if (!payload.roomId || !payload.targetUserId) {
        ctx.send(ws, { type: "error", payload: { message: "Invalid mute payload" } });
        return;
      }
      if (!canModerate(ctx.roomRoles.get(payload.roomId, userId))) {
        ctx.send(ws, { type: "error", payload: { message: "Only host can mute remote users", code: "forbidden" } });
        return;
      }
      await ctx.sendToUser(payload.targetUserId, {
        type: "user_muted",
        payload: {
          roomId: payload.roomId,
          targetUserId: payload.targetUserId,
          kind: payload.kind,
          muted: payload.muted,
          byUserId: userId,
        },
      });
      break;
    }

    case "end_room": {
      const { roomId } = message.payload as EndRoomPayload;
      if (!roomId) {
        ctx.send(ws, { type: "error", payload: { message: "roomId is required" } });
        return;
      }
      if (!canModerate(ctx.roomRoles.get(roomId, userId))) {
        ctx.send(ws, { type: "error", payload: { message: "Only host can end the room", code: "forbidden" } });
        return;
      }
      const members = await ctx.rooms.getMembers(roomId);
      for (const memberId of members) {
        if (memberId !== userId) {
          await ctx.forceLeaveRoom(roomId, memberId, "room_ended");
        }
      }
      await ctx.rooms.leave(roomId, userId);
      ctx.roomRoles.clearRoom(roomId);
      ctx.dispatch("room.ended", { roomId, byUserId: userId });
      break;
    }

    case "recording_ready": {
      const payload = message.payload as RecordingReadyPayload;
      if (!(await requireFeature(ctx, "recording"))) return;
      if (!payload.roomId || payload.durationMs == null || !payload.mimeType) {
        ctx.send(ctx.ws, { type: "error", payload: { message: "Invalid recording payload" } });
        return;
      }
      const saved = await saveRecording(ctx.claims.appId, userId, payload);
      ctx.send(ctx.ws, {
        type: "recording_ack",
        payload: {
          recordingId: saved.id,
          roomId: payload.roomId,
          callId: payload.callId,
        },
        requestId: message.requestId,
      });
      ctx.dispatch("recording.ready", { ...payload, userId, recordingId: saved.id });
      void maybeDispatchBillingAlert(ctx.claims.appId, (type, p) => ctx.dispatch(type, p));
      break;
    }

    case "call_quality_report": {
      const payload = message.payload as CallQualityReportPayload;
      if (!payload.roomId || payload.qualityScore == null || !payload.qualityLabel || !payload.metrics) {
        ctx.send(ctx.ws, { type: "error", payload: { message: "Invalid quality report" } });
        return;
      }
      await saveQualityReport(ctx.claims.appId, userId, payload);
      ctx.dispatch("call.quality.report", { ...payload, userId });
      if (payload.qualityLabel === "poor") {
        ctx.dispatch("call.quality.degraded", { ...payload, userId });
      }
      void maybeDispatchBillingAlert(ctx.claims.appId, (type, p) => ctx.dispatch(type, p));
      break;
    }

    default:
      ctx.send(ws, { type: "error", payload: { message: "Unknown message type" } });
  }
}
