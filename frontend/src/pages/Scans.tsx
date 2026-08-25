import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ScanLog } from "../api/types";
import { Pagination, usePagination } from "../components/Pagination";
import { fmtTime } from "../lib/time";

export default function Scans() {
  const [logs, setLogs] = useState<ScanLog[]>([]);

  useEffect(() => {
    api.get<ScanLog[]>("/scans").then(setLogs).catch(() => undefined);
  }, []);

  const { page, setPage, totalPages, slice, total, pageSize } = usePagination(logs);

  const statusColor: Record<string, string> = {
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };

  const typeLabel: Record<string, string> = {
    olt: "OLT",
    mikrotik: "Mikrotik",
    bind: "Binding",
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Scan Logs</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">History of OLT, Mikrotik and binding runs</p>
      </header>

      <div className="card overflow-x-auto">
        <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} top />
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="th">#</th>
              <th className="th">Started</th>
              <th className="th">Type</th>
              <th className="th">Device</th>
              <th className="th">Status</th>
              <th className="th">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {slice.map((l, i) => (
              <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="td text-xs text-slate-400">{page * pageSize + i + 1}</td>
                <td className="td whitespace-nowrap text-xs">{fmtTime(l.started_at)}</td>
                <td className="td">{typeLabel[l.scan_type] || l.scan_type}</td>
                <td className="td font-medium">{l.device_name}</td>
                <td className="td">
                  <span className={`badge ${statusColor[l.status] || "bg-slate-100 text-slate-600"}`}>{l.status}</span>
                </td>
                <td className="td max-w-md truncate text-xs text-slate-500 dark:text-slate-400" title={l.message}>{l.message}</td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr><td className="td" colSpan={6}>No scans have run yet.</td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} />
      </div>
    </div>
  );
}