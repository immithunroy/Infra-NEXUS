import { useEffect, useState } from "react";
import { api } from "../api/client";
import { OltWriteLog } from "../api/types";
import { Pagination, usePagination } from "../components/Pagination";
import { fmtTime } from "../lib/time";

interface SchedulerJob {
  id: string;
  name: string;
  desc: string;
  enabled: boolean;
  next_run: string | null;
  last_run: string | null;
  status: string;
  error: string;
}

const statusStyles: Record<string, string> = {
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  running: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  pending: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const statusIcons: Record<string, string> = {
  success: "\u2713",
  failed: "\u2717",
  running: "\u27F3",
  pending: "\u2014",
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  const mon = d.toLocaleString("en-US", { month: "short" });
  return `${mon} ${d.getDate()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function durationSec(start: string, end: string | null): string {
  if (!end) return "\u2014";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function ScheduleJobs() {
  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
  const [logs, setLogs] = useState<OltWriteLog[]>([]);

  useEffect(() => {
    api.get<SchedulerJob[]>("/scheduler/status").then(setJobs).catch(() => undefined);
    api.get<OltWriteLog[]>("/olt-write-logs").then(setLogs).catch(() => undefined);
    const iv = setInterval(() => {
      api.get<SchedulerJob[]>("/scheduler/status").then(setJobs).catch(() => undefined);
    }, 15000);
    return () => clearInterval(iv);
  }, []);

  const { page, setPage, totalPages, slice, total, pageSize } = usePagination(logs);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Schedule Jobs</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Background tasks and their execution history</p>
      </header>

      {/* Job status table */}
      <div className="card overflow-x-auto">
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="th">Job</th>
              <th className="th">Schedule</th>
              <th className="th">Last Run</th>
              <th className="th">Status</th>
              <th className="th">Next Run</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="td">
                  <div className="font-medium text-slate-900 dark:text-white">{job.name}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{job.desc}</div>
                </td>
                <td className="td text-xs text-slate-600 dark:text-slate-300">
                  {!job.enabled ? (
                    <span className="text-slate-400">Disabled</span>
                  ) : job.id.includes("vendor") || job.id.includes("write_all") ? (
                    "Daily"
                  ) : (
                    "Every 5 min"
                  )}
                </td>
                <td className="td whitespace-nowrap text-xs">{fmtDateTime(job.last_run)}</td>
                <td className="td">
                  <span className={`badge ${statusStyles[job.status] || statusStyles.pending}`}>
                    {statusIcons[job.status] || "\u2014"}{" "}
                    {job.status === "success" ? "Successful" : job.status === "failed" ? "Failed" : job.status === "running" ? "Running" : "Pending"}
                  </span>
                </td>
                <td className="td whitespace-nowrap text-xs">
                  {!job.enabled ? (
                    <span className="text-slate-400">Paused</span>
                  ) : job.next_run ? (
                    fmtDateTime(job.next_run)
                  ) : (
                    "\u2014"
                  )}
                </td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td className="td text-slate-500" colSpan={5}>Loading scheduler status...</td></tr>
            )}
          </tbody>
        </table>
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
                    <span className={`badge ${statusStyles[l.status] || "bg-slate-100 text-slate-600"}`}>{l.status}</span>
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
