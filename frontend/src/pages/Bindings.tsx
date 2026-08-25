import { useEffect, useState } from "react";
import { api } from "../api/client";
import { canOps, Binding, MacEntry, PppActiveEntry } from "../api/types";
import SubscriberLink from "../components/SubscriberLink";
import MacCell from "../components/MacCell";
import { Pagination, usePagination } from "../components/Pagination";
import { useUserRole } from "../lib/role";
import { fmtTime } from "../lib/time";

export default function Bindings() {
  const { role } = useUserRole();
  const opsOk = canOps(role);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const load = async () => {
    setBindings(await api.get<Binding[]>(`/bindings${filter === "bound" ? "?bound=true" : filter === "unbound" ? "?bound=false" : ""}`));
  };

  useEffect(() => {
    load().catch((e) => setNotice({ text: String(e), ok: false }));
  }, [filter]);

  const run = async () => {
    setRunning(true);
    try {
      const summary = await api.post<{ matched: number; unmatched: number; total_macs: number; total_active: number }>("/bindings/run");
      setNotice({ text: `Binding run complete: ${summary.matched} matched, ${summary.unmatched} unmatched (${summary.total_macs} OLT MACs, ${summary.total_active} PPPoE active)`, ok: true });
      await load();
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : "Binding run failed", ok: false });
    } finally {
      setRunning(false);
    }
  };

  const boundCount = bindings.filter((b) => b.bound).length;
  const { page, setPage, totalPages, slice, total, pageSize } = usePagination(bindings);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">MAC Bindings</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            OLT learned MACs matched against the Mikrotik PPPoE active list (caller-id). {boundCount} of {bindings.length} matched.
          </p>
        </div>
        {opsOk && (
          <button className="btn-primary" onClick={run} disabled={running}>
            {running ? "Running..." : "Run binding comparison"}
          </button>
        )}
      </header>

      {notice && (
        <div className={`rounded-md px-4 py-2 text-sm ${notice.ok ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300"}`}>
          {notice.text}
        </div>
      )}

      <div className="card flex items-center gap-3 p-4">
        <div>
          <label className="label">Filter</label>
          <select className="input w-40" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All</option>
            <option value="bound">Bound</option>
            <option value="unbound">Unbound</option>
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} top />
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="th">#</th>
              <th className="th">MAC Address</th>
              <th className="th">OLT</th>
              <th className="th">PON Port</th>
              <th className="th">ONU</th>
              <th className="th">Subscriber ID</th>
              <th className="th">Mikrotik</th>
              <th className="th">IP</th>
              <th className="th">Interface</th>
              <th className="th">Status</th>
              <th className="th">Checked</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {slice.map((b, i) => (
              <tr key={`${b.mac}-${b.olt_id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="td text-xs text-slate-400">{page * pageSize + i + 1}</td>
                <td className="td"><MacCell mac={b.mac} vendor={b.mac_vendor} /></td>
                <td className="td">{b.olt_name}</td>
                <td className="td font-mono text-xs">{b.olt_port || "—"}</td>
                <td className="td">{b.onu_name || <span className="text-slate-400">—</span>}</td>
                <td className="td"><SubscriberLink subscriber={b.subscriber} /></td>
                <td className="td">{b.mikrotik_name || <span className="text-slate-400">—</span>}</td>
                <td className="td font-mono text-xs">{b.mikrotik_ip || "—"}</td>
                <td className="td font-mono text-xs">{b.mikrotik_interface || "—"}</td>
                <td className="td">
                  {b.bound ? (
                    <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">BOUND</span>
                  ) : (
                    <span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">UNBOUND</span>
                  )}
                </td>
                <td className="td text-xs">{fmtTime(b.last_checked)}</td>
              </tr>
            ))}
            {bindings.length === 0 && (
              <tr><td className="td" colSpan={11}>
                No binding data yet. Scan an OLT and a Mikrotik, then run the binding comparison.
              </td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <MacTable />
        <ActiveTable />
      </div>
    </div>
  );
}

function MacTable() {
  const [rows, setRows] = useState<MacEntry[]>([]);
  useEffect(() => {
    api.get<MacEntry[]>("/bindings/olts").then(setRows).catch(() => undefined);
  }, []);
  const { page, setPage, totalPages, slice, total, pageSize } = usePagination(rows);
  return (
    <div className="card overflow-x-auto">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
        OLT learned MACs ({rows.length})
      </div>
      <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} top />
      <table className="w-full">
        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <tr>
            <th className="th">#</th>
            <th className="th">MAC</th>
            <th className="th">OLT</th>
            <th className="th">Port</th>
            <th className="th">VLAN</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {slice.map((r, i) => (
            <tr key={i}>
              <td className="td text-xs text-slate-400">{page * pageSize + i + 1}</td>
              <td className="td"><MacCell mac={r.mac} vendor={r.mac_vendor} /></td>
              <td className="td">{r.olt_name}</td>
              <td className="td font-mono text-xs">{r.port}</td>
              <td className="td">{r.vlan || "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="td" colSpan={5}>No MACs collected from OLTs yet.</td></tr>}
        </tbody>
      </table>
      <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} />
    </div>
  );
}

function ActiveTable() {
  const [rows, setRows] = useState<PppActiveEntry[]>([]);
  useEffect(() => {
    api.get<PppActiveEntry[]>("/bindings/active").then(setRows).catch(() => undefined);
  }, []);
  const { page, setPage, totalPages, slice, total, pageSize } = usePagination(rows);
  return (
    <div className="card overflow-x-auto">
      <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
        Mikrotik PPPoE active ({rows.length})
      </div>
      <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} top />
      <table className="w-full">
        <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
          <tr>
            <th className="th">#</th>
            <th className="th">MAC</th>
            <th className="th">Device</th>
            <th className="th">Subscriber ID</th>
            <th className="th">IP</th>
            <th className="th">Interface</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
          {slice.map((r, i) => (
            <tr key={i}>
              <td className="td text-xs text-slate-400">{page * pageSize + i + 1}</td>
              <td className="td"><MacCell mac={r.mac} vendor={r.mac_vendor} /></td>
              <td className="td">{r.device_name}</td>
              <td className="td"><SubscriberLink subscriber={r.subscriber} /></td>
              <td className="td font-mono text-xs">{r.ip || "—"}</td>
              <td className="td font-mono text-xs">{r.interface || "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="td" colSpan={6}>No PPPoE active entries collected yet.</td></tr>}
        </tbody>
      </table>
      <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} />
    </div>
  );
}