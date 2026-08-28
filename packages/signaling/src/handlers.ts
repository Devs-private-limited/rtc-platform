import type { WebSocket } from "ws";
import type {
  CallInvitePayload,
  CallPeerPayload,
  ClientMessage,
  RecordingReadyPayload,
  RoomMessagePayload,
  ServerMessage,
  TokenClaims,
  WebRtcPayload,
} from "@rtc/protocol";
import type { RoomStore } from "./store/types.js";
import { endCallSession, startCallSession } from "./metering.js";
import { saveRecording } from "./recordings.js";

interface HandlerContext {
  message: ClientMessage;
  claims: TokenClaims;
  ws: WebSocket;
  rooms: RoomStore;
  send: (ws: WebSocket, message: ServerMessage) => void;
  sendToUser: (userId: string, message: ServerMessage) => Promise<boolean>;
  dispatch: (type: string, payload: Record<string, unknown>) => void;
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

export async function handleClientMessage(ctx: HandlerContext) {
  const { message, claims, ws } = ctx;
  const userId = claims.userId;

  switch (message.type) {
    case "join_room": {
      const { roomId } = message.payload as { roomId: string };
      if (!roomId) {
        ctx.send(ws, { type: "error", payload: { message: "roomId is required" } });
        return;
      }
      await ctx.rooms.join(roomId, userId);
      const members = (await ctx.rooms.getMembers(roomId)).filter((id) => id !== userId);
      ctx.send(ws, {
        type: "room_joined",
        payload: { roomId, members },
        requestId: message.requestId,
      });
      for (const memberId of members) {
        await ctx.sendToUser(memberId, {
          type: "user_joined",
          payload: { roomId, userId },
        });
      }
      ctx.dispatch("user.joined", { roomId, userId });
      break;
    }

    case "leave_room": {
      const { roomId } = message.payload as { roomId: string };
      await ctx.rooms.leave(roomId, userId);
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
      const { roomId, text } = message.payload as { roomId: string; text: string };
      if (!(await ctx.rooms.isMember(roomId, userId))) {
        ctx.send(ws, { type: "error", payload: { message: "Join the room first" } });
        return;
      }
      const payload: RoomMessagePayload = {
        roomId,
        fromUserId: userId,
        text,
        sentAt: Date.now(),
      };
      const members = await ctx.rooms.getMembers(roomId);
      for (const memberId of members) {
        if (memberId !== userId) {
          await ctx.sendToUser(memberId, { type: "message", payload });
        }
      }
      ctx.dispatch("message.sent", { roomId, fromUserId: userId });
      break;
    }

    case "call_invite": {
      const { roomId, toUserId, callId } = message.payload as CallInvitePayload;
      if (!(await ctx.rooms.isMember(roomId, userId))) {
        ctx.send(ws, { type: "error", payload: { message: "Join the room first" } });
        return;
      }
      await relayToUser(ctx, toUserId, "call_invite", {
        callId,
        roomId,
        fromUserId: userId,
        toUserId,
        callType: (message.payload as CallInvitePayload).callType,
      } satisfies CallPeerPayload);
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
      } else if (message.type === "call_end") {
        void endCallSession(ctx.claims.appId, payload.callId);
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

    case "recording_ready": {
      const payload = message.payload as RecordingReadyPayload;
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
      break;
    }

    default:
      ctx.send(ws, { type: "error", payload: { message: "Unknown message type" } });
  }
}
