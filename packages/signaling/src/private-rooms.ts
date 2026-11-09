/**
 * Private 1:1 rooms for every project: a room named `dm_<userA>__<userB>` can be joined only by
 * userA and userB (either order), whatever token they use. So apps can give each user ONE token
 * without a roomId (needed to be reachable by all contacts) and the pair's chat and calls stay
 * private: nobody else can join the room, read its history or listen in.
 */
export const PRIVATE_ROOM_PREFIX = "dm_";

/** False when `roomId` is a private `dm_` room that does not belong to `userId`. */
export function mayJoinRoom(roomId: string, userId: string): boolean {
  if (!roomId.startsWith(PRIVATE_ROOM_PREFIX)) return true;
  const rest = roomId.slice(PRIVATE_ROOM_PREFIX.length);
  if (rest.startsWith(`${userId}__`)) {
    const other = rest.slice(userId.length + 2);
    if (other && other !== userId) return true;
  }
  if (rest.endsWith(`__${userId}`)) {
    const other = rest.slice(0, rest.length - userId.length - 2);
    if (other && other !== userId) return true;
  }
  return false;
}
