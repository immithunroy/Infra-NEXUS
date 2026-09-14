import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { UserOut, canManageUsers } from "../api/types";
import { useUserRole } from "../lib/role";
import ActionResultBanner from "../components/ActionResultBanner";
import { fmtTimeShort } from "../lib/time";

type Tab = "accounts" | "roles";

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

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  global_write: "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
  global_read: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  noc: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  field_team: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

const DEFAULT_COLOR = "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";

interface SyncResult {
  created: number;
  updated: number;
  deactivated: number;
  message: string;
}

interface Role {
  id: number;
  name: string;
  label: string;
  description: string;
  permissions: string[];
  is_system: boolean;
  is_active: boolean;
}

interface PermissionGroups {
  [module: string]: { key: string; label: string }[];
}

export default function Users() {
  const { role } = useUserRole();
  const [tab, setTab] = useState<Tab>("accounts");
  const [users, setUsers] = useState<UserOut[]>([]);
  const [modal, setModal] = useState<FormState | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  // Dynamic role data from API
  const [roles, setRoles] = useState<Role[]>([]);
  const [permGroups, setPermGroups] = useState<PermissionGroups>({});
  const [roleLabels, setRoleLabels] = useState<Record<string, string>>({});
  const [roleDescriptions, setRoleDescriptions] = useState<Record<string, string>>({});
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [creatingRole, setCreatingRole] = useState(false);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const loadUsers = () => {
    api.get<UserOut[]>("/users").then(setUsers).catch((e) => flash(String(e), false));
  };

  const loadRoles = async () => {
    try {
      const [rolesData, permsData] = await Promise.all([
        api.get<Role[]>("/roles"),
        api.get<PermissionGroups>("/roles/permissions"),
      ]);
      setRoles(rolesData);
      setPermGroups(permsData);
      // Build dynamic maps from API data
      const labels: Record<string, string> = {};
      const descs: Record<string, string> = {};
      for (const r of rolesData) {
        labels[r.name] = r.label || r.name;
        descs[r.name] = r.description;
      }
      setRoleLabels(labels);
      setRoleDescriptions(descs);
    } catch (e) {
      flash(String(e), false);
    }
  };

  useEffect(() => {
    loadUsers();
    loadRoles();
  }, []);

  // ── User actions ───────────────────────────────────────────────────────

  const submitUser = async (e: FormEvent) => {
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
      loadUsers();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    }
  };

  const removeUser = async (u: UserOut) => {
    if (!confirm(`Remove user ${u.username}?`)) return;
    try {
      await api.del(`/users/${u.id}`);
      flash("User removed");
      loadUsers();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", false);
    }
  };

  const quickRoleChange = async (u: UserOut, newRole: string) => {
    try {
      await api.put(`/users/${u.id}`, { role: newRole });
      flash(`${u.username} role changed to ${roleLabels[newRole] || newRole}`);
      loadUsers();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Role change failed", false);
    }
  };

  const toggleActive = async (u: UserOut) => {
    try {
      await api.put(`/users/${u.id}`, { is_active: u.is_active === false });
      flash(`${u.username} ${u.is_active === false ? "activated" : "deactivated"}`);
      loadUsers();
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
      loadUsers();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Sync failed", false);
    } finally {
      setSyncing(false);
    }
  };

  // ── Role actions ───────────────────────────────────────────────────────

  const togglePerm = (perm: string) => {
    if (!editingRole) return;
    const has = editingRole.permissions.includes(perm);
    setEditingRole({
      ...editingRole,
      permissions: has
        ? editingRole.permissions.filter((p) => p !== perm)
        : [...editingRole.permissions, perm],
    });
  };

  const toggleModule = (modulePerms: { key: string }[]) => {
    if (!editingRole) return;
    const keys = modulePerms.map((p) => p.key);
    const allSelected = keys.every((k) => editingRole.permissions.includes(k));
    setEditingRole({
      ...editingRole,
      permissions: allSelected
        ? editingRole.permissions.filter((p) => !keys.includes(p))
        : [...new Set([...editingRole.permissions, ...keys])],
    });
  };

  const saveRole = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingRole) return;
    try {
      if (editingRole.id) {
        await api.put(`/roles/${editingRole.id}`, {
          label: editingRole.label,
          description: editingRole.description,
          permissions: editingRole.permissions,
        });
        flash("Role updated");
      } else {
        await api.post("/roles", {
          name: editingRole.name,
          label: editingRole.label,
          description: editingRole.description,
          permissions: editingRole.permissions,
        });
        flash("Role created");
      }
      setEditingRole(null);
      loadRoles();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    }
  };

  const deleteRole = async (r: Role) => {
    if (!confirm(`Delete role "${r.label}"? Users with this role will lose permissions.`)) return;
    try {
      await api.del(`/roles/${r.id}`);
      flash("Role deleted");
      loadRoles();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", false);
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
            {tab === "accounts"
              ? `${activeCount} active · ${inactiveCount} inactive · ${hrmCount} synced from HRM`
              : `${roles.length} roles · ${roles.filter((r) => r.is_system).length} built-in`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tab === "accounts" && canManageUsers(role) && (
            <button className="btn-secondary text-sm" onClick={syncHrm} disabled={syncing}>
              {syncing ? "Syncing…" : "🔄 Sync from HRM"}
            </button>
          )}
          {tab === "accounts" && canManageUsers(role) && (
            <button className="btn-primary" onClick={() => setModal({ ...emptyForm })}>
              + Add user
            </button>
          )}
          {tab === "roles" && canManageUsers(role) && (
            <button className="btn-primary" onClick={() => { setCreatingRole(true); setEditingRole(null); }}>
              + New Role
            </button>
          )}
        </div>
      </header>

      {notice && <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />}

      {syncResult && tab === "accounts" && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">Last HRM Sync Result</p>
          <div className="mt-2 flex gap-4 text-sm">
            <span className="text-emerald-700 dark:text-emerald-400">✅ {syncResult.created} created</span>
            <span className="text-blue-700 dark:text-blue-400">✏️ {syncResult.updated} updated</span>
            <span className="text-amber-700 dark:text-amber-400">⚠️ {syncResult.deactivated} deactivated</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
        <button
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "accounts"
              ? "border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400"
              : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
          }`}
          onClick={() => setTab("accounts")}
        >
          Accounts
        </button>
        {canManageUsers(role) && (
          <button
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "roles"
                ? "border-brand-600 text-brand-600 dark:text-brand-400 dark:border-brand-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            }`}
            onClick={() => setTab("roles")}
          >
            Roles & Permissions
          </button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ACCOUNTS TAB                                                      */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === "accounts" && (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {roles.filter((r) => r.is_active).map((r) => (
              <div key={r.name} className="card p-4">
                <div className="flex items-center gap-2">
                  <span className={`badge ${ROLE_COLORS[r.name] || DEFAULT_COLOR}`}>{r.label || r.name}</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{r.description}</p>
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
                          className={`text-xs rounded px-1.5 py-0.5 border-0 font-medium cursor-pointer ${ROLE_COLORS[u.role] || DEFAULT_COLOR}`}
                          value={u.role}
                          onChange={(e) => quickRoleChange(u, e.target.value)}
                        >
                          {roles.filter((r) => r.is_active).map((r) => (
                            <option key={r.name} value={r.name}>{r.label || r.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={`badge ${ROLE_COLORS[u.role] || DEFAULT_COLOR}`}>
                          {roleLabels[u.role] || u.role}
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
                          <button className="btn-ghost text-red-600" onClick={() => removeUser(u)}>
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td className="td text-slate-500" colSpan={7}>No users yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ROLES TAB                                                         */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {tab === "roles" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((r) => (
            <div key={r.id} className={`card p-5 ${r.is_active === false ? "opacity-50" : ""}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${ROLE_COLORS[r.name] || DEFAULT_COLOR}`}>
                      {r.label || r.name}
                    </span>
                    {r.is_system && (
                      <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 rounded px-1 py-0.5">
                        built-in
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{r.description}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {r.permissions.slice(0, 6).map((p) => (
                  <span key={p} className="text-[10px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 rounded px-1.5 py-0.5">
                    {p}
                  </span>
                ))}
                {r.permissions.length > 6 && (
                  <span className="text-[10px] text-slate-400">+{r.permissions.length - 6} more</span>
                )}
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  className="btn-ghost text-xs"
                  onClick={() => { setCreatingRole(false); setEditingRole(r); }}
                >
                  Edit
                </button>
                {!r.is_system && (
                  <button className="btn-ghost text-xs text-red-600" onClick={() => deleteRole(r)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* USER EDIT MODAL                                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setModal(null)}>
          <div
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">
              {modal.id ? `Edit user · ${modal.username}` : "Add user"}
            </h2>
            <form onSubmit={submitUser} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Username</label>
                  <input className="input" value={modal.username} onChange={(e) => setModal({ ...modal, username: e.target.value })} required />
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
                  <input className="input" value={modal.full_name} onChange={(e) => setModal({ ...modal, full_name: e.target.value })} placeholder="e.g. John Doe" />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input type="email" className="input" value={modal.email} onChange={(e) => setModal({ ...modal, email: e.target.value })} placeholder="e.g. john@company.com" />
                </div>
              </div>
              <div>
                <label className="label">Role</label>
                <select className="input" value={modal.role} onChange={(e) => setModal({ ...modal, role: e.target.value })}>
                  {roles.filter((r) => r.is_active).map((r) => (
                    <option key={r.name} value={r.name}>{r.label || r.name}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{roleDescriptions[modal.role]}</p>
              </div>
              {modal.id && modal.id !== 1 && (
                <div className="flex items-center gap-3">
                  <label className="label mb-0">Active</label>
                  <button
                    type="button"
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${modal.is_active ? "bg-emerald-500" : "bg-slate-300"}`}
                    onClick={() => setModal({ ...modal, is_active: !modal.is_active })}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${modal.is_active ? "translate-x-6" : "translate-x-1"}`} />
                  </button>
                  <span className="text-sm text-slate-500 dark:text-slate-400">
                    {modal.is_active ? "Active — user can log in" : "Inactive — user cannot log in"}
                  </span>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary">{modal.id ? "Save changes" : "Create user"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* ROLE EDIT MODAL                                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {editingRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setEditingRole(null)}>
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">
              {creatingRole ? "Create new role" : `Edit role · ${editingRole.label}`}
            </h2>
            <form onSubmit={saveRole} className="space-y-4">
              {creatingRole && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">Role name (unique key)</label>
                    <input
                      className="input"
                      value={editingRole.name}
                      onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                      required
                      placeholder="e.g. technician"
                      pattern="[a-z_]+"
                      title="Lowercase letters and underscores only"
                    />
                  </div>
                  <div>
                    <label className="label">Display label</label>
                    <input
                      className="input"
                      value={editingRole.label}
                      onChange={(e) => setEditingRole({ ...editingRole, label: e.target.value })}
                      placeholder="e.g. Technician"
                    />
                  </div>
                </div>
              )}
              {!creatingRole && (
                <div>
                  <label className="label">Display label</label>
                  <input className="input" value={editingRole.label} onChange={(e) => setEditingRole({ ...editingRole, label: e.target.value })} />
                </div>
              )}
              <div>
                <label className="label">Description</label>
                <input className="input" value={editingRole.description} onChange={(e) => setEditingRole({ ...editingRole, description: e.target.value })} placeholder="What this role can do" />
              </div>

              {/* Permission matrix */}
              <div>
                <label className="label">Permissions</label>
                <div className="space-y-3">
                  {Object.entries(permGroups).map(([module, perms]) => {
                    const selectedCount = perms.filter((p) => editingRole.permissions.includes(p.key)).length;
                    const allSelected = selectedCount === perms.length;
                    const someSelected = selectedCount > 0 && !allSelected;
                    return (
                      <div key={module} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => { if (el) el.indeterminate = someSelected; }}
                            onChange={() => toggleModule(perms)}
                            className="rounded border-slate-300"
                          />
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{module}</span>
                          <span className="text-[10px] text-slate-400">{selectedCount}/{perms.length}</span>
                        </div>
                        <div className="grid gap-1 sm:grid-cols-2 ml-5">
                          {perms.map((p) => (
                            <label key={p.key} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={editingRole.permissions.includes(p.key)}
                                onChange={() => togglePerm(p.key)}
                                className="rounded border-slate-300"
                              />
                              {p.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                <button type="button" className="btn-secondary" onClick={() => setEditingRole(null)}>Cancel</button>
                <button type="submit" className="btn-primary">{creatingRole ? "Create role" : "Save changes"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
