import { useEffect, useState } from "react";
import { api } from "../api/client";
import { BgpSession, BgpRoute, MikrotikDevice } from "../api/types";

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    established: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    active: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    connect: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    idle: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  return <span className={`badge ${map[state] || map.idle}`}>{state}</span>;
}

export default function Routing() {
  const [mikrotiks, setMikrotiks] = useState<MikrotikDevice[]>([]);
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [sessions, setSessions] = useState<BgpSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<BgpRoute[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);

  useEffect(() => {
    api.get<MikrotikDevice[]>("/devices/mikrotiks").then(setMikrotiks).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (selectedId === "") { setSessions([]); return; }
    setLoading(true);
    api.get<BgpSession[]>(`/devices/mikrotiks/${selectedId}/bgp`)
      .then(setSessions)
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const toggleExpand = async (session: BgpSession) => {
    if (expandedId === session.id) { setExpandedId(null); setRoutes([]); return; }
    setExpandedId(session.id);
    setRoutesLoading(true);
    try {
      const data = await api.get<BgpRoute[]>(`/devices/mikrotiks/${session.device_id}/bgp/${session.id}/routes`);
      setRoutes(data);
    } catch { setRoutes([]); }
    setRoutesLoading(false);
  };

  const established = sessions.filter((s) => s.state === "established").length;
  const active = sessions.filter((s) => s.state === "active").length;
  const totalPrefixes = sessions.reduce((sum, s) => sum + s.prefix_count, 0);
  const totalAdvertised = sessions.reduce((sum, s) => sum + s.advertised_count, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Routing</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">BGP sessions, routes and prefix metrics</p>
      </header>

      {/* Device selector */}
      <div className="flex items-center gap-3">
        <label className="label mb-0">Mikrotik Server</label>
        <select className="input w-72" value={selectedId} onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Select device</option>
          {mikrotiks.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.ip})</option>)}
        </select>
      </div>

      {/* Summary cards */}
      {selectedId !== "" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-4">
            <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Established</div>
            <div className="mt-1 text-3xl font-bold text-emerald-600 dark:text-emerald-400">{established}</div>
            <div className="mt-1 text-xs text-slate-400">of {sessions.length} total sessions</div>
          </div>
          <div className="card p-4">
            <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Active / Connecting</div>
            <div className="mt-1 text-3xl font-bold text-amber-600 dark:text-amber-400">{active}</div>
            <div className="mt-1 text-xs text-slate-400">sessions negotiating</div>
          </div>
          <div className="card p-4">
            <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Received Prefixes</div>
            <div className="mt-1 text-3xl font-bold text-blue-600 dark:text-blue-400">{totalPrefixes.toLocaleString()}</div>
            <div className="mt-1 text-xs text-slate-400">routes from peers</div>
          </div>
          <div className="card p-4">
            <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Advertised Prefixes</div>
            <div className="mt-1 text-3xl font-bold text-purple-600 dark:text-purple-400">{totalAdvertised.toLocaleString()}</div>
            <div className="mt-1 text-xs text-slate-400">routes to peers</div>
          </div>
        </div>
      )}

      {/* BGP Sessions table */}
      {selectedId !== "" && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="th">State</th>
                <th className="th">Remote IP</th>
                <th className="th">Local IP</th>
                <th className="th">Remote AS</th>
                <th className="th">Uptime</th>
                <th className="th text-right">Received</th>
                <th className="th text-right">Advertised</th>
                <th className="th w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {loading && (
                <tr><td className="td text-center text-slate-400" colSpan={8}>Loading BGP sessions...</td></tr>
              )}
              {!loading && sessions.length === 0 && (
                <tr><td className="td text-center text-slate-400" colSpan={8}>No BGP sessions found. Data is collected during Mikrotik scans.</td></tr>
              )}
              {sessions.map((s) => (
                <>
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => toggleExpand(s)}>
                    <td className="td"><StateBadge state={s.state} /></td>
                    <td className="td font-mono text-sm font-medium">{s.remote_ip}</td>
                    <td className="td font-mono text-sm text-slate-500 dark:text-slate-400">{s.local_ip}</td>
                    <td className="td font-mono text-sm">{s.remote_as}</td>
                    <td className="td text-sm">{s.uptime || "—"}</td>
                    <td className="td text-right font-mono text-sm">{s.prefix_count.toLocaleString()}</td>
                    <td className="td text-right font-mono text-sm">{s.advertised_count.toLocaleString()}</td>
                    <td className="td w-10 text-center">
                      <svg className={`h-4 w-4 text-slate-400 transition-transform ${expandedId === s.id ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    </td>
                  </tr>
                  {expandedId === s.id && (
                    <tr key={`${s.id}-routes`}>
                      <td colSpan={8} className="bg-slate-50/50 px-6 py-4 dark:bg-slate-800/30">
                        {routesLoading ? (
                          <div className="text-sm text-slate-400">Loading routes...</div>
                        ) : routes.length === 0 ? (
                          <div className="text-sm text-slate-400">No routes received from this peer.</div>
                        ) : (
                          <div>
                            <div className="mb-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                              Received Routes ({routes.length})
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-slate-500 dark:text-slate-400">
                                    <th className="pb-1 pr-4 font-medium">Prefix</th>
                                    <th className="pb-1 pr-4 font-medium">Nexthop</th>
                                    <th className="pb-1 pr-4 font-medium">Metric</th>
                                    <th className="pb-1 font-medium">Community</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200/50 dark:divide-slate-700/30">
                                  {routes.map((r) => (
                                    <tr key={r.id}>
                                      <td className="py-1 pr-4 font-mono">{r.prefix}</td>
                                      <td className="py-1 pr-4 font-mono text-slate-500">{r.nexthop}</td>
                                      <td className="py-1 pr-4">{r.metric}</td>
                                      <td className="py-1 font-mono text-slate-500">{r.community || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId === "" && (
        <div className="card p-8 text-center text-slate-400">
          Select a Mikrotik server to view BGP sessions and routes.
        </div>
      )}
    </div>
  );
}
