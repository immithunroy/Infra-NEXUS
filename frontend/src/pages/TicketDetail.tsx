import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import {
  Ticket, TicketComment, TicketActivity, UserOut,
  TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES, TICKET_DEPARTMENTS,
} from "../api/types";
import { useUserRole } from "../lib/role";
import { canWrite, canManageUsers } from "../api/types";
import { fmtTime, fmtTimeShort } from "../lib/time";
import { StatusBadge, PriorityBadge, CategoryBadge } from "../components/tickets/TicketBadges";
import ActionResultBanner from "../components/ActionResultBanner";

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role, user } = useUserRole();
  const writeOk = canWrite(role);
  const isAdmin = canManageUsers(role);

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [activities, setActivities] = useState<TicketActivity[]>([]);
  const [users, setUsers] = useState<UserOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<"conversation" | "activity">("conversation");

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const loadAll = () => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.get<Ticket>(`/tickets/${id}`),
      api.get<TicketComment[]>(`/tickets/${id}/comments`),
      api.get<TicketActivity[]>(`/tickets/${id}/activities`),
    ])
      .then(([t, c, a]) => { setTicket(t); setComments(c); setActivities(a); })
      .catch((e) => flash(String(e), false))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadAll(); }, [id]);
  useEffect(() => {
    if (isAdmin) api.get<UserOut[]>("/users").then(setUsers).catch(() => {});
  }, [isAdmin]);

  const addComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!id || !commentText.trim()) return;
    try {
      await api.post(`/tickets/${id}/comments`, { body: commentText, is_internal: isInternal });
      setCommentText("");
      setIsInternal(false);
      loadAll();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Failed", false);
    }
  };

  const updateTicket = async (data: Record<string, unknown>) => {
    if (!id) return;
    try {
      await api.put(`/tickets/${id}`, data);
      flash("Ticket updated");
      setEditing(null);
      loadAll();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Update failed", false);
    }
  };

  const deleteTicket = async () => {
    if (!id || !confirm("Delete this ticket permanently?")) return;
    try {
      await api.del(`/tickets/${id}`);
      flash("Ticket deleted");
      navigate("/tickets");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", false);
    }
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-sm text-slate-400">Loading…</div>;
  }

  if (!ticket) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-slate-400">Ticket not found</p>
        <button className="btn-secondary text-xs" onClick={() => navigate("/tickets")}>Back to list</button>
      </div>
    );
  }

  const slaWarning = !!(ticket.due_at && new Date(ticket.due_at) < new Date() && !["resolved", "closed"].includes(ticket.status));
  const responseTime = ticket.first_response_at
    ? ((new Date(ticket.first_response_at).getTime() - new Date(ticket.created_at).getTime()) / 3600000).toFixed(1)
    : null;
  const resolutionTime = ticket.resolved_at
    ? ((new Date(ticket.resolved_at).getTime() - new Date(ticket.created_at).getTime()) / 3600000).toFixed(1)
    : null;

  return (
    <div className="space-y-4">
      {notice && <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button className="btn-ghost text-xs" onClick={() => navigate("/tickets")}>← Back</button>
            <span className="text-xs text-slate-400">#{ticket.id}</span>
          </div>
          {editing ? (
            <input
              className="input mt-1 text-xl font-bold"
              value={editing.title as string}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
          ) : (
            <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{ticket.title}</h1>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <CategoryBadge category={ticket.category} />
            {ticket.is_reopened && <span className="badge bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">reopened</span>}
            {slaWarning && <span className="badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">SLA breached</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {writeOk && (
            <button className="btn-secondary text-xs" onClick={() => setEditing(editing ? null : { title: ticket.title, description: ticket.description, priority: ticket.priority, category: ticket.category, department: ticket.department, assigned_to: ticket.assigned_to != null ? String(ticket.assigned_to) : "", subscriber: ticket.subscriber, onu_id: ticket.onu_id != null ? String(ticket.onu_id) : "", due_at: ticket.due_at || "" })}>
              {editing ? "Cancel" : "Edit"}
            </button>
          )}
          {isAdmin && <button className="btn-ghost text-xs text-red-600" onClick={deleteTicket}>Delete</button>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Main Content */}
        <div className="space-y-4 lg:col-span-2">
          {/* Edit Form */}
          {editing && (
            <div className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Edit Ticket</h3>
              <div className="space-y-3">
                <div>
                  <label className="label">Title</label>
                  <input className="input" value={editing.title as string} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                </div>
                <div>
                  <label className="label">Description</label>
                  <textarea className="input min-h-[80px]" value={editing.description as string} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Priority</label>
                    <select className="input" value={editing.priority as string} onChange={(e) => setEditing({ ...editing, priority: e.target.value })}>
                      {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Category</label>
                    <select className="input" value={editing.category as string} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                      <option value="">None</option>
                      {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Department</label>
                    <select className="input" value={editing.department as string} onChange={(e) => setEditing({ ...editing, department: e.target.value })}>
                      <option value="">None</option>
                      {TICKET_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Due Date</label>
                    <input className="input" type="datetime-local" value={(editing.due_at as string)?.slice(0, 16) || ""} onChange={(e) => setEditing({ ...editing, due_at: e.target.value || null })} />
                  </div>
                </div>
                {isAdmin && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Assign to</label>
                      <select className="input" value={editing.assigned_to as string} onChange={(e) => setEditing({ ...editing, assigned_to: e.target.value })}>
                        <option value="">Unassigned</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Subscriber</label>
                      <input className="input font-mono" value={editing.subscriber as string} onChange={(e) => setEditing({ ...editing, subscriber: e.target.value })} />
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button className="btn-primary" onClick={() => updateTicket({
                    title: editing.title,
                    description: editing.description,
                    priority: editing.priority,
                    category: editing.category,
                    department: editing.department,
                    due_at: editing.due_at || null,
                    assigned_to: editing.assigned_to ? Number(editing.assigned_to) : null,
                    subscriber: editing.subscriber,
                    onu_id: editing.onu_id ? Number(editing.onu_id) : null,
                  })}>Save</button>
                </div>
              </div>
            </div>
          )}

          {/* Description */}
          {ticket.description && (
            <div className="card p-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">Description</h3>
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{ticket.description}</p>
            </div>
          )}

          {/* Tabs */}
          <div className="card">
            <div className="flex border-b border-slate-200 dark:border-slate-700">
              <button className={`px-4 py-2 text-sm font-medium ${tab === "conversation" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500 hover:text-slate-700 dark:text-slate-400"}`} onClick={() => setTab("conversation")}>
                Conversation ({comments.length})
              </button>
              <button className={`px-4 py-2 text-sm font-medium ${tab === "activity" ? "border-b-2 border-brand-600 text-brand-600" : "text-slate-500 hover:text-slate-700 dark:text-slate-400"}`} onClick={() => setTab("activity")}>
                Activity ({activities.length})
              </button>
            </div>

            {tab === "conversation" && (
              <div className="p-4">
                {/* Comment Input */}
                <form onSubmit={addComment} className="mb-4 space-y-2">
                  <textarea
                    className="input min-h-[60px]"
                    placeholder="Add a comment…"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-slate-500">
                      <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} className="rounded" />
                      Internal note (not visible to customer)
                    </label>
                    <button type="submit" className="btn-primary text-xs" disabled={!commentText.trim()}>Add comment</button>
                  </div>
                </form>

                {/* Comments List */}
                {comments.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">No comments yet</p>
                ) : (
                  <div className="space-y-3">
                    {comments.map((c) => (
                      <div key={c.id} className={`rounded-lg border p-3 ${c.is_internal ? "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10" : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"}`}>
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                            {c.user_name || "System"}
                            {c.is_internal && <span className="ml-2 text-amber-600 dark:text-amber-400">🔒 Internal</span>}
                          </span>
                          <span className="text-xs text-slate-400">{fmtTime(c.created_at)}</span>
                        </div>
                        <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{c.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "activity" && (
              <div className="p-4">
                {activities.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-400">No activity recorded</p>
                ) : (
                  <div className="space-y-2">
                    {activities.map((a) => (
                      <div key={a.id} className="flex items-start gap-3 text-sm">
                        <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600" />
                        <div className="min-w-0 flex-1">
                          <p className="text-slate-700 dark:text-slate-300">
                            <span className="font-medium">{a.user_name || "System"}</span>{" "}
                            <span className="text-slate-500 dark:text-slate-400">{activityLabel(a)}</span>
                          </p>
                          {a.field && a.old_value && a.new_value && (
                            <p className="mt-0.5 text-xs text-slate-400">
                              {a.field}: <span className="line-through">{a.old_value}</span> → <span className="font-medium text-slate-600 dark:text-slate-300">{a.new_value}</span>
                            </p>
                          )}
                          <p className="mt-0.5 text-xs text-slate-400">{fmtTime(a.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Status / Priority Controls */}
          <div className="card p-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Quick Actions</h3>
            <div>
              <label className="label">Status</label>
              <select className="input" value={ticket.status} onChange={(e) => updateTicket({ status: e.target.value })}>
                {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Priority</label>
              <select className="input" value={ticket.priority} onChange={(e) => updateTicket({ priority: e.target.value })}>
                {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {isAdmin && (
              <div>
                <label className="label">Assign to</label>
                <select className="input" value={ticket.assigned_to != null ? String(ticket.assigned_to) : ""} onChange={(e) => updateTicket({ assigned_to: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* SLA Info */}
          <div className="card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">SLA & Timing</h3>
            <InfoRow label="Created" value={fmtTime(ticket.created_at)} />
            <InfoRow label="First Response" value={responseTime ? `${responseTime}h` : "—"} warn={!ticket.first_response_at} />
            <InfoRow label="Resolution" value={resolutionTime ? `${resolutionTime}h` : "—"} />
            <InfoRow label="Due Date" value={ticket.due_at ? fmtTime(ticket.due_at) : "—"} warn={slaWarning} />
            {ticket.customer_satisfaction != null && (
              <InfoRow label="Satisfaction" value={`${"★".repeat(ticket.customer_satisfaction)}${"☆".repeat(5 - ticket.customer_satisfaction)} (${ticket.customer_satisfaction}/5)`} />
            )}
          </div>

          {/* Details */}
          <div className="card p-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Details</h3>
            <InfoRow label="Created by" value={ticket.created_by_name || "—"} />
            <InfoRow label="Assigned to" value={ticket.assigned_name || "Unassigned"} />
            <InfoRow label="Subscriber" value={ticket.subscriber || "—"} link={ticket.subscriber ? `/subscribers/${encodeURIComponent(ticket.subscriber)}` : undefined} />
            <InfoRow label="ONU ID" value={ticket.onu_id != null ? String(ticket.onu_id) : "—"} />
            <InfoRow label="Department" value={ticket.department || "—"} />
            <InfoRow label="Tags" value={ticket.tags || "—"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, warn, link }: { label: string; value: string; warn?: boolean; link?: string }) {
  const navigate = link ? useNavigate() : null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      {link ? (
        <button className="font-mono text-xs text-brand-700 hover:underline dark:text-cyan-300" onClick={() => navigate!(link)}>
          {value}
        </button>
      ) : (
        <span className={`font-medium ${warn ? "text-red-600 dark:text-red-400" : "text-slate-700 dark:text-slate-300"}`}>{value}</span>
      )}
    </div>
  );
}

function activityLabel(a: TicketActivity): string {
  switch (a.action) {
    case "created": return "created this ticket";
    case "updated": return `updated ${a.field}`;
    case "status_change": return `changed status`;
    case "assigned": return `changed assignment`;
    case "commented": return "added a comment";
    case "reopened": return "reopened this ticket";
    case "first_response": return "started working on this ticket";
    case "rated": return "rated satisfaction";
    case "bulk_updated": return "bulk updated";
    default: return a.action;
  }
}
