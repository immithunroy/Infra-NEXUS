import { Fragment, useEffect, useState, useMemo, useCallback } from "react";
import { api } from "../api/client";
import { BgpSession, BgpPrefixSnapshot, MikrotikDevice } from "../api/types";

const TIME_RANGES = [
  { label: "1D", hours: 24 },
  { label: "1W", hours: 168 },
  { label: "1M", hours: 720 },
  { label: "3M", hours: 2160 },
] as const;

const OUR_ASN = 149035;

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

/* ─────────── Chart ─────────── */

function PrefixChart({ data, labels, color, height = 120, title, currentValue }: {
  data: number[]; labels: string[]; color: string; height?: number; title: string; currentValue: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length < 2) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{title}</span>
          <span className="font-mono text-lg font-bold" style={{ color }}>{currentValue.toLocaleString()}</span>
        </div>
        <div className="text-xs text-slate-400" style={{ height }}>Collecting data...</div>
      </div>
    );
  }

  const min = Math.min(...data) * 0.95;
  const max = Math.max(...data) * 1.05;
  const range = max - min || 1;
  const w = 400;
  const padY = 8;
  const h = height - padY * 2;
  const padX = 4;

  const points = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * (w - padX * 2);
    const y = padY + h - ((v - min) / range) * h;
    return { x, y };
  });
  const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPoints = `${padX},${padY + h} ${linePoints} ${w - padX},${padY + h}`;
  const gradId = `g-${title.replace(/\s/g, "")}`;
  const hoveredValue = hoverIdx !== null && hoverIdx < data.length ? data[hoverIdx] : null;
  const hoveredLabel = hoverIdx !== null && hoverIdx < labels.length ? labels[hoverIdx] : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{title}</span>
        <div className="flex items-center gap-2">
          {hoveredValue !== null && <span className="text-[10px] text-slate-400">{hoveredLabel}: <b className="text-slate-600 dark:text-slate-200">{hoveredValue.toLocaleString()}</b></span>}
          <span className="font-mono text-lg font-bold" style={{ color }}>{currentValue.toLocaleString()}</span>
        </div>
      </div>
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="cursor-crosshair" onMouseLeave={() => setHoverIdx(null)}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const y = padY + h * (1 - pct);
          return <line key={pct} x1={padX} y1={y} x2={w - padX} y2={y} stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="4,4" className="dark:stroke-slate-700" />;
        })}
        <polygon points={areaPoints} fill={`url(#${gradId})`} />
        <polyline points={linePoints} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={hoverIdx === i ? 4 : 1.5} fill={color} opacity={hoverIdx === i ? 1 : 0.6} />)}
        {hoverIdx !== null && hoverIdx < points.length && (
          <>
            <line x1={points[hoverIdx].x} y1={padY} x2={points[hoverIdx].x} y2={padY + h} stroke={color} strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
            <circle cx={points[hoverIdx].x} cy={points[hoverIdx].y} r="5" fill={color} opacity="0.2" />
            <circle cx={points[hoverIdx].x} cy={points[hoverIdx].y} r="3" fill={color} />
          </>
        )}
        {points.map((p, i) => <rect key={`h-${i}`} x={p.x - w / points.length / 2} y={padY} width={w / points.length} height={h} fill="transparent" onMouseEnter={() => setHoverIdx(i)} />)}
      </svg>
      {labels.length > 0 && (
        <div className="mt-1 flex justify-between text-[8px] text-slate-400 dark:text-slate-500">
          <span>{labels[0]}</span>
          {labels.length > 2 && <span>{labels[Math.floor(labels.length / 2)]}</span>}
          <span>{labels[labels.length - 1]}</span>
        </div>
      )}
    </div>
  );
}

/* ─────────── Session Row ─────────── */

