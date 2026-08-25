import { ReactNode, useEffect, useMemo, useState } from "react";
import { api, downloadFile } from "../api/client";
import {
  DowntimeReport,
  DowntimeReportRow,
  FluctuationReport,
  FluctuationReportRow,
  OpticalReport,
  OpticalReportRow,
  OLTDevice,
  PortReportExport,
  PortReportRow,
  ReportSummary,
} from "../api/types";
import StatusBadge from "../components/StatusBadge";

function pct(used: number, total: number) {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

const reasonBadge: Record<string, string> = {
  "power-off": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  "wire-down": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  unknown: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const fmtDt = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const fmtH = (s: number) => `${(s / 3600).toFixed(2)} h`;
const fmtMin = (s: number) => `${(s / 60).toFixed(1)} min`;

type Tab = "summary" | "optical" | "downtime" | "ports" | "fluctuation";

const stateColor: Record<string, string> = {
  active: "text-emerald-600 dark:text-emerald-300",
  inactive: "text-amber-600 dark:text-amber-300",
  offline: "text-rose-600 dark:text-rose-300",
  unknown: "text-slate-400",
};

export default function Reports() {
  const [tab, setTab] = useState<Tab>("summary");
  const [olts, setOlts] = useState<OLTDevice[]>([]);
  const [oltId, setOltId] = useState("");
  const [port, setPort] = useState("");
  const [days, setDays] = useState(7);
  const [sortBy, setSortBy] = useState("olt");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [exporting, setExporting] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<-25 | -28 | -30 | -32 | 0>(-25);

  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [optical, setOptical] = useState<OpticalReport | null>(null);
  const [downtime, setDowntime] = useState<DowntimeReport | null>(null);
  const [ports, setPorts] = useState<PortReportExport | null>(null);
  const [fluctuation, setFluctuation] = useState<FluctuationReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<OLTDevice[]>("/devices/olts").then(setOlts).catch(() => undefined);
  }, []);

  const portOptions = useMemo(() => {
    const list = olts.filter((o) => !oltId || String(o.id) === oltId);
    return Array.from(new Set(list.flatMap((o) => (o.ports || [])))).sort();
  }, [olts, oltId]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (oltId) params.set("olt_id", oltId);
    params.set("days", String(days));
    const q = params.toString();
    const jobs: Promise<unknown>[] = [
      api.get<ReportSummary>(`/reports?${q}`).then(setSummary).catch(() => undefined),
    ];
    if (tab === "optical") {
      const op = new URLSearchParams(params);
      if (port) op.set("port", port);
      op.set("sort_by", sortBy);
      op.set("order", order);
      jobs.push(api.get<OpticalReport>(`/reports/optical?${op.toString()}`).then(setOptical).catch(() => undefined));
    } else if (tab === "downtime") {
      const dp = new URLSearchParams(params);
      if (port) dp.set("port", port);
      jobs.push(api.get<DowntimeReport>(`/reports/downtime?${dp.toString()}`).then(setDowntime).catch(() => undefined));
    } else if (tab === "ports") {
      const pp = new URLSearchParams();
      if (oltId) pp.set("olt_id", oltId);
      if (port) pp.set("port", port);
      jobs.push(api.get<PortReportExport>(`/reports/ports?${pp.toString()}`).then(setPorts).catch(() => undefined));
    } else if (tab === "fluctuation") {
      const fp = new URLSearchParams(params);
      if (port) fp.set("port", port);
      fp.set("threshold", "3");
      jobs.push(api.get<FluctuationReport>(`/reports/fluctuation?${fp.toString()}`).then(setFluctuation).catch(() => undefined));
    }
    Promise.all(jobs).finally(() => setLoading(false));
  }, [oltId, port, days, tab, sortBy, order]);

  const stateSegments = useMemo(() => {
    if (!summary) return [];
    return [
      { label: "Active", value: summary.state.active || 0, color: "#10b981" },
      { label: "Inactive", value: summary.state.inactive || 0, color: "#f59e0b" },
      { label: "Offline", value: summary.state.offline || 0, color: "#ef4444" },
      { label: "Unknown", value: summary.state.unknown || 0, color: "#94a3b8" },
    ];
  }, [summary]);

  const exportFile = async (kind: "xlsx" | "pdf", report: string, name: string) => {
    setExporting(name);
    const params = new URLSearchParams();
    if (oltId) params.set("olt_id", oltId);
    if (port) params.set("port", port);
    params.set("days", String(days));
    try {
      if (report === "ports") {
        const pp = new URLSearchParams();
        if (oltId) pp.set("olt_id", oltId);
        if (port) pp.set("port", port);
        await downloadFile(`/reports/ports/export?format=${kind}&${pp.toString()}`, name);
      } else if (report === "optical") {
        params.set("sort_by", sortBy);
        params.set("order", order);
        if (threshold !== 0) params.set("threshold", String(threshold));
        await downloadFile(`/reports/optical/export?format=${kind}&${params.toString()}`, name);
      } else if (report === "fluctuation") {
        params.set("threshold", "3");
        await downloadFile(`/reports/fluctuation/export?format=${kind}&${params.toString()}`, name);
      } else {
        await downloadFile(`/reports/${report}/export?format=${kind}&${params.toString()}`, name);
      }
    } catch {
      /* ignore */
    } finally {
      setExporting(null);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "summary", label: "Summary" },
    { id: "optical", label: "Optical Power" },
    { id: "downtime", label: "Downtime" },
    { id: "ports", label: "Port Utilization" },
    { id: "fluctuation", label: "Power Fluctuation" },
  ];

  if (loading && !summary) return <div className="p-6 text-sm text-slate-400">Loading report…</div>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Reports</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Network summary, weekly optical power, downtime and port utilization — exportable to Excel & PDF.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">OLT</label>
            <select className="input w-44" value={oltId} onChange={(e) => { setOltId(e.target.value); setPort(""); }}>
              <option value="">All OLTs</option>
              {olts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Port</label>
            <select className="input w-44" value={port} onChange={(e) => setPort(e.target.value)}>
              <option value="">All ports</option>
              {portOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {tab === "optical" && (
            <div>
              <label className="label">RX Threshold</label>
              <select className="input w-40" value={threshold} onChange={(e) => setThreshold(Number(e.target.value) as typeof threshold)}>
                <option value={0}>All</option>
                <option value={-25}>&lt;= -25 dBm</option>
                <option value={-28}>&lt;= -28 dBm</option>
                <option value={-30}>&lt;= -30 dBm</option>
                <option value={-32}>&lt;= -32 dBm</option>
              </select>
            </div>
          )}
          {tab !== "ports" && (
            <div>
              <label className="label">Window (days)</label>
              <select className="input w-32" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
          )}
          {tab !== "summary" && (
            <div className="flex gap-2">
              <button
                className="btn btn-secondary"
                disabled={exporting !== null}
                onClick={() => exportFile("xlsx", tab === "ports" ? "ports" : tab, `${tab}.xlsx`)}
              >
                {exporting === `${tab}.xlsx` ? "…" : "Excel"}
              </button>
              <button
                className="btn btn-secondary"
                disabled={exporting !== null}
                onClick={() => exportFile("pdf", tab === "ports" ? "ports" : tab, `${tab}.pdf`)}
              >
                {exporting === `${tab}.pdf` ? "…" : "PDF"}
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800/70">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "summary" && summary && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Total ONUs</div>
              <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{summary.total_onus.toLocaleString()}</div>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Online</div>
              <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-300">{pct(summary.total_active, summary.total_onus)}%</div>
              <div className="text-xs text-slate-500">{summary.total_active} active</div>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Down</div>
              <div className="mt-1 text-2xl font-bold text-rose-600 dark:text-rose-300">{summary.total_down.toLocaleString()}</div>
              <div className="text-xs text-slate-500">inactive + offline</div>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Bound</div>
              <div className="mt-1 text-2xl font-bold text-violet-600 dark:text-violet-300">{summary.total_bound.toLocaleString()}</div>
              <div className="text-xs text-slate-500">matched subscribers</div>
            </div>
            <div className="card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">GPS coverage</div>
              <div className="mt-1 text-2xl font-bold text-cyan-600 dark:text-cyan-300">{summary.gps_coverage_pct}%</div>
              <div className="text-xs text-slate-500">{summary.gps_tagged} tagged</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">ONU State</h3>
              <div className="space-y-2.5">
                {stateSegments.map((s) => {
                  const max = Math.max(...stateSegments.map((x) => x.value), 1);
                  return (
                    <div key={s.label}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-slate-500 dark:text-slate-400">{s.label}</span>
                        <span className="font-semibold text-slate-900 dark:text-white">{s.value}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(s.value / max) * 100}%`, background: s.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card p-5">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Down Reasons <span className="text-slate-400">(current)</span>
              </h3>
              {summary.down_reasons.length > 0 ? (
                <div className="space-y-1.5">
                  {summary.down_reasons.map((d) => (
                    <div key={d.reason} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-slate-800/60">
                      <span className={`badge ${reasonBadge[d.reason] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>{d.reason}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{d.count}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-sm text-slate-400">No down reasons recorded.</div>
              )}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Recent Down Events <span className="text-slate-400">(last {days} days)</span>
            </h3>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-lg font-bold text-rose-600 dark:text-rose-300">{summary.recent_down_events}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">events detected</span>
              {summary.recent_down_events_by_reason.slice(0, 8).map((d) => (
                <span key={d.reason} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {d.reason}: <strong>{d.count}</strong>
                </span>
              ))}
            </div>
          </div>

          <div className="card overflow-x-auto">
            <div className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
              OLT Summary
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                <tr>
                  <th className="th">OLT</th>
                  <th className="th">Ports</th>
                  <th className="th">ONUs</th>
                  <th className="th">Online %</th>
                  <th className="th">Active</th>
                  <th className="th">Down</th>
                  <th className="th">Bound</th>
                  <th className="th">GPS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {summary.olts.map((o) => (
                  <tr key={o.olt_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="td font-medium text-slate-800 dark:text-slate-100">
                      {o.olt_name}
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">{o.pon_type}</span>
                    </td>
                    <td className="td">{o.port_count}</td>
                    <td className="td">{o.total}</td>
                    <td className="td"><StatusBadge status={o.online_pct >= 80 ? "up" : o.online_pct >= 50 ? "wire_down" : "power_off"} /> {o.online_pct}%</td>
                    <td className="td text-emerald-600 dark:text-emerald-300">{o.active}</td>
                    <td className="td text-rose-600 dark:text-rose-300">{o.down}</td>
                    <td className="td text-violet-600 dark:text-violet-300">{o.bound}</td>
                    <td className="td text-cyan-600 dark:text-cyan-300">{o.gps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "optical" && (
        <OpticalTab
          rows={optical?.rows || []}
          loading={loading}
          sortBy={sortBy}
          order={order}
          threshold={threshold}
          onSort={(field) => {
            if (field === sortBy) setOrder(order === "asc" ? "desc" : "asc");
            else {
              setSortBy(field);
              setOrder("asc");
            }
          }}
        />
      )}
      {tab === "downtime" && <DowntimeTab rows={downtime?.rows || []} loading={loading} />}
      {tab === "ports" && <PortsTab rows={ports?.rows || []} loading={loading} />}
      {tab === "fluctuation" && <FluctuationTab rows={fluctuation?.rows || []} loading={loading} />}
    </div>
  );
}

function SortTh({ field, sortBy, order, onSort, children, right }: {
  field: string;
  sortBy: string;
  order: "asc" | "desc";
  onSort: (field: string) => void;
  children: ReactNode;
  right?: boolean;
}) {
  const active = field === sortBy;
  return (
    <th
      className={`th cursor-pointer select-none ${right ? "text-right" : ""}`}
      onClick={() => onSort(field)}
      title="Click to sort"
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span className={`text-[9px] ${active ? "text-brand-600 dark:text-cyan-300" : "text-slate-300 dark:text-slate-600"}`}>
          {active ? (order === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
    </th>
  );
}

function OpticalTab({ rows, loading, sortBy, order, threshold, onSort }: {
  rows: OpticalReportRow[];
  loading: boolean;
  sortBy: string;
  order: "asc" | "desc";
  threshold: number;
  onSort: (field: string) => void;
}) {
  const filtered = useMemo(() => {
    if (threshold === 0) return rows;
    return rows.filter((r) => r.avg_rx != null && r.avg_rx <= threshold);
  }, [rows, threshold]);

  if (loading && rows.length === 0) return <div className="p-6 text-sm text-slate-400">Loading optical report…</div>;
  if (filtered.length === 0) return <div className="card p-6 text-sm text-slate-400">{rows.length === 0 ? "No telemetry in this window." : `No ONUs with RX <= ${threshold} dBm.`}</div>;
  return (
    <div className="card overflow-x-auto">
      <div className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
        Weekly Optical Power <span className="font-normal text-slate-400">(avg / min / max / last RX·TX, dBm)</span>
        {threshold !== 0 && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">RX &lt;= {threshold} dBm · {filtered.length} ONUs</span>}
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <tr>
            <SortTh field="olt" sortBy={sortBy} order={order} onSort={onSort}>OLT</SortTh>
            <SortTh field="port" sortBy={sortBy} order={order} onSort={onSort}>Port</SortTh>
            <SortTh field="subscriber" sortBy={sortBy} order={order} onSort={onSort}>Subscriber</SortTh>
            <SortTh field="name" sortBy={sortBy} order={order} onSort={onSort}>Name</SortTh>
            <SortTh field="samples" sortBy={sortBy} order={order} onSort={onSort} right>Samples</SortTh>
            <SortTh field="avg_rx" sortBy={sortBy} order={order} onSort={onSort} right>Avg RX</SortTh>
            <SortTh field="min_rx" sortBy={sortBy} order={order} onSort={onSort} right>Min RX</SortTh>
            <SortTh field="max_rx" sortBy={sortBy} order={order} onSort={onSort} right>Max RX</SortTh>
            <SortTh field="last_rx" sortBy={sortBy} order={order} onSort={onSort} right>Last RX</SortTh>
            <SortTh field="avg_tx" sortBy={sortBy} order={order} onSort={onSort} right>Avg TX</SortTh>
            <SortTh field="last_tx" sortBy={sortBy} order={order} onSort={onSort} right>Last TX</SortTh>
            <SortTh field="onu_id" sortBy={sortBy} order={order} onSort={onSort}>State</SortTh>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {filtered.map((r) => (
            <tr key={`${r.olt_id}-${r.pon_port}-${r.onu_id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td className="td font-medium text-slate-800 dark:text-slate-100">{r.olt_name}</td>
              <td className="td text-slate-500 dark:text-slate-400">{r.pon_port}</td>
              <td className="td font-mono text-xs">{r.subscriber || "—"}</td>
              <td className="td">{r.name || r.serial || "—"}</td>
              <td className="td text-right">{r.samples}</td>
              <td className="td text-right font-mono">{r.avg_rx ?? "—"}</td>
              <td className="td text-right font-mono text-rose-600 dark:text-rose-300">{r.min_rx ?? "—"}</td>
              <td className="td text-right font-mono text-emerald-600 dark:text-emerald-300">{r.max_rx ?? "—"}</td>
              <td className="td text-right font-mono">{r.last_rx ?? "—"}</td>
              <td className="td text-right font-mono">{r.avg_tx ?? "—"}</td>
              <td className="td text-right font-mono">{r.last_tx ?? "—"}</td>
              <td className={`td ${stateColor[r.current_state] || "text-slate-400"}`}>{r.current_state}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DowntimeTab({ rows, loading }: { rows: DowntimeReportRow[]; loading: boolean }) {
  if (loading && rows.length === 0) return <div className="p-6 text-sm text-slate-400">Loading downtime report…</div>;
  if (rows.length === 0) return <div className="card p-6 text-sm text-slate-400">No down events in this window.</div>;
  return (
    <div className="card overflow-x-auto">
      <div className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
        Downtime by ONU <span className="font-normal text-slate-400">(worst first)</span>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <tr>
            <th className="th">OLT</th>
            <th className="th">Port</th>
            <th className="th">Subscriber</th>
            <th className="th">Name</th>
            <th className="th text-right">Down</th>
            <th className="th text-right">Outage</th>
            <th className="th text-right">Total</th>
            <th className="th text-right">Avg</th>
            <th className="th text-right">Max</th>
            <th className="th">Reason</th>
            <th className="th">Last</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {rows.map((r) => (
            <tr key={`${r.olt_id}-${r.pon_port}-${r.onu_id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td className="td font-medium text-slate-800 dark:text-slate-100">{r.olt_name}</td>
              <td className="td text-slate-500 dark:text-slate-400">{r.pon_port}</td>
              <td className="td font-mono text-xs">{r.subscriber || "—"}</td>
              <td className="td">{r.name || r.serial || "—"}</td>
              <td className="td text-right">{r.down_events}</td>
              <td className="td text-right text-rose-600 dark:text-rose-300">{r.outage_events}</td>
              <td className="td text-right font-semibold text-rose-600 dark:text-rose-300">{fmtH(r.total_seconds)}</td>
              <td className="td text-right">{fmtMin(r.avg_seconds)}</td>
              <td className="td text-right">{fmtMin(r.max_seconds)}</td>
              <td className="td"><span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{r.reason || "unknown"}</span></td>
              <td className="td text-xs text-slate-500">{fmtDt(r.last_event)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PortsTab({ rows, loading }: { rows: PortReportRow[]; loading: boolean }) {
  if (loading && rows.length === 0) return <div className="p-6 text-sm text-slate-400">Loading port utilization…</div>;
  if (rows.length === 0) return <div className="card p-6 text-sm text-slate-400">No ports found.</div>;
  return (
    <div className="card overflow-x-auto">
      <div className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
        PON Port Utilization
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <tr>
            <th className="th">OLT</th>
            <th className="th">Port</th>
            <th className="th">Capacity</th>
            <th className="th">Used</th>
            <th className="th">Remaining</th>
            <th className="th text-right">Utilization %</th>
            <th className="th text-right">Active</th>
            <th className="th text-right">Down</th>
            <th className="th text-right">Bound</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {rows.map((r) => (
            <tr key={`${r.olt_id}-${r.port}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td className="td font-medium text-slate-800 dark:text-slate-100">{r.olt_name}</td>
              <td className="td text-slate-500 dark:text-slate-400">{r.port}</td>
              <td className="td">{r.capacity}</td>
              <td className="td">{r.used}</td>
              <td className="td">{r.remaining}</td>
              <td className="td text-right">
                <span className={`font-semibold ${r.utilization_pct >= 90 ? "text-rose-600 dark:text-rose-300" : r.utilization_pct >= 70 ? "text-amber-600 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-300"}`}>
                  {r.utilization_pct}%
                </span>
              </td>
              <td className="td text-right text-emerald-600 dark:text-emerald-300">{r.active}</td>
              <td className="td text-right text-rose-600 dark:text-rose-300">{r.down}</td>
              <td className="td text-right text-violet-600 dark:text-violet-300">{r.bound}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FluctuationTab({ rows, loading }: { rows: FluctuationReportRow[]; loading: boolean }) {
  if (loading && rows.length === 0) return <div className="p-6 text-sm text-slate-400">Loading fluctuation report…</div>;
  if (rows.length === 0) return <div className="card p-6 text-sm text-slate-400">No ONUs with power fluctuation &gt;= 3 dB in this window.</div>;
  return (
    <div className="card overflow-x-auto">
      <div className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
        Power Fluctuation Report <span className="font-normal text-slate-400">(RX max - min &gt;= 3 dB)</span>
      </div>
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <tr>
            <th className="th">OLT</th>
            <th className="th">Port</th>
            <th className="th">ONU ID</th>
            <th className="th">Subscriber</th>
            <th className="th">Name</th>
            <th className="th">Serial</th>
            <th className="th">State</th>
            <th className="th text-right">Samples</th>
            <th className="th text-right">Avg RX</th>
            <th className="th text-right">Min RX</th>
            <th className="th text-right">Max RX</th>
            <th className="th text-right">Avg TX</th>
            <th className="th text-right">Fluctuation</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {rows.map((r) => (
            <tr key={`${r.olt_id}-${r.pon_port}-${r.onu_id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <td className="td font-medium text-slate-800 dark:text-slate-100">{r.olt_name}</td>
              <td className="td text-slate-500 dark:text-slate-400">{r.pon_port}</td>
              <td className="td">{r.onu_id}</td>
              <td className="td font-mono text-xs">{r.subscriber || "—"}</td>
              <td className="td">{r.name || r.serial || "—"}</td>
              <td className="td font-mono text-xs">{r.serial || "—"}</td>
              <td className={`td ${stateColor[r.current_state] || "text-slate-400"}`}>{r.current_state}</td>
              <td className="td text-right">{r.samples}</td>
              <td className="td text-right font-mono">{r.avg_rx ?? "—"}</td>
              <td className="td text-right font-mono text-rose-600 dark:text-rose-300">{r.min_rx ?? "—"}</td>
              <td className="td text-right font-mono text-emerald-600 dark:text-emerald-300">{r.max_rx ?? "—"}</td>
              <td className="td text-right font-mono">{r.avg_tx ?? "—"}</td>
              <td className="td text-right font-semibold text-amber-600 dark:text-amber-300">{r.fluctuation} dB</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}