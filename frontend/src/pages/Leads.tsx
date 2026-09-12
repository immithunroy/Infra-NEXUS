import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import {
  Lead, LeadDashboard, UserLeadPerformance, MonthlySummary,
  LEAD_STATUSES, LEAD_STATUS_LABELS, LEAD_STATUS_COLORS,
  LEAD_PRIORITIES, LEAD_PRIORITY_LABELS, LEAD_PRIORITY_COLORS,
  LEAD_SOURCES, LEAD_SOURCE_LABELS,
} from "../api/types";
import { useUserRole } from "../lib/role";
import { fmtTime } from "../lib/time";
import ActionResultBanner from "../components/ActionResultBanner";
import { Pagination, PAGE_SIZE } from "../components/Pagination";
import LeadDetailPanel from "./LeadDetail";

/* ── helpers ────────────────────────────────────────────────────────── */

const PREDEFINED_PACKAGES = [
  { name: "30 Mbps", price: 500 },
  { name: "35 Mbps", price: 525 },
  { name: "40 Mbps", price: 650 },
  { name: "60 Mbps", price: 800 },
  { name: "100 Mbps", price: 1000 },
  { name: "150 Mbps", price: 1200 },
  { name: "200 Mbps", price: 1500 },
];

function fmtCurrency(n: number | null): string {
  if (n == null) return "৳0";
  return `৳${n.toLocaleString("en-IN")}`;
}

function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 100) : 0;
}

/* ── small UI bits ──────────────────────────────────────────────────── */

