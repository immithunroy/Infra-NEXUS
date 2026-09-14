import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { canManageUsers } from "../api/types";
import { useUserRole } from "../lib/role";
import ActionResultBanner from "../components/ActionResultBanner";

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

const roleBadge: Record<string, string> = {
  admin: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  global_write: "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
  global_read: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  noc: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  field_team: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export default function Roles() {
  const { role } = useUserRole();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permGroups, setPermGroups] = useState<PermissionGroups>({});
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const load = async () => {
    try {
      const [rolesData, permsData] = await Promise.all([
        api.get<Role[]>("/roles"),
        api.get<PermissionGroups>("/roles/permissions"),
      ]);
      setRoles(rolesData);
      setPermGroups(permsData);
    } catch (e) {
      flash(String(e), false);
    }
  };

  useEffect(() => { load(); }, []);

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
      load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    }
  };

  const deleteRole = async (r: Role) => {
    if (!confirm(`Delete role "${r.label}"? Users with this role will lose permissions.`)) return;
    try {
      await api.del(`/roles/${r.id}`);
      flash("Role deleted");
      load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", false);
    }
  };

  if (!canManageUsers(role)) {
    return <div className="p-8 text-center text-slate-500">Access denied. Admin only.</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Roles & Permissions</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {roles.length} roles · {roles.filter((r) => r.is_system).length} built-in
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => setCreating(true)}
        >
          + New Role
        </button>
      </header>

      {notice && <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />}

      {/* Role cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {roles.map((r) => (
          <div key={r.id} className={`card p-5 ${r.is_active === false ? "opacity-50" : ""}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className={`badge ${roleBadge[r.name] || "bg-slate-100 text-slate-600"}`}>
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
                onClick={() => { setCreating(false); setEditingRole(r); }}
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

      {/* Edit / Create modal */}
      {editingRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setEditingRole(null)}>
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">
              {creating ? "Create new role" : `Edit role · ${editingRole.label}`}
            </h2>
            <form onSubmit={saveRole} className="space-y-4">
              {creating && (
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
              {!creating && (
                <div>
                  <label className="label">Display label</label>
                  <input
                    className="input"
                    value={editingRole.label}
                    onChange={(e) => setEditingRole({ ...editingRole, label: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label className="label">Description</label>
                <input
                  className="input"
                  value={editingRole.description}
                  onChange={(e) => setEditingRole({ ...editingRole, description: e.target.value })}
                  placeholder="What this role can do"
                />
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
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                            {module}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {selectedCount}/{perms.length}
                          </span>
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
                <button type="button" className="btn-secondary" onClick={() => setEditingRole(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {creating ? "Create role" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