function SessionRow({ session, snapshots, timeRange, onToggleUpstream }: {
  session: BgpSession; snapshots: BgpPrefixSnapshot[]; timeRange: number; onToggleUpstream: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const prefixData = useMemo(() => {
    const byTime = new Map<string, { recorded: number; advertised: number }>();
    for (const s of snapshots) {
      const key = s.recorded_at;
      const ex = byTime.get(key) || { recorded: 0, advertised: 0 };
      ex.recorded += s.prefix_count;
      ex.advertised += s.advertised_count;
      byTime.set(key, ex);
    }
    const sorted = Array.from(byTime.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return {
      recorded: sorted.map(([, v]) => v.recorded),
      advertised: sorted.map(([, v]) => v.advertised),
      labels: sorted.map(([k]) => {
        const d = new Date(k);
        if (timeRange <= 24) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (timeRange <= 168) return d.toLocaleDateString([], { weekday: "short", hour: "2-digit" });
        return d.toLocaleDateString([], { month: "short", day: "numeric" });
      }),
    };
  }, [snapshots, timeRange]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/50" onClick={() => setExpanded(!expanded)}>
        {/* Upstream toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleUpstream(session.id); }}
          className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold transition border ${session.is_upstream ? "bg-blue-500 text-white border-blue-500" : "bg-transparent text-slate-400 border-slate-200 dark:border-slate-600 hover:border-blue-400 hover:text-blue-500"}`}
          title={session.is_upstream ? "Click to remove from upstream" : "Click to mark as upstream peer"}
        >
          {session.is_upstream ? "UPSTREAM" : "upstream"}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-slate-900 dark:text-white truncate">{session.name || session.remote_ip}</span>
            <StateBadge state={session.state} />
            <FamilyBadge family={session.address_family} />
            {session.device_name && <span className="text-[10px] text-slate-400 dark:text-slate-500">@ {session.device_name}</span>}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-0.5 text-[11px]">
            <span className="text-slate-500 dark:text-slate-400">Remote: <b className="font-mono text-slate-700 dark:text-slate-200">{session.remote_ip}</b></span>
            <span className="text-slate-500 dark:text-slate-400">AS: <b className="font-mono text-slate-700 dark:text-slate-200">{session.remote_as}</b></span>
            <span className="text-slate-500 dark:text-slate-400">Local: <b className="font-mono text-slate-500 dark:text-slate-400">{session.local_ip}</b></span>
            <span className="text-slate-500 dark:text-slate-400">Uptime: <b className="text-slate-600 dark:text-slate-300">{session.uptime || "—"}</b></span>
          </div>
        </div>

        <div className="flex items-center gap-5 shrink-0">
          <div className="text-right min-w-[60px]">
            <div className="font-mono text-base font-bold text-blue-600 dark:text-blue-400">{session.prefix_count.toLocaleString()}</div>
            <div className="text-[9px] text-slate-400">received</div>
          </div>
          <div className="text-right min-w-[60px]">
            <div className="font-mono text-base font-bold text-purple-600 dark:text-purple-400">{session.advertised_count.toLocaleString()}</div>
            <div className="text-[9px] text-slate-400">advertised</div>
          </div>
          <svg className={`h-4 w-4 text-slate-400 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/30 dark:bg-slate-800/20 px-4 py-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <PrefixChart data={prefixData.recorded} labels={prefixData.labels} color="#3b82f6" title="Received Prefixes" currentValue={session.prefix_count} />
            <PrefixChart data={prefixData.advertised} labels={prefixData.labels} color="#8b5cf6" title="Advertised Prefixes" currentValue={session.advertised_count} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────── Main Page ─────────── */

export default function Routing() {
  const [sessions, setSessions] = useState<BgpSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(168);
  const [mikrotiks, setMikrotiks] = useState<MikrotikDevice[]>([]);
  const [allSnapshots, setAllSnapshots] = useState<BgpPrefixSnapshot[]>([]);
  const [sessionSnapshots, setSessionSnapshots] = useState<Map<number, BgpPrefixSnapshot[]>>(new Map());

  // Filters
  const [filterDevice, setFilterDevice] = useState<number | "">("");
  const [filterFamily, setFilterFamily] = useState<string>("");
  const [filterState, setFilterState] = useState<string>("");
  const [filterAsn, setFilterAsn] = useState<string>("");
  const [filterSearch, setFilterSearch] = useState<string>("");

  const loadSessions = useCallback(() => {
    setLoading(true);
    api.get<BgpSession[]>("/devices/bgp/all-sessions")
      .then((data) => {
        setSessions(data);
        const all: BgpPrefixSnapshot[] = [];
        Promise.all(data.map((s) =>
          api.get<BgpPrefixSnapshot[]>(`/devices/mikrotiks/${s.device_id}/bgp/${s.id}/snapshots`, { hours: timeRange }).catch(() => [])
        )).then((results) => {
          const newMap = new Map<number, BgpPrefixSnapshot[]>();
          results.forEach((snap, i) => {
            newMap.set(data[i].id, snap);
            all.push(...snap);
          });
          setSessionSnapshots(newMap);
          setAllSnapshots(all);
        });
      })
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, [timeRange]);

  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => { api.get<MikrotikDevice[]>("/devices/mikrotiks").then(setMikrotiks).catch(() => {}); }, []);

  const toggleUpstream = useCallback(async (id: number) => {
    try {
      const res = await api.put<{ id: number; is_upstream: boolean }>(`/devices/bgp/sessions/${id}/toggle-upstream`, {});
      setSessions((prev) => prev.map((s) => s.id === id ? { ...s, is_upstream: res.is_upstream } : s));
    } catch {}
  }, []);

  // Filter
  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (filterDevice !== "" && s.device_id !== filterDevice) return false;
      if (filterFamily) {
        const isV6 = s.address_family?.toLowerCase().includes("ipv6");
        if (filterFamily === "ipv4" && isV6) return false;
        if (filterFamily === "ipv6" && !isV6) return false;
      }
      if (filterState && s.state !== filterState) return false;
      if (filterAsn && !String(s.remote_as).includes(filterAsn) && !(s.name || "").toLowerCase().includes(filterAsn.toLowerCase())) return false;
      if (filterSearch) {
        const q = filterSearch.toLowerCase();
        const haystack = `${s.name} ${s.remote_ip} ${s.local_ip} ${s.remote_as} ${s.device_name} ${s.address_family}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [sessions, filterDevice, filterFamily, filterState, filterAsn, filterSearch]);

  const upstream = useMemo(() => filtered.filter((s) => s.is_upstream), [filtered]);
  const nonUpstream = useMemo(() => filtered.filter((s) => !s.is_upstream), [filtered]);

  // Totals
  const totalUpRx = filtered.reduce((a, s) => a + s.prefix_count, 0);
  const totalUpTx = filtered.reduce((a, s) => a + s.advertised_count, 0);

  // Total chart data
  const totalChartData = useMemo(() => {
    const byTime = new Map<string, { recorded: number; advertised: number }>();
    for (const s of allSnapshots) {
      const key = s.recorded_at;
      const ex = byTime.get(key) || { recorded: 0, advertised: 0 };
      ex.recorded += s.prefix_count;
      ex.advertised += s.advertised_count;
      byTime.set(key, ex);
    }
    const sorted = Array.from(byTime.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return {
      recorded: sorted.map(([, v]) => v.recorded),
      advertised: sorted.map(([, v]) => v.advertised),
      labels: sorted.map(([k]) => {
        const d = new Date(k);
        if (timeRange <= 24) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (timeRange <= 168) return d.toLocaleDateString([], { weekday: "short", hour: "2-digit" });
        return d.toLocaleDateString([], { month: "short", day: "numeric" });
      }),
    };
  }, [allSnapshots, timeRange]);

  const hasFilters = filterDevice !== "" || filterFamily || filterState || filterAsn || filterSearch;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">BGP Routing</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">{sessions.length} sessions &middot; {sessions.filter((s) => s.state === "established").length} established</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {TIME_RANGES.map((tr) => (
            <button key={tr.label} onClick={() => setTimeRange(tr.hours)} className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${timeRange === tr.hours ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400"}`}>{tr.label}</button>
          ))}
        </div>
      </header>

      {loading && <div className="card p-8 text-center text-slate-400">Loading BGP sessions...</div>}

      {!loading && (
        <>
          {/* Our ASN + Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {/* Our ASN card */}
            <div className="rounded-xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4 dark:border-blue-800 dark:from-blue-950/50 dark:to-indigo-950/50">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Our Network</div>
              <div className="mt-1 font-mono text-2xl font-bold text-blue-700 dark:text-blue-300">AS{OUR_ASN}</div>
              <div className="mt-1 text-[11px] text-blue-500/80 dark:text-blue-400/70">Qb Internet</div>
            </div>

            <div className="card p-4">
              <div className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">Sessions</div>
              <div className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">{filtered.length}</div>
              <div className="mt-1 text-[11px] text-slate-400">{filtered.filter((s) => s.state === "established").length} established</div>
            </div>
            <div className="card p-4">
              <div className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">Upstream</div>
              <div className="mt-1 text-3xl font-bold text-blue-600 dark:text-blue-400">{upstream.length}</div>
              <div className="mt-1 text-[11px] text-slate-400">marked peers</div>
            </div>
            <div className="card p-4">
              <div className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">Received</div>
              <div className="mt-1 text-3xl font-bold text-emerald-600 dark:text-emerald-400">{totalUpRx.toLocaleString()}</div>
              <div className="mt-1 text-[11px] text-slate-400">prefixes</div>
            </div>
            <div className="card p-4">
              <div className="text-[10px] font-medium uppercase text-slate-500 dark:text-slate-400">Advertised</div>
              <div className="mt-1 text-3xl font-bold text-purple-600 dark:text-purple-400">{totalUpTx.toLocaleString()}</div>
              <div className="mt-1 text-[11px] text-slate-400">prefixes</div>
            </div>
          </div>

          {/* Total prefix charts */}
          {totalChartData.recorded.length > 1 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <PrefixChart data={totalChartData.recorded} labels={totalChartData.labels} color="#3b82f6" title="Total Received Prefixes" currentValue={totalUpRx} />
              <PrefixChart data={totalChartData.advertised} labels={totalChartData.labels} color="#8b5cf6" title="Total Advertised Prefixes" currentValue={totalUpTx} />
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 dark:border-slate-700 dark:bg-slate-900">
            <span className="text-[10px] font-semibold uppercase text-slate-400">Filters</span>
            <select className="input w-full !py-1 !text-[11px] sm:w-36" value={filterDevice} onChange={(e) => setFilterDevice(e.target.value ? Number(e.target.value) : "")}>
              <option value="">All Routers</option>
              {mikrotiks.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <select className="input w-full !py-1 !text-[11px] sm:w-28" value={filterFamily} onChange={(e) => setFilterFamily(e.target.value)}>
              <option value="">All Family</option>
              <option value="ipv4">IPv4</option>
              <option value="ipv6">IPv6</option>
            </select>
            <select className="input w-full !py-1 !text-[11px] sm:w-28" value={filterState} onChange={(e) => setFilterState(e.target.value)}>
              <option value="">All State</option>
              <option value="established">Established</option>
              <option value="active">Active</option>
              <option value="connect">Connect</option>
              <option value="idle">Idle</option>
            </select>
            <input className="input w-full !py-1 !text-[11px] sm:w-36" placeholder="ASN / Name..." value={filterAsn} onChange={(e) => setFilterAsn(e.target.value)} />
            <input className="input w-full !py-1 !text-[11px] sm:w-44" placeholder="Search all fields..." value={filterSearch} onChange={(e) => setFilterSearch(e.target.value)} />
            {hasFilters && (
              <button className="text-[10px] text-red-500 hover:underline" onClick={() => { setFilterDevice(""); setFilterFamily(""); setFilterState(""); setFilterAsn(""); setFilterSearch(""); }}>Clear</button>
            )}
          </div>

          {/* Upstream Peers section */}
          {upstream.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100 text-sm font-bold text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">↑</div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Upstream Peers</h2>
                <span className="badge text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">{upstream.length}</span>
              </div>
              <div className="space-y-2">
                {upstream.map((s) => (
                  <SessionRow key={s.id} session={s} snapshots={sessionSnapshots.get(s.id) || []} timeRange={timeRange} onToggleUpstream={toggleUpstream} />
                ))}
              </div>
            </div>
          )}

          {/* Other Peers section */}
          {nonUpstream.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">↓</div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">All Peers</h2>
                <span className="badge text-[10px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">{nonUpstream.length}</span>
              </div>
              <div className="space-y-2">
                {nonUpstream.map((s) => (
                  <SessionRow key={s.id} session={s} snapshots={sessionSnapshots.get(s.id) || []} timeRange={timeRange} onToggleUpstream={toggleUpstream} />
                ))}
              </div>
            </div>
          )}

          {filtered.length === 0 && !loading && (
            <div className="card p-8 text-center text-slate-400">No sessions match the current filters.</div>
          )}
        </>
      )}
    </div>
  );
}
