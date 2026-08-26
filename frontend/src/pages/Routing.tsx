import { Fragment, useEffect, useState, useCallback } from "react";
import { api } from "../api/client";
import { BgpSession, BgpRoute, BgpPrefixSnapshot, MikrotikDevice } from "../api/types";

function StateBadge({ state }: { state: string }) {
  const map: Record<string, string> = {
    established: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    active: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    connect: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    idle: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  return <span className={`badge ${map[state] || map.idle}`}>{state}</span>;
}

function FamilyBadge({ family }: { family: string }) {
  const map: Record<string, string> = {
    "ipv4": "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    "ipv6": "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  };
  const label = family?.replace("ipv4-unicast", "IPv4").replace("ipv6-unicast", "IPv6").replace("ipv4", "IPv4").replace("ipv6", "IPv6") || "IPv4";
  const key = label.toLowerCase().includes("ipv6") ? "ipv6" : "ipv4";
  return <span className={`badge text-[10px] ${map[key] || map.ipv4}`}>{label}</span>;
}

function MiniSparkLine({ data, color, height = 32 }: { data: number[]; color?: string; height?: number }) {
  if (data.length < 2) return <span className="text-[10px] text-slate-400">—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 120;
  const h = height;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block">
      <polyline points={points} fill="none" stroke={color || "#3b82f6"} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={(data.length - 1) / (data.length - 1) * w} cy={h - ((data[data.length - 1] - min) / range) * (h - 4) - 2} r="2" fill={color || "#3b82f6"} />
    </svg>
  );
}

