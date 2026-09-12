import { FormEvent, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import {
  Ticket, TicketListResponse, TicketAnalytics, UserOut, TicketTemplate,
  TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES, TICKET_DEPARTMENTS,
} from "../api/types";
import { useUserRole } from "../lib/role";
import { canWrite, canManageUsers } from "../api/types";
import { fmtTimeShort } from "../lib/time";
import { StatusBadge, PriorityBadge, CategoryBadge } from "../components/tickets/TicketBadges";
import { KpiCard } from "../components/tickets/KpiCard";
import { BarChart } from "../components/tickets/Charts";
import { Pagination } from "../components/Pagination";
import ActionResultBanner from "../components/ActionResultBanner";

interface Filters {
  status: string;
  priority: string;
  category: string;
  department: string;
  assigned_to: string;
  search: string;
  sort_by: string;
  sort_dir: string;
}

const defaultFilters: Filters = {
  status: "", priority: "", category: "", department: "",
  assigned_to: "", search: "", sort_by: "created_at", sort_dir: "desc",
};

export default function Tickets() {
  const navigate = useNavigate();
  const { role } = useUserRole();
  const writeOk = canWrite(role);
  const isAdmin = canManageUsers(role);

  // ── List state ──
  const [items, setItems] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [users, setUsers] = useState<UserOut[]>([]);
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [createModal, setCreateModal] = useState<Record<string, unknown> | null>(null);
  const [bulkModal, setBulkModal] = useState(false);

  // ── Analytics state ──
  const [analytics, setAnalytics] = useState<TicketAnalytics | null>(null);
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [showAnalytics, setShowAnalytics] = useState(false);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  // ── Data loading ──
  const loadList = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.priority) params.set("priority", filters.priority);
    if (filters.category) params.set("category", filters.category);
    if (filters.department) params.set("department", filters.department);
    if (filters.assigned_to) params.set("assigned_to", filters.assigned_to);
    if (filters.search) params.set("search", filters.search);
    params.set("sort_by", filters.sort_by);
    params.set("sort_dir", filters.sort_dir);
    params.set("page", String(page));
    params.set("page_size", "25");
    api
      .get<TicketListResponse>(`/tickets?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); setPages(r.pages); })
      .catch((e) => flash(String(e), false))
      .finally(() => setLoading(false));
  }, [filters, page]);

  const loadAnalytics = useCallback(() => {
    api
      .get<TicketAnalytics>(`/tickets/analytics/dashboard?days=${analyticsDays}`)
      .then(setAnalytics)
      .catch(() => setAnalytics(null));
  }, [analyticsDays]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { if (showAnalytics) loadAnalytics(); }, [showAnalytics, loadAnalytics]);

  useEffect(() => {
    if (isAdmin) api.get<UserOut[]>("/users").then(setUsers).catch(() => {});
    api.get<TicketTemplate[]>("/tickets/templates/list").then(setTemplates).catch(() => {});
  }, [isAdmin]);

  // ── Filter helpers ──
  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    setSelected(new Set());
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setPage(1);
    setSelected(new Set());
  };

  const toggleSelect = (id: number) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleSelectAll = () => {
    setSelected((s) => s.size === items.length ? new Set() : new Set(items.map((t) => t.id)));
  };

  const bulkUpdate = async (data: Record<string, unknown>) => {
    if (selected.size === 0) return;
    try {
      await api.post("/tickets/bulk-update", { ticket_ids: [...selected], ...data });
      flash(`Updated ${selected.size} tickets`);
      setSelected(new Set());
      setBulkModal(false);
      loadList();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Bulk update failed", false);
    }
  };

  const createTicket = async (e: FormEvent) => {
    e.preventDefault();
    if (!createModal) return;
    try {
      await api.post("/tickets", {
        title: createModal.title,
        description: createModal.description || "",
        priority: createModal.priority || "normal",
        category: createModal.category || "",
        department: createModal.department || "",
        assigned_to: createModal.assigned_to ? Number(createModal.assigned_to) : null,
        subscriber: createModal.subscriber || "",
        onu_id: createModal.onu_id ? Number(createModal.onu_id) : null,
      });
      flash("Ticket created");
      setCreateModal(null);
      loadList();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Create failed", false);
    }
  };

  const applyTemplate = (tmpl: TicketTemplate) => {
    setCreateModal({
      title: tmpl.title, description: tmpl.description, priority: tmpl.priority,
      category: tmpl.category, department: tmpl.department,
      assigned_to: "", subscriber: "", onu_id: "",
    });
  };

  const activeFilterCount = [filters.status, filters.priority, filters.category, filters.department, filters.assigned_to].filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Troubles & Tickets</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{total} tickets · {analytics ? `${analytics.open_count} open` : "loading…"}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`btn-ghost text-xs ${showAnalytics ? "bg-slate-100 dark:bg-slate-800" : ""}`}
            onClick={() => setShowAnalytics(!showAnalytics)}
          >
            {showAnalytics ? "Hide Analytics" : "Show Analytics"}
          </button>
          {writeOk && (
            <button className="btn-primary" onClick={() => setCreateModal({ title: "", description: "", priority: "normal", category: "", department: "", assigned_to: "", subscriber: "", onu_id: "" })}>
              + New ticket
            </button>
          )}
        </div>
      </header>

      {notice && <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />}

      {/* ── KPI Cards ── */}
      {analytics && (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <KpiCard label="Total" value={analytics.total} icon="📋" color="brand" />
          <KpiCard label="Open" value={analytics.open_count} icon="🔴" color="rose" />
          <KpiCard label="In Progress" value={analytics.in_progress_count} icon="🟡" color="amber" />
          <KpiCard label="Resolved" value={analytics.resolved_count} icon="🟢" color="emerald" />
          <KpiCard label="SLA Breaches" value={analytics.sla_breaches} icon="⏰" color={analytics.sla_breaches > 0 ? "rose" : "emerald"} />
          <KpiCard label="Reopened" value={analytics.reopened_count} icon="🔄" color={analytics.reopened_count > 0 ? "amber" : "emerald"} />
        </div>
      )}

      {/* ── Analytics Section (collapsible) ── */}
      {showAnalytics && analytics && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">Analytics — Last {analyticsDays} days</p>
            <select className="input w-32" value={analyticsDays} onChange={(e) => setAnalyticsDays(Number(e.target.value))}>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard label="Avg Response" value={analytics.avg_response_hours != null ? `${analytics.avg_response_hours.toFixed(1)}h` : "—"} icon="⏱️" color="cyan" />
            <KpiCard label="Avg Resolution" value={analytics.avg_resolution_hours != null ? `${analytics.avg_resolution_hours.toFixed(1)}h` : "—"} icon="✅" color="emerald" />
            <KpiCard
              label="Satisfaction"
              value={analytics.avg_satisfaction != null ? `${analytics.avg_satisfaction.toFixed(1)} / 5` : "—"}
              icon="⭐" color="amber"
              sub={analytics.avg_satisfaction != null ? `${"★".repeat(Math.round(analytics.avg_satisfaction))}${"☆".repeat(5 - Math.round(analytics.avg_satisfaction))}` : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <BarChart data={analytics.by_priority} title="By Priority" />
            <BarChart data={analytics.by_category} title="By Category" />
            <BarChart data={analytics.by_department} title="By Department" />
            <BarChart data={analytics.by_assignee} title="By Assignee" maxBars={10} />
          </div>

          {analytics.volume_over_time.length > 0 && (
            <div className="card p-4">
              <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Volume Over Time</p>
              <div className="flex items-end gap-1" style={{ height: 80 }}>
                {analytics.volume_over_time.map((d) => {
                  const max = Math.max(...analytics.volume_over_time.map((v) => v.count), 1);
                  return (
                    <div key={d.date} className="group relative flex-1">
                      <div className="mx-auto w-full rounded-t bg-brand-500/80 dark:bg-brand-400/60" style={{ height: `${(d.count / max) * 60}px`, minHeight: 2 }} title={`${d.date}: ${d.count}`} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Search + Filters ── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input max-w-xs" placeholder="Search tickets…" value={filters.search} onChange={(e) => updateFilter("search", e.target.value)} />
          <button className={`btn-ghost ${showFilters ? "bg-slate-100 dark:bg-slate-800" : ""}`} onClick={() => setShowFilters(!showFilters)}>
            Filters {activeFilterCount > 0 && <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{activeFilterCount}</span>}
          </button>
          {activeFilterCount > 0 && <button className="btn-ghost text-xs text-slate-500" onClick={resetFilters}>Clear</button>}
          {selected.size > 0 && isAdmin && <button className="btn-secondary text-xs" onClick={() => setBulkModal(true)}>Bulk edit ({selected.size})</button>}
        </div>
        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 sm:grid-cols-5 dark:border-slate-700">
            <select className="input" value={filters.status} onChange={(e) => updateFilter("status", e.target.value)}>
              <option value="">All statuses</option>
              {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
            <select className="input" value={filters.priority} onChange={(e) => updateFilter("priority", e.target.value)}>
              <option value="">All priorities</option>
              {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="input" value={filters.category} onChange={(e) => updateFilter("category", e.target.value)}>
              <option value="">All categories</option>
              {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="input" value={filters.department} onChange={(e) => updateFilter("department", e.target.value)}>
              <option value="">All departments</option>
              {TICKET_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {isAdmin && (
              <select className="input" value={filters.assigned_to} onChange={(e) => updateFilter("assigned_to", e.target.value)}>
                <option value="">All assignees</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      {/* ── Ticket Table ── */}
      <div className="card overflow-x-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">No tickets found</div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <tr>
                  {isAdmin && (
                    <th className="th w-8">
                      <input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleSelectAll} className="rounded" />
                    </th>
                  )}
                  <th className="th w-12">ID</th>
                  <th className="th">Title</th>
                  <th className="th">Status</th>
                  <th className="th">Priority</th>
                  <th className="th hidden lg:table-cell">Category</th>
                  <th className="th hidden md:table-cell">Assigned</th>
                  <th className="th hidden lg:table-cell">Subscriber</th>
                  <th className="th hidden xl:table-cell">Comments</th>
                  <th className="th">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {items.map((t) => (
                  <tr
                    key={t.id}
                    className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 ${selected.has(t.id) ? "bg-brand-50/50 dark:bg-brand-900/10" : ""}`}
                    onClick={() => navigate(`/tickets/${t.id}`)}
                  >
                    {isAdmin && (
                      <td className="td" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} className="rounded" />
                      </td>
                    )}
                    <td className="td text-xs text-slate-400">{t.id}</td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 dark:text-slate-100">{t.title}</span>
                        {t.is_reopened && <span className="badge bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">reopened</span>}
                      </div>
                      {t.description && <div className="max-w-md truncate text-xs text-slate-500 dark:text-slate-400">{t.description}</div>}
                    </td>
                    <td className="td"><StatusBadge status={t.status} /></td>
                    <td className="td"><PriorityBadge priority={t.priority} /></td>
                    <td className="td hidden lg:table-cell"><CategoryBadge category={t.category} /></td>
                    <td className="td hidden md:table-cell text-slate-600 dark:text-slate-300">{t.assigned_name || "—"}</td>
                    <td className="td hidden lg:table-cell">
                      {t.subscriber ? (
                        <button className="font-mono text-xs text-brand-700 hover:underline dark:text-cyan-300" onClick={(e) => { e.stopPropagation(); navigate(`/subscribers/${encodeURIComponent(t.subscriber)}`); }}>
                          {t.subscriber}
                        </button>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="td hidden xl:table-cell text-xs text-slate-400">{t.comment_count || ""}</td>
                    <td className="td text-xs text-slate-500">{fmtTimeShort(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page - 1} setPage={(p) => setPage(p + 1)} totalPages={pages} total={total} pageSize={25} />
          </>
        )}
      </div>

      {/* ── Create Modal ── */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setCreateModal(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">New ticket</h2>
            {templates.length > 0 && (
              <div className="mb-3">
                <label className="label">Quick fill from template</label>
                <div className="flex flex-wrap gap-1">
                  {templates.map((t) => <button key={t.id} className="btn-ghost text-xs" onClick={() => applyTemplate(t)}>{t.name}</button>)}
                </div>
              </div>
            )}
            <form onSubmit={createTicket} className="space-y-3">
              <div>
                <label className="label">Title</label>
                <input className="input" value={createModal.title as string} onChange={(e) => setCreateModal({ ...createModal, title: e.target.value })} required />
              </div>
              <div>
                <label className="label">Description</label>
                <textarea className="input min-h-[80px]" value={createModal.description as string} onChange={(e) => setCreateModal({ ...createModal, description: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Priority</label>
                  <select className="input" value={createModal.priority as string} onChange={(e) => setCreateModal({ ...createModal, priority: e.target.value })}>
                    {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Category</label>
                  <select className="input" value={createModal.category as string} onChange={(e) => setCreateModal({ ...createModal, category: e.target.value })}>
                    <option value="">None</option>
                    {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Department</label>
                  <select className="input" value={createModal.department as string} onChange={(e) => setCreateModal({ ...createModal, department: e.target.value })}>
                    <option value="">None</option>
                    {TICKET_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Assign to</label>
                  <select className="input" value={createModal.assigned_to as string} onChange={(e) => setCreateModal({ ...createModal, assigned_to: e.target.value })}>
                    <option value="">Unassigned</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Subscriber (PPPoE ID)</label>
                  <input className="input font-mono" value={createModal.subscriber as string} onChange={(e) => setCreateModal({ ...createModal, subscriber: e.target.value })} />
                </div>
                <div>
                  <label className="label">ONU ID</label>
                  <input className="input" value={createModal.onu_id as string} onChange={(e) => setCreateModal({ ...createModal, onu_id: e.target.value })} />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setCreateModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Bulk Edit Modal ── */}
      {bulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setBulkModal(false)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Bulk Edit ({selected.size} tickets)</h2>
            <BulkEditForm onSubmit={bulkUpdate} onCancel={() => setBulkModal(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

function BulkEditForm({ onSubmit, onCancel }: { onSubmit: (d: Record<string, unknown>) => void; onCancel: () => void }) {
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  return (
    <div className="space-y-3">
      <div>
        <label className="label">Status</label>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">No change</option>
          {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Priority</label>
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">No change</option>
          {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" onClick={() => { const d: Record<string, unknown> = {}; if (status) d.status = status; if (priority) d.priority = priority; onSubmit(d); }}>Apply</button>
      </div>
    </div>
  );
}
