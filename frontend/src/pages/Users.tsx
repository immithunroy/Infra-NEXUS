import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { ROLE_LABELS, ROLE_OPTIONS, UserOut, canManageUsers } from "../api/types";
import { useUserRole } from "../lib/role";
import ActionResultBanner from "../components/ActionResultBanner";
import { fmtTimeShort } from "../lib/time";

interface FormState {
  id?: number;
  username: string;
  password: string;
  role: string;
  full_name: string;
  email: string;
  is_active: boolean;
}

const emptyForm: FormState = {
  username: "",
  password: "",
  role: "global_read",
  full_name: "",
  email: "",
  is_active: true,
};

const roleBadge: Record<string, string> = {
  admin: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  global_write: "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
  global_read: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  noc: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  field_team: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const roleDesc: Record<string, string> = {
  admin: "Full access incl. user management",
  global_write: "Read + write everywhere except user management",
  global_read: "Read-only access",
  noc: "Read + network operations (scan / test / down detection)",
  field_team: "Read + update address & GPS only",
};

interface SyncResult {
  created: number;
  updated: number;
  deactivated: number;
  message: string;
}

export default function Users() {
  const { role } = useUserRole();
  const [users, setUsers] = useState<UserOut[]>([]);
  const [modal, setModal] = useState<FormState | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const load = () => {
    api.get<UserOut[]>("/users").then(setUsers).catch((e) => flash(String(e), false));
  };

  useEffect(load, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    try {
      if (modal.id) {
        const payload: Record<string, unknown> = {};
        if (modal.username) payload.username = modal.username;
        if (modal.role) payload.role = modal.role;
        if (modal.full_name !== undefined) payload.full_name = modal.full_name;
        if (modal.email !== undefined) payload.email = modal.email;
        if (modal.is_active !== undefined) payload.is_active = modal.is_active;
        if (modal.password) payload.password = modal.password;
        await api.put(`/users/${modal.id}`, payload);
        flash("User updated");
      } else {
        await api.post("/users", {
          username: modal.username,
          password: modal.password,
          role: modal.role,
        });
        flash("User created");
      }
      setModal(null);
      load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    }
  };

  const remove = async (u: UserOut) => {
    if (!confirm(`Remove user ${u.username}?`)) return;
    try {
      await api.del(`/users/${u.id}`);
      flash("User removed");
      load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", false);
    }
  };

  const quickRoleChange = async (u: UserOut, newRole: string) => {
    try {
      await api.put(`/users/${u.id}`, { role: newRole });
      flash(`${u.username} role changed to ${ROLE_LABELS[newRole] || newRole}`);
      load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Role change failed", false);
    }
  };

  const toggleActive = async (u: UserOut) => {
    try {
      await api.put(`/users/${u.id}`, { is_active: u.is_active === false });
      flash(`${u.username} ${u.is_active === false ? "activated" : "deactivated"}`);
      load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Status change failed", false);
    }
  };

  const syncHrm = async () => {
    if (!confirm("Sync users from HRM? This will create new users and update existing ones.")) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await api.post<SyncResult>("/users/sync-hrm", {});
      setSyncResult(result);
      flash(result.message);
      load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Sync failed", false);
    } finally {
      setSyncing(false);
    }
  };

  const activeCount = users.filter((u) => u.is_active !== false).length;
  const inactiveCount = users.filter((u) => u.is_active === false).length;
  const hrmCount = users.filter((u) => u.hrm_id).length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Users & Roles</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {activeCount} active · {inactiveCount} inactive · {hrmCount} synced from HRM
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManageUsers(role) && (
            <button className="btn-secondary text-sm" onClick={syncHrm} disabled={syncing}>
              {syncing ? "Syncing…" : "🔄 Sync from HRM"}
            </button>
          )}
          {canManageUsers(role) && (
            <button className="btn-primary" onClick={() => setModal({ ...emptyForm })}>
              + Add user
            </button>
          )}
        </div>
      </header>

      {notice && <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />}

      {syncResult && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Last HRM Sync Result</p>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-emerald-700 dark:text-emerald-400">✅ {syncResult.created} created</span>
            <span className="text-blue-700 dark:text-blue-400">✏️ {syncResult.updated} updated</span>
            <span className="text-amber-700 dark:text-amber-400">⚠️ {syncResult.deactivated} deactivated</span>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ROLE_OPTIONS.map((r) => (
          <div key={r} className="card p-4">
            <div className="flex items-center gap-2">
              <span className={`badge ${roleBadge[r]}`}>{ROLE_LABELS[r]}</span>
            </div>
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{roleDesc[r]}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <div className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
          Accounts ({users.length})
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="th">Username</th>
              <th className="th hidden md:table-cell">Name</th>
              <th className="th hidden lg:table-cell">Email</th>
              <th className="th">Role</th>
              <th className="th hidden sm:table-cell">Status</th>
              <th className="th hidden xl:table-cell">Synced</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {users.map((u) => (
              <tr key={u.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 ${u.is_active === false ? "opacity-50" : ""}`}>
                <td className="td font-medium text-slate-800 dark:text-slate-100">
                  {u.username}
                  {u.hrm_id && <span className="ml-1.5 text-[10px] text-slate-400" title="Synced from HRM">🔗</span>}
                </td>
                <td className="td hidden md:table-cell text-slate-600 dark:text-slate-400">{u.full_name || "—"}</td>
                <td className="td hidden lg:table-cell text-slate-500 text-xs">{u.email || "—"}</td>
                <td className="td">
                  {canManageUsers(role) && u.id !== 1 ? (
                    <select
                      className={`text-xs rounded px-1.5 py-0.5 border-0 font-medium cursor-pointer ${roleBadge[u.role] || roleBadge.global_read}`}
                      value={u.role}
                      onChange={(e) => quickRoleChange(u, e.target.value)}
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  ) : (
                    <span className={`badge ${roleBadge[u.role] || roleBadge.global_read}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                  )}
                </td>
                <td className="td hidden sm:table-cell">
                  {canManageUsers(role) && u.id !== 1 ? (
                    <button
                      className={`inline-flex items-center gap-1.5 text-xs font-medium cursor-pointer transition-colors ${
                        u.is_active === false
                          ? "text-slate-400 hover:text-slate-600"
                          : "text-emerald-600 hover:text-emerald-800"
                      }`}
                      onClick={() => toggleActive(u)}
                      title={u.is_active === false ? "Click to activate" : "Click to deactivate"}
                    >
                      <span className={`inline-block w-2 h-2 rounded-full ${u.is_active === false ? "bg-slate-300" : "bg-emerald-500"}`} />
                      {u.is_active === false ? "inactive" : "active"}
                    </button>
                  ) : (
                    <span className={`badge ${
                      u.is_active === false
                        ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                    }`}>
                      {u.is_active === false ? "inactive" : "active"}
                    </span>
                  )}
                </td>
                <td className="td hidden xl:table-cell text-xs text-slate-400">
                  {u.last_synced_at ? fmtTimeShort(u.last_synced_at) : "—"}
                </td>
                <td className="td">
                  <div className="flex gap-1">
                    <button
                      className="btn-ghost"
                      onClick={() =>
                        setModal({
                          id: u.id,
                          username: u.username,
                          password: "",
                          role: u.role,
                          full_name: u.full_name || "",
                          email: u.email || "",
                          is_active: u.is_active,
                        })
                      }
                    >
                      Edit
                    </button>
                    {u.id !== 1 && (
                      <button className="btn-ghost text-red-600" onClick={() => remove(u)}>
                        Remove
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td className="td text-slate-500" colSpan={7}>
                  No users yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setModal(null)}>
          <div
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">
              {modal.id ? `Edit user · ${modal.username}` : "Add user"}
            </h2>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Username</label>
                  <input
                    className="input"
                    value={modal.username}
                    onChange={(e) => setModal({ ...modal, username: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">
                    Password {modal.id && <span className="text-slate-400">(leave blank to keep)</span>}
                  </label>
                  <input
                    type="password"
                    className="input"
                    value={modal.password}
                    onChange={(e) => setModal({ ...modal, password: e.target.value })}
                    minLength={modal.id ? undefined : 6}
                    required={!modal.id}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Full Name</label>
                  <input
                    className="input"
                    value={modal.full_name}
                    onChange={(e) => setModal({ ...modal, full_name: e.target.value })}
                    placeholder="e.g. John Doe"
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input"
                    value={modal.email}
                    onChange={(e) => setModal({ ...modal, email: e.target.value })}
                    placeholder="e.g. john@company.com"
                  />
                </div>
              </div>

              <div>
                <label className="label">Role</label>
                <select
                  className="input"
                  value={modal.role}
                  onChange={(e) => setModal({ ...modal, role: e.target.value })}
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{roleDesc[modal.role]}</p>
              </div>

              {modal.id && modal.id !== 1 && (
                <div className="flex items-center gap-3">
                  <label className="label mb-0">Active</label>
                  <button
                    type="button"
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      modal.is_active ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                    onClick={() => setModal({ ...modal, is_active: !modal.is_active })}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        modal.is_active ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {modal.is_active ? "Active — user can log in" : "Inactive — user cannot log in"}
                  </span>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <button type="button" className="btn-secondary" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {modal.id ? "Save changes" : "Create user"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