function TotalPrefixGraph({ snapshots, sessions }: { snapshots: BgpPrefixSnapshot[]; sessions: BgpSession[] }) {
  if (!snapshots.length) return null;

  // Aggregate snapshots by recorded_at
  const byTime = new Map<string, { recorded: number; advertised: number }>();
  for (const s of snapshots) {
    const key = s.recorded_at;
    const existing = byTime.get(key) || { recorded: 0, advertised: 0 };
    existing.recorded += s.prefix_count;
    existing.advertised += s.advertised_count;
    byTime.set(key, existing);
  }

  const sorted = Array.from(byTime.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const recorded = sorted.map(([, v]) => v.recorded);
  const advertised = sorted.map(([, v]) => v.advertised);

  const totalRecorded = sessions.reduce((s, v) => s + v.prefix_count, 0);
  const totalAdvertised = sessions.reduce((s, v) => s + v.advertised_count, 0);

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-medium uppercase text-slate-500 dark:text-slate-400">Total Prefix Trend (7 days)</div>
          <div className="mt-1 flex gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="text-blue-600 dark:text-blue-400">Received: {totalRecorded.toLocaleString()}</span>
            <span className="text-purple-600 dark:text-purple-400">Advertised: {totalAdvertised.toLocaleString()}</span>
          </div>
        </div>
        <div className="flex gap-1">
          {recorded.length > 0 && (
            <MiniSparkLine data={recorded} color="#3b82f6" height={28} />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase text-blue-600 dark:text-blue-400">Received Prefixes</div>
          <MiniSparkLine data={recorded} color="#3b82f6" height={48} />
        </div>
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase text-purple-600 dark:text-purple-400">Advertised Prefixes</div>
          <MiniSparkLine data={advertised} color="#8b5cf6" height={48} />
        </div>
      </div>
    </div>
  );
}

export default function Routing() {
  const [mikrotiks, setMikrotiks] = useState<MikrotikDevice[]>([]);
  const [selectedId, setSelectedId] = useState<number | "">("");
  const [sessions, setSessions] = useState<BgpSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<BgpRoute[]>([]);
  const [routesLoading, setRoutesLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<BgpPrefixSnapshot[]>([]);
  const [sessionSnapshots, setSessionSnapshots] = useState<Map<number, BgpPrefixSnapshot[]>>(new Map());

  useEffect(() => {
    api.get<MikrotikDevice[]>("/devices/mikrotiks").then(setMikrotiks).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (selectedId === "") { setSessions([]); setSnapshots([]); setSessionSnapshots(new Map()); return; }
    setLoading(true);
    api.get<BgpSession[]>(`/devices/mikrotiks/${selectedId}/bgp`)
      .then((data) => {
        setSessions(data);
        // Fetch snapshots for all sessions in parallel
        data.forEach((s) => {
          api.get<BgpPrefixSnapshot[]>(`/devices/mikrotiks/${selectedId}/bgp/${s.id}/snapshots`, { hours: 168 })
            .then((snap) => {
              setSessionSnapshots((prev) => new Map(prev).set(s.id, snap));
            })
            .catch(() => undefined);
        });
        // Aggregate all snapshots for total graph
        const all: BgpPrefixSnapshot[] = [];
        Promise.all(data.map((s) =>
          api.get<BgpPrefixSnapshot[]>(`/devices/mikrotiks/${selectedId}/bgp/${s.id}/snapshots`, { hours: 168 }).catch(() => [])
        )).then((results) => {
          results.forEach((r) => all.push(...r));
          setSnapshots(all);
        });
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [selectedId]);

  const toggleExpand = useCallback(async (session: BgpSession) => {
    if (expandedId === session.id) { setExpandedId(null); setRoutes([]); return; }
    setExpandedId(session.id);
    setRoutesLoading(true);
    try {
      const data = await api.get<BgpRoute[]>(`/devices/mikrotiks/${session.device_id}/bgp/${session.id}/routes`);
      setRoutes(data);
    } catch { setRoutes([]); }
    setRoutesLoading(false);
  }, [expandedId]);

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

      {/* Total prefix trend graph */}
      {selectedId !== "" && snapshots.length > 0 && (
        <TotalPrefixGraph snapshots={snapshots} sessions={sessions} />
      )}

      {/* BGP Sessions table */}
      {selectedId !== "" && (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="th">State</th>
                <th className="th">Peer Name</th>
                <th className="th">Remote IP</th>
                <th className="th">Family</th>
                <th className="th">Local IP</th>
                <th className="th">Remote AS</th>
                <th className="th">Local AS</th>
                <th className="th">Uptime</th>
                <th className="th text-right">Received</th>
                <th className="th text-right">Advertised</th>
                <th className="th">Prefix Trend</th>
                <th className="th w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {loading && (
                <tr><td className="td text-center text-slate-400" colSpan={12}>Loading BGP sessions...</td></tr>
              )}
              {!loading && sessions.length === 0 && (
                <tr><td className="td text-center text-slate-400" colSpan={12}>No BGP sessions found. Data is collected during Mikrotik scans.</td></tr>
              )}
              {sessions.map((s) => {
                const snapData = sessionSnapshots.get(s.id) || [];
                const prefixCounts = snapData.map((sn) => sn.prefix_count);
                return (
                  <Fragment key={s.id}>
                    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => toggleExpand(s)}>
                      <td className="td"><StateBadge state={s.state} /></td>
                      <td className="td text-sm font-medium">{s.name || "—"}</td>
                      <td className="td font-mono text-sm font-medium">{s.remote_ip}</td>
                      <td className="td"><FamilyBadge family={s.address_family} /></td>
                      <td className="td font-mono text-sm text-slate-500 dark:text-slate-400">{s.local_ip}</td>
                      <td className="td font-mono text-sm">{s.remote_as}</td>
                      <td className="td font-mono text-sm text-slate-500 dark:text-slate-400">{s.local_as || "—"}</td>
                      <td className="td text-sm">{s.uptime || "—"}</td>
                      <td className="td text-right font-mono text-sm">{s.prefix_count.toLocaleString()}</td>
                      <td className="td text-right font-mono text-sm">{s.advertised_count.toLocaleString()}</td>
                      <td className="td">
                        <MiniSparkLine data={prefixCounts} color="#3b82f6" height={24} />
                      </td>
                      <td className="td w-10 text-center">
                        <svg className={`h-4 w-4 text-slate-400 transition-transform ${expandedId === s.id ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </td>
                    </tr>
                    {expandedId === s.id && (
                      <tr key={`${s.id}-routes`}>
                        <td colSpan={12} className="bg-slate-50/50 px-6 py-4 dark:bg-slate-800/30">
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
                  </Fragment>
                );
              })}
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
