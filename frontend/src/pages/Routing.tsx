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
  return <span className={`badge text-[10px] ${map[state] || map.idle}`}>{state}</span>;
}

function FamilyBadge({ family }: { family: string }) {
  const isV6 = family?.toLowerCase().includes("ipv6");
  return (
    <span className={`badge text-[10px] ${isV6 ? "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" : "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"}`}>
      {isV6 ? "IPv6" : "IPv4"}
    </span>
  );
}

function SparkLine({ data, color = "#3b82f6", height = 40, width = 200 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (data.length < 2) {
    return <div className="text-[10px] text-slate-400 dark:text-slate-500" style={{ height, width }}>No data</div>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padY = 4;
  const h = height - padY * 2;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padY + h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");
  const areaPoints = `0,${padY + h} ${points} ${width},${padY + h}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="inline-block">
      <defs>
        <linearGradient id={`grad-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#grad-${color.replace("#", "")})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={width} cy={padY + h - ((data[data.length - 1] - min) / range) * h} r="2.5" fill={color} />
    </svg>
  );
}

function TotalPrefixGraph({ snapshots, sessions }: { snapshots: BgpPrefixSnapshot[]; sessions: BgpSession[] }) {
  if (!snapshots.length && !sessions.length) return null;
  const totalRecorded = sessions.reduce((s, v) => s + v.prefix_count, 0);
  const totalAdvertised = sessions.reduce((s, v) => s + v.advertised_count, 0);

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

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Prefix Trend</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">7-day received vs advertised prefixes</p>
        </div>
        <div className="flex gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-slate-600 dark:text-slate-300">Received: <b>{totalRecorded.toLocaleString()}</b></span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
            <span className="text-slate-600 dark:text-slate-300">Advertised: <b>{totalAdvertised.toLocaleString()}</b></span>
          </div>
        </div>
      </div>
      {recorded.length > 1 ? (
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase text-blue-600 dark:text-blue-400">Received Prefixes</div>
            <SparkLine data={recorded} color="#3b82f6" height={56} width={360} />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase text-purple-600 dark:text-purple-400">Advertised Prefixes</div>
            <SparkLine data={advertised} color="#8b5cf6" height={56} width={360} />
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-400">Collecting data... graphs appear after 2+ scans.</div>
      )}
    </div>
  );
}

function SessionCard({ session, snapshots, onExpand, isExpanded, routes, routesLoading }: {
  session: BgpSession;
  snapshots: BgpPrefixSnapshot[];
  onExpand: () => void;
  isExpanded: boolean;
  routes: BgpRoute[];
  routesLoading: boolean;
}) {
  const prefixCounts = snapshots.map((sn) => sn.prefix_count);
  const advertisedCounts = snapshots.map((sn) => sn.advertised_count);
  return (
    <div className="card overflow-hidden">
      <div className="p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition" onClick={onExpand}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{session.name || session.remote_ip}</span>
              <StateBadge state={session.state} />
              <FamilyBadge family={session.address_family} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs">
              <div><span className="text-slate-400">Remote:</span> <span className="font-mono font-medium text-slate-700 dark:text-slate-200">{session.remote_ip}</span></div>
              <div><span className="text-slate-400">Local:</span> <span className="font-mono text-slate-500 dark:text-slate-400">{session.local_ip}</span></div>
              <div><span className="text-slate-400">Remote AS:</span> <span className="font-mono font-medium text-slate-700 dark:text-slate-200">{session.remote_as}</span></div>
              <div><span className="text-slate-400">Local AS:</span> <span className="font-mono text-slate-500 dark:text-slate-400">{session.local_as || "—"}</span></div>
            </div>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <div className="text-lg font-bold font-mono text-blue-600 dark:text-blue-400">{session.prefix_count.toLocaleString()}</div>
              <div className="text-[10px] text-slate-400">received</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold font-mono text-purple-600 dark:text-purple-400">{session.advertised_count.toLocaleString()}</div>
              <div className="text-[10px] text-slate-400">advertised</div>
            </div>
            <div className="text-right w-20">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300">{session.uptime || "—"}</div>
              <div className="text-[10px] text-slate-400">uptime</div>
            </div>
            <div className="w-48">
              {prefixCounts.length > 1 ? (
                <SparkLine data={prefixCounts} color="#3b82f6" height={32} width={192} />
              ) : (
                <div className="text-[10px] text-slate-400 h-8 flex items-center">collecting...</div>
              )}
            </div>
            <svg className={`h-4 w-4 text-slate-400 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </div>
      </div>
      {isExpanded && (
        <div className="border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/30 px-4 py-3">
          {routesLoading ? (
            <div className="text-xs text-slate-400 py-2">Loading routes...</div>
          ) : routes.length === 0 ? (
            <div className="text-xs text-slate-400 py-2">No routes received from this peer.</div>
          ) : (
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                Received Routes ({routes.length})
              </div>
              <div className="max-h-48 overflow-y-auto">
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
        </div>
      )}
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
  const [sessionSnapshots, setSessionSnapshots] = useState<Map<number, BgpPrefixSnapshot[]>>(new Map());
  const [allSnapshots, setAllSnapshots] = useState<BgpPrefixSnapshot[]>([]);

  useEffect(() => {
    api.get<MikrotikDevice[]>("/devices/mikrotiks").then(setMikrotiks).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (selectedId === "") { setSessions([]); setSessionSnapshots(new Map()); setAllSnapshots([]); return; }
    setLoading(true);
    api.get<BgpSession[]>(`/devices/mikrotiks/${selectedId}/bgp`)
      .then((data) => {
        setSessions(data);
        const all: BgpPrefixSnapshot[] = [];
        Promise.all(data.map((s) =>
          api.get<BgpPrefixSnapshot[]>(`/devices/mikrotiks/${selectedId}/bgp/${s.id}/snapshots`, { hours: 168 }).catch(() => [])
        )).then((results) => {
          results.forEach((snap, i) => {
            setSessionSnapshots((prev) => new Map(prev).set(data[i].id, snap));
            all.push(...snap);
          });
          setAllSnapshots(all);
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
  const active = sessions.filter((s) => s.state !== "established" && s.state !== "idle").length;
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
            <div className="mt-1 text-xs text-slate-400">of {sessions.length} sessions</div>
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

      {/* Total prefix trend */}
      {selectedId !== "" && <TotalPrefixGraph snapshots={allSnapshots} sessions={sessions} />}

      {/* Session cards */}
      {selectedId !== "" && (
        <div className="space-y-3">
          {loading && (
            <div className="card p-8 text-center text-slate-400">Loading BGP sessions...</div>
          )}
          {!loading && sessions.length === 0 && (
            <div className="card p-8 text-center text-slate-400">No BGP sessions found. Data is collected during Mikrotik scans.</div>
          )}
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              snapshots={sessionSnapshots.get(s.id) || []}
              onExpand={() => toggleExpand(s)}
              isExpanded={expandedId === s.id}
              routes={expandedId === s.id ? routes : []}
              routesLoading={expandedId === s.id && routesLoading}
            />
          ))}
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
