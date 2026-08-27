import { Redis } from "ioredis";
import type { PresenceStore, RoomStore } from "./types.js";

const ROOM_PREFIX = "rtc:room:";
const USER_ROOMS_PREFIX = "rtc:user:rooms:";
const USER_NODE_PREFIX = "rtc:user:node:";

export function createRedisClient(url: string) {
  return new Redis(url, { maxRetriesPerRequest: 3 });
}

export class RedisRoomStore implements RoomStore {
  constructor(private redis: Redis) {}

  async join(roomId: string, userId: string) {
    await this.redis.sadd(`${ROOM_PREFIX}${roomId}`, userId);
    await this.redis.sadd(`${USER_ROOMS_PREFIX}${userId}`, roomId);
  }

  async leave(roomId: string, userId: string) {
    await this.redis.srem(`${ROOM_PREFIX}${roomId}`, userId);
    await this.redis.srem(`${USER_ROOMS_PREFIX}${userId}`, roomId);
  }

  async leaveAll(userId: string) {
    const roomIds = await this.redis.smembers(`${USER_ROOMS_PREFIX}${userId}`);
    if (roomIds.length) {
      const pipeline = this.redis.pipeline();
      for (const roomId of roomIds) {
        pipeline.srem(`${ROOM_PREFIX}${roomId}`, userId);
      }
      pipeline.del(`${USER_ROOMS_PREFIX}${userId}`);
      await pipeline.exec();
    }
    return roomIds;
  }

  async getMembers(roomId: string) {
    return this.redis.smembers(`${ROOM_PREFIX}${roomId}`);
  }

  async isMember(roomId: string, userId: string) {
    return (await this.redis.sismember(`${ROOM_PREFIX}${roomId}`, userId)) === 1;
  }
}

export class RedisPresenceStore implements PresenceStore {
  constructor(private redis: Redis) {}

  async setOnline(userId: string, instanceId: string) {
    await this.redis.set(`${USER_NODE_PREFIX}${userId}`, instanceId);
  }

  async setOffline(userId: string) {
    await this.redis.del(`${USER_NODE_PREFIX}${userId}`);
  }

  async getInstance(userId: string) {
    return this.redis.get(`${USER_NODE_PREFIX}${userId}`);
  }
}

export const RELAY_CHANNEL = "rtc:relay";
