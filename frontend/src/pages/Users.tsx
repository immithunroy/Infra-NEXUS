import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { ROLE_LABELS, ROLE_OPTIONS, UserOut } from "../api/types";
import ActionResultBanner from "../components/ActionResultBanner";
import WarningBanner from "../components/WarningBanner";

interface FormState {
  id?: number;
  username: string;
  password: string;
  role: string;
}

const emptyForm: FormState = { username: "", password: "", role: "global_read" };

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

export default function Users() {
  const [users, setUsers] = useState<UserOut[]>([]);
  const [modal, setModal] = useState<FormState | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

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
        await api.put(`/users/${modal.id}`, {
          username: modal.username || undefined,
          role: modal.role,
          ...(modal.password ? { password: modal.password } : {}),
        });
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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Users & Roles</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Role-based access: admin, global write, global read, NOC, field team.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ ...emptyForm })}>+ Add user</button>
      </header>

      {notice && (
        <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />
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
              <th className="th">Role</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="td font-medium text-slate-800 dark:text-slate-100">{u.username}</td>
                <td className="td">
                  <span className={`badge ${roleBadge[u.role] || roleBadge.global_read}`}>
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                </td>
                <td className="td">
                  <div className="flex gap-1">
                    <button
                      className="btn-ghost"
                      onClick={() => setModal({ id: u.id, username: u.username, password: "", role: u.role })}
                    >
                      Edit
                    </button>
                    <button className="btn-ghost text-red-600" onClick={() => remove(u)}>Remove</button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && <tr><td className="td text-slate-500" colSpan={3}>No users yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">
              {modal.id ? `Edit user · ${modal.username}` : "Add user"}
            </h2>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="label">Username</label>
                <input className="input" value={modal.username} onChange={(e) => setModal({ ...modal, username: e.target.value })} required />
              </div>
              <div>
                <label className="label">Password {modal.id && <span className="text-slate-400">(leave blank to keep)</span>}</label>
                <input type="password" className="input" value={modal.password} onChange={(e) => setModal({ ...modal, password: e.target.value })} minLength={modal.id ? undefined : 6} required={!modal.id} />
              </div>
              <div>
                <label className="label">Role</label>
                <select className="input" value={modal.role} onChange={(e) => setModal({ ...modal, role: e.target.value })}>
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{roleDesc[modal.role]}</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
