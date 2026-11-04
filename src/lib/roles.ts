// User roles, managed from the Dashboard "Roles" tab and stored in n8n's
// `user_roles` Data Table (MEGATOOL User Roles workflow, PUBLIC_WEBHOOK_ROLES_URL).
//
// Hierarchy: owner > admin > subadmin. A higher role includes every lower one,
// so gate a tab with hasRole(role, 'subadmin') and admins/owners get it too.
//   - owner:    PUBLIC_ADMIN_EMAILS (plus the same list in the n8n Code node).
//               Not stored in the table, can't be revoked from the UI, and the
//               only role allowed to grant/revoke.
//   - admin:    full admin tabs (what used to be "in PUBLIC_ADMIN_EMAILS").
//   - subadmin: reserved for future tabs with partial access.

import axios from 'axios';
import { getAuthEmail, isOwnerEmail } from '@/lib/identity';

export type Role = 'owner' | 'admin' | 'subadmin';
export type GrantableRole = Exclude<Role, 'owner'>;

const RANK: Record<Role, number> = { subadmin: 1, admin: 2, owner: 3 };

export const hasRole = (role: Role | null | undefined, min: Role): boolean =>
  !!role && RANK[role] >= RANK[min];

const ROLES_URL = import.meta.env.PUBLIC_WEBHOOK_ROLES_URL as string | undefined;
const REQUEST_TIMEOUT = 15_000;

const toRole = (v: unknown): Role | null =>
  v === 'owner' || v === 'admin' || v === 'subadmin' ? v : null;

const unwrap = (data: unknown): any => {
  const outer = Array.isArray(data) ? data[0] : data;
  if (outer && typeof outer === 'object' && 'json' in outer) return (outer as any).json;
  return outer;
};

const post = async (body: Record<string, unknown>) => {
  if (!ROLES_URL) throw new Error('PUBLIC_WEBHOOK_ROLES_URL is not set in .env');
  const ident = await getAuthEmail();
  const { data } = await axios.post(
    ROLES_URL,
    { email: ident?.email ?? 'unknown@unknown', ...body },
    { timeout: REQUEST_TIMEOUT },
  );
  return unwrap(data);
};

let _role: Promise<Role | null> | undefined;

/** The signed-in user's role, resolved once per page load. Owners are decided
 *  locally; everyone else is looked up in n8n. If that lookup fails the user is
 *  treated as having no role for now and the next call retries. */
export const getRole = (): Promise<Role | null> => {
  if (_role) return _role;
  _role = (async () => {
    const ident = await getAuthEmail();
    if (isOwnerEmail(ident?.email)) return 'owner';
    if (!ident?.email || !ROLES_URL) return null;
    try {
      return toRole((await post({ action: 'check' }))?.role);
    } catch (e) {
      console.error('[roles] check failed:', e);
      _role = undefined;
      return null;
    }
  })();
  return _role;
};

/** Admin or owner. This is what the `is_admin` flag sent to n8n means. */
export const getIsAdmin = async (): Promise<boolean> => hasRole(await getRole(), 'admin');

export interface RoleRow {
  email: string;
  role: GrantableRole;
  granted_by: string;
  granted_at: string;
}

/** Everyone with a role in the table, plus the owner list. Admins and owners only. */
export const listRoles = async (): Promise<{ roles: RoleRow[]; owners: string[] }> => {
  const payload = await post({ action: 'list' });
  const roles: RoleRow[] = (Array.isArray(payload?.roles) ? payload.roles : [])
    .filter((r: any) => r?.email && (r.role === 'admin' || r.role === 'subadmin'))
    .map((r: any) => ({
      email: String(r.email),
      role: r.role,
      granted_by: String(r.granted_by ?? ''),
      granted_at: String(r.granted_at ?? ''),
    }));
  const owners: string[] = Array.isArray(payload?.owners) ? payload.owners.map(String) : [];
  return { roles, owners };
};

/** Give `email` a role, replacing any role they had. Owners only. */
export const grantRole = async (email: string, role: GrantableRole): Promise<void> => {
  await post({ action: 'grant', target_email: email.trim().toLowerCase(), role });
};

/** Remove `email` from the table. Owners only. */
export const revokeRole = async (email: string): Promise<void> => {
  await post({ action: 'revoke', target_email: email.trim().toLowerCase() });
};
