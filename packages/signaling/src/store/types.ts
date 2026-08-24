export interface RoomStore {
  join(roomId: string, userId: string): Promise<void>;
  leave(roomId: string, userId: string): Promise<void>;
  leaveAll(userId: string): Promise<string[]>;
  getMembers(roomId: string): Promise<string[]>;
  isMember(roomId: string, userId: string): Promise<boolean>;
}

export interface PresenceStore {
  setOnline(userId: string, instanceId: string): Promise<void>;
  setOffline(userId: string): Promise<void>;
  getInstance(userId: string): Promise<string | null>;
}
