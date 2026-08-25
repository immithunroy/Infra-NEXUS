import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { SubscriberSummary } from "../api/types";
import SubscriberLink from "../components/SubscriberLink";
import MacCell from "../components/MacCell";
import StatusBadge from "../components/StatusBadge";
import { RemoteAccessButton } from "../components/RemoteAccess";
import { Pagination, usePagination } from "../components/Pagination";

export default function Subscribers() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<SubscriberSummary[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const { page, setPage, totalPages, slice, total, pageSize } = usePagination(rows);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<SubscriberSummary[]>(`/subscribers?q=${encodeURIComponent(q)}&limit=1000`)
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q]);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Subscribers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            One row per PPPoE subscriber bound to an ONU. Click to open the profile with optical history and MAC changes.
          </p>
        </div>
        <span className="badge bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">{rows.length} subscribers</span>
      </header>

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="flex-1">
          <label className="label">Search (ID, name, port, MAC)</label>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 22031701" />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} top />
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="th">#</th>
              <th className="th">Subscriber ID</th>
              <th className="th">OLT / Port</th>
              <th className="th">Name</th>
              <th className="th">Current MAC</th>
              <th className="th">State</th>
              <th className="th">Remote/ACS</th>
              <th className="th">RX / TX</th>
              <th className="th">MAC changes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {slice.map((s, i) => (
              <tr
                key={s.onu_id}
                onClick={() => navigate(`/subscribers/${encodeURIComponent(s.subscriber)}`)}
                className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <td className="td text-xs text-slate-400">{page * pageSize + i + 1}</td>
                <td className="td"><SubscriberLink subscriber={s.subscriber} /></td>
                <td className="td">
                  <div>{s.olt_name}</div>
                  <div className="font-mono text-xs text-slate-500">{s.pon_port || "—"}</div>
                </td>
                <td className="td">{s.onu_name || <span className="text-slate-400">—</span>}</td>
                <td className="td"><MacCell mac={s.last_mac} vendor={s.mac_vendor} /></td>
                <td className="td">
                  <StatusBadge status={s.status} />
                </td>
                <td className="td">
                  <div className="flex flex-col items-start gap-1" onClick={(e) => e.stopPropagation()}>
                    <RemoteAccessButton ip={s.mikrotik_ip} label="remote" />
                    <button
                      type="button"
                      title={s.acs_device_id ? "Open router in ACS" : "No ACS (TR-069) router registered — open ACS list"}
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                        s.acs_device_id
                          ? "bg-brand-100 text-brand-700 hover:bg-brand-200 dark:bg-brand-900/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                      }`}
                      onClick={() => navigate(s.acs_device_id ? `/acs?device=${s.acs_device_id}` : "/acs")}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="4" width="20" height="12" rx="2" />
                        <path d="M8 20h8m-4-4v4" />
                      </svg>
                      acs
                    </button>
                  </div>
                </td>
                <td className="td font-mono text-xs">
                  {s.rx_power != null || s.tx_power != null ? (
                    <>
                      <div className={s.rx_power != null && s.rx_power < -25 ? "text-red-600" : ""}>RX {s.rx_power ?? "—"} dBm</div>
                      <div>TX {s.tx_power ?? "—"} dBm</div>
                    </>
                  ) : "—"}
                </td>
                <td className="td">
                  {s.mac_change_count > 0 ? (
                    <span className={`badge ${s.mac_change_count >= 3 ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
                      {s.mac_change_count}×
                    </span>
                  ) : (
                    <span className="text-slate-400">0</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="td" colSpan={9}>
                  {loading ? "Loading…" : "No subscribers yet. Run a Mikrotik scan and a binding pass — subscribers appear once their MAC is matched."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} />
      </div>
    </div>
  );
}