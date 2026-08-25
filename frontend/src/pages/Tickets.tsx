import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { canManageUsers, canWrite, Ticket, TICKET_PRIORITIES, TICKET_STATUSES, UserOut } from "../api/types";
import { useUserRole } from "../lib/role";
import ActionResultBanner from "../components/ActionResultBanner";
import WarningBanner from "../components/WarningBanner";
import { fmtTimeShort } from "../lib/time";

const statusBadge: Record<string, string> = {
  open: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  closed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const priorityBadge: Record<string, string> = {
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  normal: "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
  high: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  urgent: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

interface FormState {
  id?: number;
  title: string;
  description: string;
  priority: string;
  assigned_to: string;
  subscriber: string;
  onu_id: string;
}

const emptyForm: FormState = { title: "", description: "", priority: "normal", assigned_to: "", subscriber: "", onu_id: "" };

export default function Tickets() {
  const navigate = useNavigate();
  const { role, user } = useUserRole();
  const writeOk = canWrite(role);
  const isAdmin = canManageUsers(role);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [users, setUsers] = useState<UserOut[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [modal, setModal] = useState<FormState | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const load = () => {
    api
      .get<Ticket[]>(`/tickets${statusFilter ? "" : ""}`)
      .then(setTickets)
      .catch((e) => flash(String(e), false));
  };

  useEffect(load, [statusFilter]);

  useEffect(() => {
    if (isAdmin) {
      api.get<UserOut[]>("/users").then(setUsers).catch(() => undefined);
    }
  }, [isAdmin]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    try {
      if (modal.id) {
        const body: Record<string, unknown> = {
          title: modal.title || undefined,
          description: modal.description,
          priority: modal.priority,
          assigned_to: modal.assigned_to ? Number(modal.assigned_to) : undefined,
          subscriber: modal.subscriber || undefined,
          onu_id: modal.onu_id ? Number(modal.onu_id) : undefined,
        };
        await api.put(`/tickets/${modal.id}`, body);
        flash("Ticket updated");
      } else {
        await api.post("/tickets", {
          title: modal.title,
          description: modal.description,
          priority: modal.priority,
          assigned_to: modal.assigned_to ? Number(modal.assigned_to) : null,
          subscriber: modal.subscriber || "",
          onu_id: modal.onu_id ? Number(modal.onu_id) : null,
        });
        flash("Ticket created");
      }
      setModal(null);
      load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    }
  };

  const setStatus = async (t: Ticket, status: string) => {
    try {
      await api.put(`/tickets/${t.id}`, { status });
      load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Update failed", false);
    }
  };

  const remove = async (t: Ticket) => {
    if (!confirm(`Delete ticket "${t.title}"?`)) return;
    try {
      await api.del(`/tickets/${t.id}`);
      flash("Ticket deleted");
      load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", false);
    }
  };

  const mine = tickets.filter((t) => statusFilter ? t.status === statusFilter : true);
  const openCount = tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Tickets & To-do</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isAdmin ? `${tickets.length} tickets · ${openCount} open` : `You can edit GPS/address for subscribers on your open tickets.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-36" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
          </select>
          {writeOk && <button className="btn-primary" onClick={() => setModal({ ...emptyForm })}>+ New ticket</button>}
        </div>
      </header>

      {notice && (
        <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />
      )}

      <div className="card overflow-x-auto">
        <div className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
          {isAdmin ? "All tickets" : "My tickets"}
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="th">#</th>
              <th className="th">Title</th>
              <th className="th">Status</th>
              <th className="th">Priority</th>
              <th className="th">Assigned</th>
              <th className="th">Subscriber</th>
              <th className="th">Created</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {mine.map((t, i) => (
              <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="td text-xs text-slate-400">{i + 1}</td>
                <td className="td">
                  <div className="font-medium text-slate-800 dark:text-slate-100">{t.title}</div>
                  {t.description && <div className="max-w-md truncate text-xs text-slate-500 dark:text-slate-400">{t.description}</div>}
                </td>
                <td className="td">
                  <select
                    className="input w-32"
                    value={t.status}
                    onChange={(e) => setStatus(t, e.target.value)}
                    title="Change status"
                  >
                    {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                  </select>
                </td>
                <td className="td"><span className={`badge ${priorityBadge[t.priority] || priorityBadge.normal}`}>{t.priority}</span></td>
                <td className="td text-slate-600 dark:text-slate-300">{t.assigned_name || "—"}</td>
                <td className="td">
                  {t.subscriber ? (
                    <button
                      className="font-mono text-xs text-brand-700 hover:underline dark:text-cyan-300"
                      onClick={() => navigate(`/subscribers/${encodeURIComponent(t.subscriber)}`)}
                    >
                      {t.subscriber}
                    </button>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="td text-xs text-slate-500">{fmtTimeShort(t.created_at)}</td>
                <td className="td">
                  <div className="flex gap-1">
                    {writeOk && (
                      <button
                        className="btn-ghost"
                        onClick={() => setModal({
                          id: t.id,
                          title: t.title,
                          description: t.description,
                          priority: t.priority,
                          assigned_to: t.assigned_to != null ? String(t.assigned_to) : "",
                          subscriber: t.subscriber,
                          onu_id: t.onu_id != null ? String(t.onu_id) : "",
                        })}
                      >
                        Edit
                      </button>
                    )}
                    {isAdmin && <button className="btn-ghost text-red-600" onClick={() => remove(t)}>Del</button>}
                  </div>
                </td>
              </tr>
            ))}
            {mine.length === 0 && (
              <tr><td className="td text-slate-500" colSpan={8}>No tickets{statusFilter ? ` with status "${statusFilter}"` : ""}.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setModal(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">
              {modal.id ? "Edit ticket" : "New ticket"}
            </h2>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="label">Title</label>
                <input className="input" value={modal.title} onChange={(e) => setModal({ ...modal, title: e.target.value })} required />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input min-h-[80px]" value={modal.description} onChange={(e) => setModal({ ...modal, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Priority</label>
                  <select className="input" value={modal.priority} onChange={(e) => setModal({ ...modal, priority: e.target.value })}>
                    {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Assign to</label>
                  <select className="input" value={modal.assigned_to} onChange={(e) => setModal({ ...modal, assigned_to: e.target.value })}>
                    <option value="">Unassigned</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.username} ({u.role})</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Subscriber (PPPoE ID)</label>
                  <input className="input font-mono" value={modal.subscriber} onChange={(e) => setModal({ ...modal, subscriber: e.target.value })} placeholder="e.g. 17040102" />
                </div>
                <div>
                  <label className="label">ONU ID (optional)</label>
                  <input className="input" value={modal.onu_id} onChange={(e) => setModal({ ...modal, onu_id: e.target.value })} placeholder="e.g. 116" />
                </div>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Assigning a subscriber links the ticket — the assignee can then update that subscriber's address & GPS.
              </p>
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
