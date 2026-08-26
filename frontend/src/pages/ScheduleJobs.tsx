import { useEffect, useState } from "react";
import { api } from "../api/client";
import { OltWriteLog } from "../api/types";
import { Pagination, usePagination } from "../components/Pagination";
import { fmtTime } from "../lib/time";

const JOBS = [
  { name: "OLT Scan", schedule: "Every 5 min", desc: "Scan all enabled OLTs for MAC addresses" },
  { name: "Mikrotik Scan", schedule: "Every 5 min", desc: "Scan all enabled Mikrotik devices" },
  { name: "MAC Binding", schedule: "Every 5 min", desc: "Match collected MACs against subscriber database" },
  { name: "OLT Telemetry", schedule: "Every 5 min", desc: "Collect optical power readings via SNMP" },
  { name: "ACS Poll", schedule: "Every 5 min", desc: "Queue TR-069 monitoring jobs for online CPEs" },
  { name: "OLT Config Save", schedule: "Daily 01:00 AM", desc: "Persist running config to flash on all OLTs" },
  { name: "MAC Vendor Sync", schedule: "Daily 04:00 AM", desc: "Update MAC vendor OUI database from external API" },
];

function durationSec(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function ScheduleJobs() {
  const [logs, setLogs] = useState<OltWriteLog[]>([]);

  useEffect(() => {
    api.get<OltWriteLog[]>("/olt-write-logs").then(setLogs).catch(() => undefined);
  }, []);

  const { page, setPage, totalPages, slice, total, pageSize } = usePagination(logs);

  const statusColor: Record<string, string> = {
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Schedule Jobs</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Background tasks and their execution history</p>
      </header>

      {/* Job overview cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {JOBS.map((job) => (
          <div key={job.name} className="card p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-slate-900 dark:text-white">{job.name}</h3>
              <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {job.schedule}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{job.desc}</p>
          </div>
        ))}
      </div>

      {/* OLT Config Save log table */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">OLT Config Save Log</h2>
        <div className="card overflow-x-auto">
          <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} top />
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="th">#</th>
                <th className="th">Time</th>
                <th className="th">OLT</th>
                <th className="th">Status</th>
                <th className="th">Duration</th>
                <th className="th">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {slice.map((l, i) => (
                <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="td text-xs text-slate-400">{page * pageSize + i + 1}</td>
                  <td className="td whitespace-nowrap text-xs">{fmtTime(l.started_at)}</td>
                  <td className="td font-medium">{l.olt_name}</td>
                  <td className="td">
                    <span className={`badge ${statusColor[l.status] || "bg-slate-100 text-slate-600"}`}>{l.status}</span>
                  </td>
                  <td className="td text-xs text-slate-500 dark:text-slate-400">{durationSec(l.started_at, l.finished_at)}</td>
                  <td className="td max-w-md truncate text-xs text-slate-500 dark:text-slate-400" title={l.message}>{l.message}</td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr><td className="td" colSpan={6}>No config save logs yet. First run at 01:00 AM.</td></tr>
              )}
            </tbody>
          </table>
          <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} />
        </div>
      </div>
    </div>
  );
}
