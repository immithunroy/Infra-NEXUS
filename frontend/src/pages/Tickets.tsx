import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import {
  Ticket, TicketListResponse, TicketAnalytics, UserOut, TicketTemplate,
  TICKET_STATUSES, TICKET_PRIORITIES, TICKET_CATEGORIES, TICKET_DEPARTMENTS,
} from "../api/types";
import { useUserRole } from "../lib/role";
import { canWrite, canManageUsers } from "../api/types";
import { fmtTimeShort, fmtTime } from "../lib/time";
import { StatusBadge, PriorityBadge, CategoryBadge } from "../components/tickets/TicketBadges";
import { KpiCard } from "../components/tickets/KpiCard";
import { BarChart } from "../components/tickets/Charts";
import { Pagination } from "../components/Pagination";
import ActionResultBanner from "../components/ActionResultBanner";

/* ── Comment types ── */
export const COMMENT_TYPES = [
  { value: "general", label: "General Comment", color: "bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300" },
  { value: "employee", label: "Employee Note", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  { value: "closing", label: "Closing Comment", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  { value: "suggestion", label: "Suggestion", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
] as const;

/* ── Predefined trouble types ── */
const TROUBLE_TYPES = [
  "No Internet",
  "Slow Speed",
  "Intermittent Connection",
  "WiFi Not Working",
  "No TV / IPTV",
  "Fiber Cut / Damage",
  "ONU Down",
  "Power Off",
  "Registration Failed",
  "High Latency / Packet Loss",
  "Billing Issue",
  "New Installation Request",
  "Equipment Upgrade",
  "Other",
];

/* ── Subscriber search result ── */
interface SubResult {
  subscriber: string;
  onu_name: string;
  pon_port: string;
  olt_name: string;
  state: string;
  rx_power: number | null;
  tx_power: number | null;
  onu_id: number;
  phone: string;
  mobile2: string;
}

/* ── Filters ── */
interface Filters {
  status: string;
  priority: string;
  category: string;
  department: string;
  assigned_to: string;
  search: string;
  subscriber: string;
  pon_port: string;
  date_from: string;
  date_to: string;
  sort_by: string;
  sort_dir: string;
}

const defaultFilters: Filters = {
  status: "", priority: "", category: "", department: "",
  assigned_to: "", search: "", subscriber: "", pon_port: "",
  date_from: "", date_to: "",
  sort_by: "created_at", sort_dir: "desc",
};

/* ── Helpers ── */
function elapsed(from: string, to?: string | null): string {
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime();
  if (ms < 0) return "—";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function rxPowerColor(rx: number | null): string {
  if (rx == null) return "text-slate-400";
  if (rx > -18) return "text-emerald-600 dark:text-emerald-400 font-bold";
  if (rx > -22) return "text-emerald-600 dark:text-emerald-400";
  if (rx > -26) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export default function Tickets() {
  const navigate = useNavigate();
  const { role } = useUserRole();
  const writeOk = canWrite(role);
  const isAdmin = canManageUsers(role);

  /* ── Tab state ── */
  type TabKey = "active" | "history";
  const [tab, setTab] = useState<TabKey>("active");

  /* ── List state ── */
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
  const [bulkModal, setBulkModal] = useState(false);

  /* ── Create modal state ── */
  const [createModal, setCreateModal] = useState(false);
  const [subSearch, setSubSearch] = useState("");
  const [subResults, setSubResults] = useState<SubResult[]>([]);
  const [subDropdown, setSubDropdown] = useState(false);
  const [selectedSub, setSelectedSub] = useState<SubResult | null>(null);
  const [troubleType, setTroubleType] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [category, setCategory] = useState("");
  const [department, setDepartment] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [phone1, setPhone1] = useState("");
  const [phone2, setPhone2] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [isAsap, setIsAsap] = useState(false);
  const subRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  /* ── Analytics state ── */
  const [analytics, setAnalytics] = useState<TicketAnalytics | null>(null);
  const [analyticsDays, setAnalyticsDays] = useState(30);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  /* ── Determine active vs history status params ── */
  const tabStatusParam = tab === "history" ? "closed" : undefined;

  /* ── Data loading ── */
  const loadList = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    // Tab filtering: active = not closed, history = closed
    if (tab === "history") {
      params.set("status", "closed");
    } else if (filters.status) {
      params.set("status", filters.status);
    }
    if (filters.priority) params.set("priority", filters.priority);
    if (filters.category) params.set("category", filters.category);
    if (filters.department) params.set("department", filters.department);
    if (filters.assigned_to) params.set("assigned_to", filters.assigned_to);
    if (filters.search) params.set("search", filters.search);
    if (filters.subscriber) params.set("subscriber", filters.subscriber);
    if (filters.pon_port) params.set("pon_port", filters.pon_port);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    params.set("sort_by", filters.sort_by);
    params.set("sort_dir", filters.sort_dir);
    params.set("page", String(page));
    params.set("page_size", "25");
    api
      .get<TicketListResponse>(`/tickets?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); setPages(r.pages); })
      .catch((e) => flash(String(e), false))
      .finally(() => setLoading(false));
  }, [filters, page, tab]);

  const loadAnalytics = useCallback(() => {
    api.get<TicketAnalytics>(`/tickets/analytics/dashboard?days=${analyticsDays}`).then(setAnalytics).catch(() => {});
  }, [analyticsDays]);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadAnalytics(); }, [loadAnalytics]);
  useEffect(() => {
    if (isAdmin) api.get<UserOut[]>("/users").then(setUsers).catch(() => {});
    api.get<TicketTemplate[]>("/tickets/templates/list").then(setTemplates).catch(() => {});
  }, [isAdmin]);

  /* ── Subscriber search ── */
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (subSearch.length < 2) { setSubResults([]); return; }
    searchTimerRef.current = setTimeout(() => {
      api.get<SubResult[]>(`/subscribers?q=${encodeURIComponent(subSearch)}&limit=8`).then(setSubResults).catch(() => setSubResults([]));
    }, 300);
  }, [subSearch]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (subRef.current && !subRef.current.contains(e.target as Node)) setSubDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  /* ── Filter helpers ── */
  const updateFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
    setSelected(new Set());
  };
  const resetFilters = () => { setFilters(defaultFilters); setPage(1); setSelected(new Set()); };
  const toggleSelect = (id: number) => { setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const toggleSelectAll = () => { setSelected((s) => s.size === items.length ? new Set() : new Set(items.map((t) => t.id))); };

  const bulkUpdate = async (data: Record<string, unknown>) => {
    if (selected.size === 0) return;
    try {
      await api.post("/tickets/bulk-update", { ticket_ids: [...selected], ...data });
      flash(`Updated ${selected.size} tickets`);
      setSelected(new Set());
      setBulkModal(false);
      loadList();
    } catch (err) { flash(err instanceof Error ? err.message : "Bulk update failed", false); }
  };

  /* ── Create ticket ── */
  const createTicket = async (e: FormEvent) => {
    e.preventDefault();
    const title = troubleType === "Other" || !troubleType ? customTitle : troubleType;
    if (!title.trim()) { flash("Please select a trouble type or enter a title", false); return; }
    try {
      await api.post("/tickets", {
        title: title.trim(),
        description,
        priority,
        category: category || (troubleType ? "complaint" : ""),
        department,
        assigned_to: assignedTo ? Number(assignedTo) : null,
        subscriber: selectedSub?.subscriber || "",
        onu_id: selectedSub?.onu_id || null,
        phone1,
        phone2,
        expected_at: isAsap ? null : (expectedAt ? new Date(expectedAt).toISOString() : null),
        is_asap: isAsap,
      });
      flash("Ticket created");
      resetCreateForm();
      loadList();
      loadAnalytics();
    } catch (err) { flash(err instanceof Error ? err.message : "Create failed", false); }
  };

  const resetCreateForm = () => {
    setCreateModal(false);
    setSubSearch("");
    setSubResults([]);
    setSelectedSub(null);
    setTroubleType("");
    setCustomTitle("");
    setDescription("");
    setPriority("normal");
    setCategory("");
    setDepartment("");
    setAssignedTo("");
    setPhone1("");
    setPhone2("");
    setExpectedAt("");
    setIsAsap(false);
  };

  const applyTemplate = (tmpl: TicketTemplate) => {
    setTroubleType(tmpl.title);
    setDescription(tmpl.description);
    setPriority(tmpl.priority);
    setCategory(tmpl.category);
    setDepartment(tmpl.department);
  };

  const selectSub = (sub: SubResult) => {
    setSelectedSub(sub);
    setSubSearch(sub.subscriber);
    setSubDropdown(false);
    setPhone1(sub.phone || "");
    setPhone2(sub.mobile2 || "");
  };

  /* ── Close ticket ── */
  const closeTicket = async (id: number) => {
    try {
      await api.post(`/tickets/${id}/close`);
      flash("Ticket closed");
      loadList();
      loadAnalytics();
    } catch (err) { flash(err instanceof Error ? err.message : "Close failed", false); }
  };

  const activeFilterCount = [filters.status, filters.priority, filters.category, filters.department, filters.assigned_to, filters.subscriber, filters.pon_port, filters.date_from, filters.date_to].filter(Boolean).length;

  /* ── Derived stats ── */
  const userTicketMap = new Map<string, number>();
  const troubleMap = new Map<string, number>();
  items.forEach((t) => {
    if (t.assigned_name) userTicketMap.set(t.assigned_name, (userTicketMap.get(t.assigned_name) || 0) + 1);
    if (t.category) troubleMap.set(t.category, (troubleMap.get(t.category) || 0) + 1);
  });
  const userStats = [...userTicketMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const troubleStats = [...troubleMap.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Troubles & Tickets</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{total} total tickets</p>
        </div>
        <div className="flex items-center gap-2">
          {writeOk && <button className="btn-primary" onClick={() => setCreateModal(true)}>+ New ticket</button>}
        </div>
      </header>

      {notice && <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />}

      {/* ── KPI Cards (always visible) ── */}
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

      {/* ── Analytics (always visible) ── */}
      {analytics && (
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

          {/* User & Trouble Ratio */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="card p-4">
              <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Tickets by Assignee</p>
              {userStats.length === 0 ? <p className="text-sm text-slate-400">No data</p> : (
                <div className="space-y-2">
                  {userStats.map(([name, count]) => {
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={name} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 truncate text-xs text-slate-600 dark:text-slate-400">{name}</span>
                        <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                          <div className="absolute inset-y-0 left-0 rounded bg-brand-500/80 dark:bg-brand-400/60" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-16 text-right text-xs text-slate-500">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="card p-4">
              <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Trouble Type Distribution</p>
              {troubleStats.length === 0 ? <p className="text-sm text-slate-400">No data</p> : (
                <div className="space-y-2">
                  {troubleStats.map(([cat, count]) => {
                    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                    return (
                      <div key={cat} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 truncate text-xs text-slate-600 dark:text-slate-400">{cat}</span>
                        <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
                          <div className="absolute inset-y-0 left-0 rounded bg-amber-500/80 dark:bg-amber-400/60" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-16 text-right text-xs text-slate-500">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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

      {/* ── Tab Bar ── */}
      <div className="flex border-b border-slate-200 dark:border-slate-700">
        {(["active", "history"] as const).map((key) => {
          const count = key === "active" ? total : undefined;
          return (
            <button
              key={key}
              className={`relative px-4 py-2 text-sm font-medium transition-colors ${
                tab === key
                  ? "text-brand-600 dark:text-brand-400"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
              onClick={() => { setTab(key); setPage(1); setSelected(new Set()); }}
            >
              {key === "active" ? "Active Tickets" : "History"}
              {tab === key && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-brand-600 dark:bg-brand-400" />}
            </button>
          );
        })}
      </div>

      {/* ── Search + Filters ── */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input max-w-xs" placeholder="Search tickets (ref, title, subscriber)…" value={filters.search} onChange={(e) => updateFilter("search", e.target.value)} />
          <button className={`btn-ghost ${showFilters ? "bg-slate-100 dark:bg-slate-800" : ""}`} onClick={() => setShowFilters(!showFilters)}>
            Filters {activeFilterCount > 0 && <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{activeFilterCount}</span>}
          </button>
          {activeFilterCount > 0 && <button className="btn-ghost text-xs text-slate-500" onClick={resetFilters}>Clear</button>}
          {selected.size > 0 && isAdmin && <button className="btn-secondary text-xs" onClick={() => setBulkModal(true)}>Bulk edit ({selected.size})</button>}
        </div>
        {showFilters && (
          <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
            {/* Row 1: Status / Priority / Category / Department / Assignee */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {tab === "active" && (
                <select className="input" value={filters.status} onChange={(e) => updateFilter("status", e.target.value)}>
                  <option value="">All statuses</option>
                  {TICKET_STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
                </select>
              )}
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
            {/* Row 2: Subscriber / PON Port / Date From / Date To */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <input className="input" placeholder="Subscriber ID…" value={filters.subscriber} onChange={(e) => updateFilter("subscriber", e.target.value)} />
              <input className="input" placeholder="PON port (e.g. EPON0/1)…" value={filters.pon_port} onChange={(e) => updateFilter("pon_port", e.target.value)} />
              <div>
                <label className="label text-[10px]">From</label>
                <input type="date" className="input" value={filters.date_from} onChange={(e) => updateFilter("date_from", e.target.value)} />
              </div>
              <div>
                <label className="label text-[10px]">To</label>
                <input type="date" className="input" value={filters.date_to} onChange={(e) => updateFilter("date_to", e.target.value)} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Ticket Table ── */}
      <div className="card overflow-x-auto">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">
            {tab === "active" ? "No active tickets" : "No closed tickets"}
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <tr>
                  {isAdmin && <th className="th w-8"><input type="checkbox" checked={selected.size === items.length && items.length > 0} onChange={toggleSelectAll} className="rounded" /></th>}
                  <th className="th w-12">Ref</th>
                  <th className="th">Title / Subscriber</th>
                  <th className="th">Status</th>
                  <th className="th">Priority</th>
                  <th className="th hidden lg:table-cell">Category</th>
                  <th className="th hidden md:table-cell">Assigned</th>
                  <th className="th hidden xl:table-cell">Expected</th>
                  <th className="th hidden xl:table-cell">Elapsed</th>
                  <th className="th w-20">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {items.map((t) => (
                  <tr
                    key={t.id}
                    className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 ${selected.has(t.id) ? "bg-brand-50/50 dark:bg-brand-900/10" : ""}`}
                    onClick={() => navigate(`/tickets/${t.id}`)}
                  >
                    {isAdmin && <td className="td" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} className="rounded" /></td>}
                    <td className="td text-xs font-mono text-slate-500">{t.ticket_ref || `#${t.id}`}</td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 dark:text-slate-100">{t.title}</span>
                        {t.is_reopened && <span className="badge bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300">reopened</span>}
                        {t.is_asap && <span className="badge bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">ASAP</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {t.subscriber && (
                          <button className="font-mono text-brand-700 hover:underline dark:text-cyan-300" onClick={(e) => { e.stopPropagation(); navigate(`/subscribers/${encodeURIComponent(t.subscriber)}`); }}>
                            {t.subscriber}
                          </button>
                        )}
                        {t.phone1 && <span className="text-slate-400">📞 {t.phone1}</span>}
                        {t.description && <span className="max-w-xs truncate">{t.description}</span>}
                      </div>
                    </td>
                    <td className="td"><StatusBadge status={t.status} /></td>
                    <td className="td"><PriorityBadge priority={t.priority} /></td>
                    <td className="td hidden lg:table-cell"><CategoryBadge category={t.category} /></td>
                    <td className="td hidden md:table-cell text-slate-600 dark:text-slate-300">{t.assigned_name || "—"}</td>
                    <td className="td hidden xl:table-cell text-xs text-slate-500">
                      {t.is_asap ? (
                        <span className="font-bold text-red-600 dark:text-red-400">ASAP</span>
                      ) : t.expected_at ? (
                        <span>{fmtTimeShort(t.expected_at)}</span>
                      ) : "—"}
                    </td>
                    <td className="td hidden xl:table-cell text-xs text-slate-500">{elapsed(t.created_at, t.resolved_at)}</td>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      {t.status !== "closed" && writeOk && (
                        <button
                          className="text-xs text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                          onClick={() => { if (confirm(`Close ticket #${t.id}?`)) closeTicket(t.id); }}
                          title="Close ticket"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page - 1} setPage={(p) => setPage(p + 1)} totalPages={pages} total={total} pageSize={25} />
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          CREATE TICKET MODAL
          ══════════════════════════════════════════════════════════════════ */}
      {createModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-8" onClick={resetCreateForm}>
          <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">New Trouble / Ticket</h2>

            <form onSubmit={createTicket} className="space-y-4">
              {/* ── 1. Subscriber Search ── */}
              <div ref={subRef} className="relative">
                <label className="label">Subscriber (PPPoE ID)</label>
                <input
                  className="input font-mono"
                  placeholder="Search subscriber by name, PPPoE ID, or MAC…"
                  value={subSearch}
                  onChange={(e) => { setSubSearch(e.target.value); setSelectedSub(null); setSubDropdown(true); }}
                  onFocus={() => subSearch.length >= 2 && setSubDropdown(true)}
                />
                {subDropdown && subResults.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    {subResults.map((s) => (
                      <button
                        key={s.subscriber}
                        type="button"
                        className="flex w-full items-center justify-between border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-700"
                        onClick={() => selectSub(s)}
                      >
                        <div>
                          <span className="font-mono font-medium text-slate-800 dark:text-slate-100">{s.subscriber}</span>
                          {s.onu_name && <span className="ml-2 text-slate-500 dark:text-slate-400">{s.onu_name}</span>}
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`badge ${s.state === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"}`}>{s.state}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── 2. Selected Subscriber Info + ONU Status ── */}
              {selectedSub && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-sm font-bold text-slate-800 dark:text-slate-100">{selectedSub.subscriber}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{selectedSub.onu_name} · {selectedSub.pon_port} · {selectedSub.olt_name}</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs">
                      <div className={`badge ${selectedSub.state === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"}`}>
                        {selectedSub.state}
                      </div>
                      <div className="text-right">
                        <div className={rxPowerColor(selectedSub.rx_power)}>RX: {selectedSub.rx_power != null ? `${selectedSub.rx_power} dBm` : "—"}</div>
                        <div className="text-slate-500 dark:text-slate-400">TX: {selectedSub.tx_power != null ? `${selectedSub.tx_power} dBm` : "—"}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ── 3. Mobile Numbers (auto-filled from subscriber) ── */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Mobile 1</label>
                  <input className="input font-mono" placeholder="Primary mobile" value={phone1} onChange={(e) => setPhone1(e.target.value)} />
                </div>
                <div>
                  <label className="label">Mobile 2</label>
                  <input className="input font-mono" placeholder="Secondary mobile" value={phone2} onChange={(e) => setPhone2(e.target.value)} />
                </div>
              </div>

              {/* ── 4. Trouble Type ── */}
              <div>
                <label className="label">Trouble Type</label>
                <select className="input" value={troubleType} onChange={(e) => setTroubleType(e.target.value)}>
                  <option value="">Select a trouble type…</option>
                  {TROUBLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {/* ── 5. Custom Title (if Other or empty) ── */}
              {(!troubleType || troubleType === "Other") && (
                <div>
                  <label className="label">Ticket Title</label>
                  <input className="input" placeholder="Enter ticket title…" value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} required />
                </div>
              )}

              {/* ── 6. Description ── */}
              <div>
                <label className="label">Description</label>
                <textarea className="input min-h-[80px]" placeholder="Describe the issue…" value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>

              {/* ── 7. Expected Date/Time + ASAP ── */}
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="label">Expected Resolution</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={expectedAt}
                    onChange={(e) => setExpectedAt(e.target.value)}
                    disabled={isAsap}
                  />
                </div>
                <div className="flex items-center gap-2 pb-0.5">
                  <input
                    type="checkbox"
                    id="asap-check"
                    className="rounded"
                    checked={isAsap}
                    onChange={(e) => { setIsAsap(e.target.checked); if (e.target.checked) setExpectedAt(""); }}
                  />
                  <label htmlFor="asap-check" className="text-sm font-medium text-slate-700 dark:text-slate-300">ASAP</label>
                </div>
              </div>

              {/* ── 8. Priority / Category / Department ── */}
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Priority</label>
                  <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    {TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Category</label>
                  <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">Auto</option>
                    {TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Department</label>
                  <select className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
                    <option value="">None</option>
                    {TICKET_DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              {/* ── 9. Assign To ── */}
              {isAdmin && (
                <div>
                  <label className="label">Assign To</label>
                  <select className="input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                    <option value="">Unassigned</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.username} ({u.role})</option>)}
                  </select>
                </div>
              )}

              {/* ── 10. Templates ── */}
              {templates.length > 0 && (
                <div>
                  <label className="label">Quick fill from template</label>
                  <div className="flex flex-wrap gap-1">
                    {templates.map((t) => <button key={t.id} type="button" className="btn-ghost text-xs" onClick={() => applyTemplate(t)}>{t.name}</button>)}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-700">
                <button type="button" className="btn-secondary" onClick={resetCreateForm}>Cancel</button>
                <button type="submit" className="btn-primary">Create Ticket</button>
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
