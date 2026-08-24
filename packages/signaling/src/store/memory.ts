import type { PresenceStore, RoomStore } from "./types.js";

export class MemoryRoomStore implements RoomStore {
  private rooms = new Map<string, Set<string>>();
  private userRooms = new Map<string, Set<string>>();

  async join(roomId: string, userId: string) {
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Set());
    this.rooms.get(roomId)!.add(userId);
    if (!this.userRooms.has(userId)) this.userRooms.set(userId, new Set());
    this.userRooms.get(userId)!.add(roomId);
  }

  async leave(roomId: string, userId: string) {
    this.rooms.get(roomId)?.delete(userId);
    if (this.rooms.get(roomId)?.size === 0) this.rooms.delete(roomId);
    this.userRooms.get(userId)?.delete(roomId);
  }

  async leaveAll(userId: string) {
    const roomIds = [...(this.userRooms.get(userId) || [])];
    for (const roomId of roomIds) await this.leave(roomId, userId);
    this.userRooms.delete(userId);
    return roomIds;
  }

  async getMembers(roomId: string) {
    return [...(this.rooms.get(roomId) || [])];
  }

  async isMember(roomId: string, userId: string) {
    return this.rooms.get(roomId)?.has(userId) ?? false;
  }
}

export class MemoryPresenceStore implements PresenceStore {
  private users = new Map<string, string>();

  async setOnline(userId: string, instanceId: string) {
    this.users.set(userId, instanceId);
  }

  async setOffline(userId: string) {
    this.users.delete(userId);
  }

  async getInstance(userId: string) {
    return this.users.get(userId) ?? null;
  }
}
