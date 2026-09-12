import { useEffect, useState } from "react";
import { api } from "../api/client";
import { TicketAnalytics } from "../api/types";
import { KpiCard } from "../components/tickets/KpiCard";
import { BarChart } from "../components/tickets/Charts";

export default function TicketDashboard() {
  const [data, setData] = useState<TicketAnalytics | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .get<TicketAnalytics>(`/tickets/analytics/dashboard?days=${days}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-slate-400">Loading analytics…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-sm text-slate-400">Failed to load analytics</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Ticket Analytics</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Overview of the last {days} days</p>
        </div>
        <select className="input w-36" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </header>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total" value={data.total} icon="📋" color="brand" />
        <KpiCard label="Open" value={data.open_count} icon="🔴" color="rose" />
        <KpiCard label="In Progress" value={data.in_progress_count} icon="🟡" color="amber" />
        <KpiCard label="Resolved" value={data.resolved_count} icon="🟢" color="emerald" />
        <KpiCard
          label="SLA Breaches"
          value={data.sla_breaches}
          icon="⏰"
          color={data.sla_breaches > 0 ? "rose" : "emerald"}
        />
        <KpiCard
          label="Reopened"
          value={data.reopened_count}
          icon="🔄"
          color={data.reopened_count > 0 ? "amber" : "emerald"}
        />
      </div>

      {/* Response / Resolution / Satisfaction */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Avg Response Time"
          value={data.avg_response_hours != null ? `${data.avg_response_hours.toFixed(1)}h` : "—"}
          icon="⏱️"
          color="cyan"
        />
        <KpiCard
          label="Avg Resolution Time"
          value={data.avg_resolution_hours != null ? `${data.avg_resolution_hours.toFixed(1)}h` : "—"}
          icon="✅"
          color="emerald"
        />
        <KpiCard
          label="Avg Satisfaction"
          value={data.avg_satisfaction != null ? `${data.avg_satisfaction.toFixed(1)} / 5` : "—"}
          icon="⭐"
          color="amber"
          sub={data.avg_satisfaction != null ? `${"★".repeat(Math.round(data.avg_satisfaction))}${"☆".repeat(5 - Math.round(data.avg_satisfaction))}` : undefined}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BarChart data={data.by_priority} title="By Priority" />
        <BarChart data={data.by_category} title="By Category" />
        <BarChart data={data.by_department} title="By Department" />
        <BarChart data={data.by_assignee} title="By Assignee" maxBars={10} />
      </div>

      {/* Volume Over Time */}
      {data.volume_over_time.length > 0 && (
        <div className="card p-4">
          <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Ticket Volume Over Time</p>
          <div className="flex items-end gap-1" style={{ height: 100 }}>
            {data.volume_over_time.map((d) => {
              const max = Math.max(...data.volume_over_time.map((v) => v.count), 1);
              return (
                <div key={d.date} className="group relative flex-1">
                  <div
                    className="mx-auto w-full rounded-t bg-brand-500/80 dark:bg-brand-400/60"
                    style={{ height: `${(d.count / max) * 80}px`, minHeight: 2 }}
                    title={`${d.date}: ${d.count}`}
                  />
                  <div className="mt-1 hidden text-center text-[9px] text-slate-400 group-hover:block">
                    {d.date.slice(5)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-slate-400">
            <span>{data.volume_over_time[0]?.date}</span>
            <span>{data.volume_over_time[data.volume_over_time.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
}