function Kpi({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`} />
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
          {icon}
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {label}
          </div>
          <div className="mt-0.5 text-2xl font-bold text-slate-900 dark:text-white">{value}</div>
        </div>
      </div>
    </div>
  );
}

/* ── SVG Charts ─────────────────────────────────────────────────────── */

function DonutChart({
  segments,
  center,
  sub,
}: {
  segments: { label: string; value: number; color: string }[];
  center: string;
  sub: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const R = 40;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex h-full items-center gap-6">
      <div className="relative h-48 w-48 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle
            cx={50}
            cy={50}
            r={R}
            fill="none"
            stroke="currentColor"
            className="text-slate-200 dark:text-slate-700"
            strokeWidth={13}
          />
          {segments.map((s) => {
            if (s.value <= 0) return null;
            const frac = s.value / total;
            const el = (
              <circle
                key={s.label}
                cx={50}
                cy={50}
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={13}
                strokeDasharray={`${frac * C} ${C}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 1s ease" }}
              />
            );
            offset += frac * C;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{center}</div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">{sub}</div>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-1.5">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-semibold text-slate-900 dark:text-white">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BarChart({
  data,
  barColors,
  labels,
}: {
  data: { label: string; values: number[] }[];
  barColors: string[];
  labels: string[];
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-slate-500">
        No data yet.
      </div>
    );
  }
  const allVals = data.flatMap((d) => d.values);
  const maxVal = Math.max(...allVals, 1);
  const barCount = barColors.length;
  const groupWidth = 60;
  const barWidth = Math.min(12, (groupWidth - barCount * 2) / barCount);
  const svgW = data.length * groupWidth + 40;
  const svgH = 220;
  const plotH = 180;
  const padTop = 10;
  const padLeft = 36;
  const padBottom = 24;

  const yTicks = 4;
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = Math.round((maxVal / yTicks) * i);
    const y = padTop + plotH - (val / maxVal) * plotH;
    return { val, y };
  });

  return (
    <div className="flex h-full flex-col justify-center overflow-x-auto">
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full" style={{ minWidth: svgW }}>
        {yLines.map((t, i) => (
          <g key={i}>
            <line
              x1={padLeft}
              y1={t.y}
              x2={svgW}
              y2={t.y}
              stroke="currentColor"
              className="text-slate-200 dark:text-slate-700"
              strokeWidth={0.5}
            />
            <text x={padLeft - 4} y={t.y + 3} textAnchor="end" className="fill-slate-400 dark:fill-slate-500" fontSize={9}>
              {t.val}
            </text>
          </g>
        ))}
        {data.map((d, gi) => {
          const gx = padLeft + gi * groupWidth + (groupWidth - barCount * barWidth - (barCount - 1) * 2) / 2;
          return (
            <g key={d.label}>
              {d.values.map((v, vi) => {
                const bh = (v / maxVal) * plotH;
                return (
                  <rect
                    key={vi}
                    x={gx + vi * (barWidth + 2)}
                    y={padTop + plotH - bh}
                    width={barWidth}
                    height={bh}
                    rx={2}
                    fill={barColors[vi]}
                    className="transition-all duration-500"
                  />
                );
              })}
              <text
                x={padLeft + gi * groupWidth + groupWidth / 2}
                y={svgH - 4}
                textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400"
                fontSize={8}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3">
        {labels.map((l, i) => (
          <span key={l} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: barColors[i] }} />
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function HorizontalBarChart({
  data,
  maxVal,
}: {
  data: { label: string; total: number; successful: number; rate: number }[];
  maxVal: number;
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-slate-500">
        No data yet.
      </div>
    );
  }
  const barH = 22;
  const gap = 8;
  const padLeft = 120;
  const padRight = 50;
  const svgH = data.length * (barH + gap) + 10;

  return (
    <div className="flex h-full flex-col justify-center overflow-x-auto">
      <svg viewBox={`0 0 400 ${svgH}`} className="w-full" style={{ minWidth: 400 }}>
        {data.map((d, i) => {
          const y = i * (barH + gap) + 5;
          const totalW = maxVal > 0 ? (d.total / maxVal) * (400 - padLeft - padRight) : 0;
          const succW = maxVal > 0 ? (d.successful / maxVal) * (400 - padLeft - padRight) : 0;
          return (
            <g key={d.label}>
              <text x={padLeft - 8} y={y + barH / 2 + 3} textAnchor="end" className="fill-slate-600 dark:fill-slate-300" fontSize={10}>
                {d.label}
              </text>
              <rect x={padLeft} y={y} width={Math.max(totalW, 1)} height={barH} rx={3} fill="#6366f1" opacity={0.3} />
              <rect x={padLeft} y={y} width={Math.max(succW, 1)} height={barH} rx={3} fill="#10b981" />
              <text x={padLeft + Math.max(totalW, 1) + 6} y={y + barH / 2 + 3} className="fill-slate-500 dark:fill-slate-400" fontSize={9}>
                {d.rate}%
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex gap-3">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="h-2.5 w-2.5 rounded-full bg-indigo-400 opacity-40" /> Total Leads
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Successful
        </span>
      </div>
    </div>
  );
}

/* ── Lead Icons ─────────────────────────────────────────────────────── */

const LeadIcon = () => (
  <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
  </svg>
);

const NewIcon = () => (
  <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const FollowUpIcon = () => (
  <svg className="h-5 w-5 text-purple-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
  </svg>
);

const InterestedIcon = () => (
  <svg className="h-5 w-5 text-cyan-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
  </svg>
);

const InstallIcon = () => (
  <svg className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.1-5.1m0 0L11.42 4.97m-5.1 5.1H21M3 3v18" />
  </svg>
);

const SuccessIcon = () => (
  <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const LostIcon = () => (
  <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const ConversionIcon = () => (
  <svg className="h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
  </svg>
);

const RevenueIcon = () => (
  <svg className="h-5 w-5 text-emerald-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

/* ── Main Component ─────────────────────────────────────────────────── */

export default function Leads() {
  const { role, user } = useUserRole();
  const isAdmin = role === "admin" || role === "global_write";

  const [leads, setLeads] = useState<Lead[]>([]);
  const [dashboard, setDashboard] = useState<LeadDashboard | null>(null);
  const [userPerf, setUserPerf] = useState<UserLeadPerformance[]>([]);
  const [monthly, setMonthly] = useState<MonthlySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Partial<Lead> | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [wards, setWards] = useState<string[]>([]);
  const [packages, setPackages] = useState<string[]>([]);
  const [showAddPackage, setShowAddPackage] = useState(false);
  const [newPackageName, setNewPackageName] = useState("");
  const [newPackagePrice, setNewPackagePrice] = useState("");
  const [users, setUsers] = useState<{ id: number; username: string }[]>([]);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 4000);
  };

  /* ── data loading ─────────────────────────────────────────────────── */

  const loadDashboard = useCallback(() => {
    api.get<LeadDashboard>("/leads/dashboard").then(setDashboard).catch(() => undefined);
  }, []);

  const loadUserPerf = useCallback(() => {
    api.get<UserLeadPerformance[]>("/leads/user-performance").then(setUserPerf).catch(() => undefined);
  }, []);

  const loadMonthly = useCallback(() => {
    api.get<MonthlySummary[]>("/leads/monthly-summary").then(setMonthly).catch(() => undefined);
  }, []);

  const loadLeads = useCallback(() => {
    setLoading(true);
    const params: Record<string, string | number> = {};
    if (filters.q) params.q = filters.q;
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;
    if (filters.ward) params.ward = filters.ward;
    if (filters.package) params.package = filters.package;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    params.sort = "created_at";
    params.order = "asc";
    params.limit = PAGE_SIZE;
    params.offset = page * PAGE_SIZE;

    api
      .get<Lead[]>("/leads", params)
      .then((data) => {
        setLeads(data);
        setTotalCount(data.length);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [filters, page]);

  const loadCount = useCallback(() => {
    const params: Record<string, string> = {};
    if (filters.q) params.q = filters.q;
    if (filters.status) params.status = filters.status;
    if (filters.priority) params.priority = filters.priority;
    if (filters.source) params.source = filters.source;
    if (filters.ward) params.ward = filters.ward;
    if (filters.package) params.package = filters.package;
    if (filters.date_from) params.date_from = filters.date_from;
    if (filters.date_to) params.date_to = filters.date_to;
    api.get<{ total: number }>("/leads/count", params).then((d) => setTotalCount(d.total)).catch(() => undefined);
  }, [filters]);

  useEffect(() => {
    loadDashboard();
    loadUserPerf();
    loadMonthly();
    api.get<string[]>("/leads/wards/list").then(setWards).catch(() => undefined);
    api.get<string[]>("/leads/packages/list").then(setPackages).catch(() => undefined);
    api.get<{ id: number; username: string }[]>("/users").then(setUsers).catch(() => undefined);
  }, [loadDashboard, loadUserPerf, loadMonthly]);

  useEffect(() => {
    loadLeads();
    loadCount();
  }, [loadLeads, loadCount]);

  /* ── actions ──────────────────────────────────────────────────────── */

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    try {
      const body: Record<string, unknown> = {
        customer_name: modal.customer_name || "",
        mobile_primary: modal.mobile_primary || "",
        mobile_secondary: modal.mobile_secondary || "",
        road_area: modal.road_area || "",
        ward: modal.ward || "",
        package_name: modal.package_name || "",
        service_charge: modal.service_charge ? Number(modal.service_charge) : null,
        lead_source: modal.lead_source || "other",
        assigned_to: modal.assigned_to ? Number(modal.assigned_to) : null,
        status: modal.status || "new",
        priority: modal.priority || "normal",
        expected_connection_date: modal.expected_connection_date || null,
        customer_address: modal.customer_address || "",
        notes: modal.notes || "",
        latitude: modal.latitude ? Number(modal.latitude) : null,
        longitude: modal.longitude ? Number(modal.longitude) : null,
        follow_up_date: modal.follow_up_date || null,
        follow_up_notes: modal.follow_up_notes || "",
        lost_reason: modal.lost_reason || "",
      };

      if (modal.id) {
        await api.put(`/leads/${modal.id}`, body);
        flash("Lead updated");
      } else {
        await api.post("/leads", body);
        flash("Lead created");
      }
      setModal(null);
      loadLeads();
      loadDashboard();
      loadUserPerf();
      loadMonthly();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    }
  };

  const handleDelete = async (lead: Lead) => {
    if (!confirm(`Delete lead "${lead.customer_name}"?`)) return;
    try {
      await api.del(`/leads/${lead.id}`);
      flash("Lead deleted");
      loadLeads();
      loadDashboard();
      loadUserPerf();
      loadMonthly();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", false);
    }
  };

  const handleConvert = async (lead: Lead) => {
    if (!confirm(`Convert "${lead.customer_name}" to subscriber?`)) return;
    try {
      await api.post(`/leads/${lead.id}/convert`, {});
      flash("Lead converted to subscriber");
      loadLeads();
      loadDashboard();
      loadUserPerf();
      loadMonthly();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Conversion failed", false);
    }
  };

  const clearFilters = () => {
    setFilters({});
    setPage(0);
  };

  const handleInlineUpdate = async (id: number, field: string, value: unknown) => {
    try {
      await api.put(`/leads/${id}`, { [field]: value });
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
    } catch (err) {
      flash(err instanceof Error ? err.message : "Update failed", false);
    }
  };

  /* ── derived data ─────────────────────────────────────────────────── */

  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);

  const statusSegments = useMemo(() => {
    if (!dashboard) return [];
    const d = dashboard;
    return [
      { label: "New", value: d.new_count, color: "#3b82f6" },
      { label: "Contacted", value: 0, color: "#eab308" },
      { label: "Follow-up", value: d.follow_up, color: "#a855f7" },
      { label: "Interested", value: d.interested, color: "#06b6d4" },
      { label: "Install Pending", value: d.installation_pending, color: "#f59e0b" },
      { label: "Successful", value: d.successful, color: "#10b981" },
      { label: "Lost", value: d.lost, color: "#ef4444" },
    ].filter((s) => s.value > 0);
  }, [dashboard]);

  const monthlyChartData = useMemo(() => {
    return monthly.map((m) => ({
      label: m.month.slice(5),
      values: [m.total_leads, m.successful, m.lost],
    }));
  }, [monthly]);

  const userPerfData = useMemo(() => {
    const sorted = [...userPerf].sort((a, b) => b.total_leads - a.total_leads);
    const maxLeads = Math.max(...sorted.map((u) => u.total_leads), 1);
    return { rows: sorted.slice(0, 10), maxVal: maxLeads };
  }, [userPerf]);

  const activeFilters = Object.values(filters).filter(Boolean).length;

  const userNameMap = useMemo(() => {
    const map: Record<number, string> = {};
    users.forEach((u) => { map[u.id] = u.username; });
    return map;
  }, [users]);

  /* ── render ───────────────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Lead Management</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {dashboard
              ? `${dashboard.total} total leads · ${dashboard.successful} converted · ${dashboard.conversion_rate}% rate`
              : "Loading..."}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ status: "new", priority: "normal", lead_source: "other" })}>
          + New Lead
        </button>
      </header>

      {notice && <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />}

      {/* ── Dashboard Cards ──────────────────────────────────────────── */}
      {dashboard && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <Kpi label="Total Leads" value={dashboard.total} icon={<LeadIcon />} accent="from-blue-400 to-blue-600" />
          <Kpi label="New" value={dashboard.new_count} icon={<NewIcon />} accent="from-blue-500 to-indigo-500" />
          <Kpi label="Follow-up" value={dashboard.follow_up} icon={<FollowUpIcon />} accent="from-purple-400 to-purple-600" />
          <Kpi label="Interested" value={dashboard.interested} icon={<InterestedIcon />} accent="from-cyan-400 to-cyan-600" />
          <Kpi label="Install Pending" value={dashboard.installation_pending} icon={<InstallIcon />} accent="from-amber-400 to-amber-600" />
          <Kpi label="Successful" value={dashboard.successful} icon={<SuccessIcon />} accent="from-green-400 to-green-600" />
          <Kpi label="Lost" value={dashboard.lost} icon={<LostIcon />} accent="from-red-400 to-red-600" />
          <Kpi label="Conversion" value={`${dashboard.conversion_rate}%`} icon={<ConversionIcon />} accent="from-indigo-400 to-indigo-600" />
          <Kpi label="Service Revenue" value={fmtCurrency(dashboard.total_service_charge)} icon={<RevenueIcon />} accent="from-emerald-400 to-emerald-600" />
        </div>
      )}

      {/* ── Charts ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card flex h-[360px] flex-col p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Status Distribution
          </h3>
          <div className="flex-1 overflow-hidden">
            {statusSegments.length > 0 ? (
              <DonutChart
                segments={statusSegments}
                center={String(dashboard?.total || 0)}
                sub="total leads"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-slate-500">
                No leads yet.
              </div>
            )}
          </div>
        </div>

        <div className="card flex h-[360px] flex-col p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Monthly Performance
          </h3>
          <div className="flex-1 overflow-hidden">
            <BarChart
              data={monthlyChartData}
              barColors={["#6366f1", "#10b981", "#ef4444"]}
              labels={["Total", "Successful", "Lost"]}
            />
          </div>
        </div>

        <div className="card flex h-[360px] flex-col p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Employee Performance
          </h3>
          <div className="flex-1 overflow-hidden">
            <HorizontalBarChart
              data={userPerfData.rows.map((u) => ({
                label: u.user_name,
                total: u.total_leads,
                successful: u.successful,
                rate: u.conversion_rate,
              }))}
              maxVal={userPerfData.maxVal}
            />
          </div>
        </div>
      </div>

      {/* ── Filters ──────────────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1" style={{ minWidth: 180 }}>
            <label className="label">Search</label>
            <input
              className="input"
              placeholder="Name, mobile, area, notes..."
              value={filters.q || ""}
              onChange={(e) => { setFilters({ ...filters, q: e.target.value }); setPage(0); }}
            />
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="label">Status</label>
            <select className="input" value={filters.status || ""} onChange={(e) => { setFilters({ ...filters, status: e.target.value }); setPage(0); }}>
              <option value="">All</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="label">Priority</label>
            <select className="input" value={filters.priority || ""} onChange={(e) => { setFilters({ ...filters, priority: e.target.value }); setPage(0); }}>
              <option value="">All</option>
              {LEAD_PRIORITIES.map((p) => (
                <option key={p} value={p}>{LEAD_PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="label">Source</label>
            <select className="input" value={filters.source || ""} onChange={(e) => { setFilters({ ...filters, source: e.target.value }); setPage(0); }}>
              <option value="">All</option>
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="label">Ward</label>
            <select className="input" value={filters.ward || ""} onChange={(e) => { setFilters({ ...filters, ward: e.target.value }); setPage(0); }}>
              <option value="">All</option>
              {wards.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="label">Package</label>
            <select className="input" value={filters.package || ""} onChange={(e) => { setFilters({ ...filters, package: e.target.value }); setPage(0); }}>
              <option value="">All</option>
              {packages.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 130 }}>
            <label className="label">Date From</label>
            <input
              className="input"
              type="date"
              value={filters.date_from || ""}
              onChange={(e) => { setFilters({ ...filters, date_from: e.target.value }); setPage(0); }}
            />
          </div>
          <div style={{ minWidth: 130 }}>
            <label className="label">Date To</label>
            <input
              className="input"
              type="date"
              value={filters.date_to || ""}
              onChange={(e) => { setFilters({ ...filters, date_to: e.target.value }); setPage(0); }}
            />
          </div>
          {activeFilters > 0 && (
            <button className="btn-ghost text-red-600" onClick={clearFilters}>
              Clear ({activeFilters})
            </button>
          )}
        </div>
      </div>

      {/* ── Lead Table ───────────────────────────────────────────────── */}
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            Leads
            <span className="ml-2 font-normal text-slate-400">({totalCount})</span>
          </span>
        </div>
        <Pagination
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          total={totalCount}
          pageSize={PAGE_SIZE}
          top
        />
        {loading ? (
          <div className="p-6 text-sm text-slate-400">Loading leads...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="th w-12">SL</th>
                <th className="th">Lead</th>
                <th className="th">Mobile</th>
                <th className="th">Area / Road</th>
                <th className="th">Package</th>
                <th className="th">Service Charge</th>
                <th className="th">Assigned To</th>
                <th className="th">Status</th>
                <th className="th">Expected Date</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {leads.map((l, index) => (
                <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="td text-center text-xs text-slate-500">{page * PAGE_SIZE + index + 1}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{l.customer_name}</span>
                      <span className={`badge text-[10px] ${LEAD_PRIORITY_COLORS[l.priority as keyof typeof LEAD_PRIORITY_COLORS] || ""}`}>
                        {LEAD_PRIORITY_LABELS[l.priority as keyof typeof LEAD_PRIORITY_LABELS] || l.priority}
                      </span>
                    </div>
                  </td>
                  <td className="td">
                    <div className="text-sm">{l.mobile_primary}</div>
                    {l.mobile_secondary && <div className="text-xs text-slate-400">{l.mobile_secondary}</div>}
                  </td>
                  <td className="td text-sm">{l.road_area || "—"}</td>
                  <td className="td text-sm">{l.package_name || "—"}</td>
                  <td className="td text-sm font-medium">{fmtCurrency(l.service_charge)}</td>
                  <td className="td">
                    <select
                      className="w-full border-0 bg-transparent text-sm text-slate-600 dark:text-slate-300"
                      value={l.assigned_to ?? ""}
                      onChange={(e) => handleInlineUpdate(l.id, "assigned_to", e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">Unassigned</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>{u.username}</option>
                      ))}
                    </select>
                  </td>
                  <td className="td">
                    <span className={`badge ${LEAD_STATUS_COLORS[l.status as keyof typeof LEAD_STATUS_COLORS] || ""}`}>
                      {LEAD_STATUS_LABELS[l.status as keyof typeof LEAD_STATUS_LABELS] || l.status}
                    </span>
                  </td>
                  <td className="td">
                    <input
                      type="date"
                      className="w-full border-0 bg-transparent text-xs text-slate-500"
                      value={l.expected_connection_date ? l.expected_connection_date.slice(0, 10) : ""}
                      onChange={(e) => handleInlineUpdate(l.id, "expected_connection_date", e.target.value || null)}
                    />
                  </td>
                  <td className="td">
                    <div className="flex gap-1">
                      <button
                        className="btn-ghost text-xs text-blue-600"
                        onClick={() => setSelectedLeadId(l.id)}
                      >
                        View
                      </button>
                      <button
                        className="btn-ghost text-xs"
                        onClick={() => setModal(l)}
                      >
                        Edit
                      </button>
                      {isAdmin && (
                        <button
                          className="btn-ghost text-xs text-red-600"
                          onClick={() => handleDelete(l)}
                        >
                          Del
                        </button>
                      )}
                      {l.status !== "successful" && (
                        <button
                          className="btn-ghost text-xs text-emerald-600"
                          onClick={() => handleConvert(l)}
                        >
                          Convert
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td className="td text-slate-500" colSpan={9}>
                    No leads found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        <Pagination
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          total={totalCount}
          pageSize={PAGE_SIZE}
        />
      </div>

      {/* ── Monthly Summary ──────────────────────────────────────────── */}
      {monthly.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Monthly Summary
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="th">Month</th>
                <th className="th">Total Leads</th>
                <th className="th">Successful</th>
                <th className="th">Pending</th>
                <th className="th">Lost</th>
                <th className="th">Conversion %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {monthly.map((m) => {
                const pending = m.total_leads - m.successful - m.lost;
                return (
                  <tr key={m.month} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="td font-medium">{m.month}</td>
                    <td className="td">{m.total_leads}</td>
                    <td className="td text-emerald-600 dark:text-emerald-400">{m.successful}</td>
                    <td className="td text-amber-600 dark:text-amber-400">{pending}</td>
                    <td className="td text-red-600 dark:text-red-400">{m.lost}</td>
                    <td className="td font-semibold">{pct(m.successful, m.total_leads)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Employee Performance Table ───────────────────────────────────── */}
      {userPerf.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Employee Performance
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="th">User</th>
                <th className="th">Total Leads</th>
                <th className="th">Successful</th>
                <th className="th">Pending</th>
                <th className="th">Lost</th>
                <th className="th">Conversion %</th>
                <th className="th">Service Charge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {[...userPerf]
                .sort((a, b) => b.total_leads - a.total_leads)
                .map((u) => (
                  <tr key={u.user_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="td font-medium">{u.user_name}</td>
                    <td className="td">{u.total_leads}</td>
                    <td className="td text-emerald-600 dark:text-emerald-400">{u.successful}</td>
                    <td className="td text-amber-600 dark:text-amber-400">{u.pending}</td>
                    <td className="td text-red-600 dark:text-red-400">{u.lost}</td>
                    <td className="td font-semibold">{u.conversion_rate}%</td>
                    <td className="td">{fmtCurrency(u.total_service_charge)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add/Edit Modal ───────────────────────────────────────────── */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setModal(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">
              {modal.id ? "Edit Lead" : "New Lead"}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Customer Name *</label>
                  <input
                    className="input"
                    value={modal.customer_name || ""}
                    onChange={(e) => setModal({ ...modal, customer_name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Mobile Primary *</label>
                  <input
                    className="input"
                    value={modal.mobile_primary || ""}
                    onChange={(e) => setModal({ ...modal, mobile_primary: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Mobile Secondary</label>
                  <input
                    className="input"
                    value={modal.mobile_secondary || ""}
                    onChange={(e) => setModal({ ...modal, mobile_secondary: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Road / Area</label>
                  <input
                    className="input"
                    value={modal.road_area || ""}
                    onChange={(e) => setModal({ ...modal, road_area: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Ward</label>
                  <input
                    className="input"
                    value={modal.ward || ""}
                    onChange={(e) => setModal({ ...modal, ward: e.target.value })}
                    list="ward-options"
                  />
                  <datalist id="ward-options">
                    {wards.map((w) => <option key={w} value={w} />)}
                  </datalist>
                </div>
                <div>
                  <label className="label">Package</label>
                  <div className="flex gap-1.5">
                    <select
                      className="input flex-1"
                      value={modal.package_name || ""}
                      onChange={(e) => {
                        const pkg = PREDEFINED_PACKAGES.find((p) => p.name === e.target.value);
                        setModal({
                          ...modal,
                          package_name: e.target.value,
                          service_charge: pkg ? pkg.price : modal.service_charge,
                        });
                      }}
                    >
                      <option value="">Select package</option>
                      {PREDEFINED_PACKAGES.map((p) => (
                        <option key={p.name} value={p.name}>{p.name} @ {p.price} Tk</option>
                      ))}
                      {packages.filter((p) => !PREDEFINED_PACKAGES.some((pp) => pp.name === p)).map((p) => (
                        <option key={p} value={p}>{p}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-ghost shrink-0 px-2 text-xs"
                      onClick={() => setShowAddPackage(!showAddPackage)}
                      title="Add custom package"
                    >
                      + Add
                    </button>
                  </div>
                  {showAddPackage && (
                    <div className="mt-2 flex gap-1.5">
                      <input
                        className="input flex-1"
                        placeholder="Package name"
                        value={newPackageName}
                        onChange={(e) => setNewPackageName(e.target.value)}
                      />
                      <input
                        className="input w-24"
                        type="number"
                        placeholder="Price"
                        value={newPackagePrice}
                        onChange={(e) => setNewPackagePrice(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-primary shrink-0 px-3 text-xs"
                        onClick={() => {
                          const name = newPackageName.trim();
                          if (!name) return;
                          const price = newPackagePrice ? Number(newPackagePrice) : null;
                          setPackages((prev) => [...prev, name]);
                          setModal({ ...modal, package_name: name, service_charge: price ?? modal.service_charge });
                          setNewPackageName("");
                          setNewPackagePrice("");
                          setShowAddPackage(false);
                        }}
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
                <div>
                  <label className="label">Service Charge (৳)</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={modal.service_charge ?? ""}
                    onChange={(e) => setModal({ ...modal, service_charge: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
                <div>
                  <label className="label">Lead Source</label>
                  <select
                    className="input"
                    value={modal.lead_source || "other"}
                    onChange={(e) => setModal({ ...modal, lead_source: e.target.value })}
                  >
                    {LEAD_SOURCES.map((s) => (
                      <option key={s} value={s}>{LEAD_SOURCE_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Assigned To</label>
                  <select
                    className="input"
                    value={modal.assigned_to ?? ""}
                    onChange={(e) => setModal({ ...modal, assigned_to: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select
                    className="input"
                    value={modal.status || "new"}
                    onChange={(e) => setModal({ ...modal, status: e.target.value })}
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>{LEAD_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select
                    className="input"
                    value={modal.priority || "normal"}
                    onChange={(e) => setModal({ ...modal, priority: e.target.value })}
                  >
                    {LEAD_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{LEAD_PRIORITY_LABELS[p]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Expected Connection Date</label>
                  <input
                    className="input"
                    type="date"
                    value={modal.expected_connection_date || ""}
                    onChange={(e) => setModal({ ...modal, expected_connection_date: e.target.value || null })}
                  />
                </div>
              </div>

              <div>
                <label className="label">Customer Address</label>
                <textarea
                  className="input min-h-[60px]"
                  value={modal.customer_address || ""}
                  onChange={(e) => setModal({ ...modal, customer_address: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input min-h-[60px]"
                  value={modal.notes || ""}
                  onChange={(e) => setModal({ ...modal, notes: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Latitude</label>
                  <input
                    className="input"
                    type="number"
                    step="any"
                    value={modal.latitude ?? ""}
                    onChange={(e) => setModal({ ...modal, latitude: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
                <div>
                  <label className="label">Longitude</label>
                  <input
                    className="input"
                    type="number"
                    step="any"
                    value={modal.longitude ?? ""}
                    onChange={(e) => setModal({ ...modal, longitude: e.target.value ? Number(e.target.value) : null })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label">Follow-up Date</label>
                  <input
                    className="input"
                    type="date"
                    value={modal.follow_up_date || ""}
                    onChange={(e) => setModal({ ...modal, follow_up_date: e.target.value || null })}
                  />
                </div>
                <div />
              </div>

              <div>
                <label className="label">Follow-up Notes</label>
                <textarea
                  className="input min-h-[60px]"
                  value={modal.follow_up_notes || ""}
                  onChange={(e) => setModal({ ...modal, follow_up_notes: e.target.value })}
                />
              </div>

              {modal.status === "lost" && (
                <div>
                  <label className="label">Lost Reason</label>
                  <textarea
                    className="input min-h-[60px]"
                    value={modal.lost_reason || ""}
                    onChange={(e) => setModal({ ...modal, lost_reason: e.target.value })}
                    placeholder="Why was this lead lost?"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary">
                  {modal.id ? "Update" : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedLeadId && (
        <LeadDetailPanel
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
          onConverted={() => { loadLeads(); loadDashboard(); loadUserPerf(); loadMonthly(); }}
        />
      )}
    </div>
  );
}
