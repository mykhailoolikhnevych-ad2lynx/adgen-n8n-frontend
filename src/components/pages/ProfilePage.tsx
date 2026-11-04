import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getAuthEmail } from '@/lib/identity';
import { getRole, hasRole, listRoles, grantRole, revokeRole, type GrantableRole, type Role, type RoleRow } from '@/lib/roles';

// Profile (person icon in the header). Everyone sees their own email and role.
// Admins and owners also see who is admin / subadmin; only owners
// (PUBLIC_ADMIN_EMAILS) get the add / change / revoke controls — n8n enforces
// the same rule.

const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', subadmin: 'Subadmin' };

const RolesManager = ({ isOwner }: { isOwner: boolean }) => {
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<GrantableRole>('subadmin');

  const errMsg = (e: any) => e?.response?.data?.error ?? e?.message ?? String(e);

  const load = async () => {
    setStatus('loading');
    try {
      const res = await listRoles();
      setRows(res.roles);
      setOwners(res.owners);
      setStatus('ready');
      setError(null);
    } catch (e: any) {
      setStatus('error');
      setError(errMsg(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const addValid = newEmail.trim().includes('@');

  return (
    <div className="bg-white rounded-xl border p-4 shadow-sm flex flex-col gap-4">
      <h3 className="font-bold text-lg">Roles</h3>

      {isOwner && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs font-medium uppercase text-slate-500">Email</label>
            <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@ad2lynx.com" />
          </div>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as GrantableRole)}
            className="text-sm border rounded-md px-2 py-2 bg-white"
          >
            <option value="subadmin">Subadmin</option>
            <option value="admin">Admin</option>
          </select>
          <Button
            size="sm"
            disabled={busy || !addValid}
            onClick={() => run(async () => { await grantRole(newEmail, newRole); setNewEmail(''); })}
          >
            Add
          </Button>
        </div>
      )}

      {error && <div className="text-sm text-red-600">{error}</div>}
      {status === 'loading' && rows.length === 0 && <div className="text-sm text-slate-400">Loading…</div>}

      {status !== 'error' && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500 border-b">
            <tr>
              <th className="py-2 px-3">Email</th>
              <th className="py-2 px-3">Role</th>
              <th className="py-2 px-3">Granted by</th>
              <th className="py-2 px-3">Granted at</th>
              {isOwner && <th className="py-2 px-3" />}
            </tr>
          </thead>
          <tbody>
            {owners.map((email) => (
              <tr key={`owner-${email}`} className="border-b">
                <td className="py-2 px-3 font-mono">{email}</td>
                <td className="py-2 px-3 font-semibold">Owner</td>
                <td className="py-2 px-3 text-slate-400">config</td>
                <td className="py-2 px-3" />
                {isOwner && <td className="py-2 px-3" />}
              </tr>
            ))}
            {rows.map((r) => (
              <tr key={r.email} className="border-b">
                <td className="py-2 px-3 font-mono">{r.email}</td>
                <td className="py-2 px-3">
                  {isOwner ? (
                    <select
                      value={r.role}
                      disabled={busy}
                      onChange={(e) => run(() => grantRole(r.email, e.target.value as GrantableRole))}
                      className="text-sm border rounded-md px-2 py-1 bg-white"
                    >
                      <option value="subadmin">Subadmin</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    ROLE_LABEL[r.role]
                  )}
                </td>
                <td className="py-2 px-3 text-slate-500">{r.granted_by}</td>
                <td className="py-2 px-3 text-slate-500">{r.granted_at ? new Date(r.granted_at).toLocaleString() : ''}</td>
                {isOwner && (
                  <td className="py-2 px-3 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Remove ${r.role} role from ${r.email}?`)) void run(() => revokeRole(r.email));
                      }}
                    >
                      Revoke
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {status === 'ready' && rows.length === 0 && (
              <tr><td colSpan={5} className="py-4 px-3 text-slate-400 italic">No admins or subadmins yet.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
};

export const ProfilePage = () => {
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    void Promise.all([getAuthEmail(), getRole()]).then(([ident, r]) => {
      setEmail(ident?.email ?? null);
      setRole(r);
      setResolved(true);
    });
  }, []);

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4 bg-slate-100 overflow-auto">
      <div className="bg-white rounded-xl border p-4 shadow-sm flex flex-col gap-1">
        <h2 className="font-bold text-xl">Profile</h2>
        <div className="text-sm">
          <span className="text-slate-500">Email: </span>
          <span className="font-mono">{resolved ? (email ?? 'not signed in') : '…'}</span>
        </div>
        <div className="text-sm">
          <span className="text-slate-500">Role: </span>
          <span className="font-semibold">{resolved ? (role ? ROLE_LABEL[role] : 'User') : '…'}</span>
        </div>
      </div>

      {hasRole(role, 'admin') && <RolesManager isOwner={role === 'owner'} />}
    </div>
  );
};
