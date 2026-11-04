// Who is signed in to the admin panel (filled after sign-in from /v1/admin/me).
export const me = { email: '', role: 'viewer' as 'owner' | 'admin' | 'viewer' };
export const canEdit = () => me.role === 'owner' || me.role === 'admin';
export const isOwner = () => me.role === 'owner';
export const ROLE_NAMES: Record<string, string> = { owner: 'Owner', admin: 'Admin', viewer: 'View only' };
