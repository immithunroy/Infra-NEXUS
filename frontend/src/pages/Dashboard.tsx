import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, downloadFile } from "../api/client";
import { BrandBucket, DashboardSummary, MassDownPort, OltUsage, PortUsage, WeakOnu, WeakSignalReport } from "../api/types";
import SubscriberLink from "../components/SubscriberLink";
import { fmtTime } from "../lib/time";

/* ------------------------------------------------------------------ helpers */

function pct(used: number, total: number) {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

function barColor(p: number) {
  return p < 70 ? "from-emerald-400 to-cyan-400" : p < 90 ? "from-amber-400 to-orange-400" : "from-rose-500 to-red-500";
}

function GlowBar({ p, height = "h-2" }: { p: number; height?: string }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10 ${height}`}>
      <div
        className={`h-full rounded-full bg-gradient-to-r ${barColor(p)} transition-all duration-1000`}
        style={{ width: `${Math.max(p, 2)}%` }}
      />
    </div>
  );
}

function Donut({ segments, center, sub }: {
  segments: { label: string; value: number; color: string }[];
  center: string;
  sub: string;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const R = 40;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-44 w-44 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx={50} cy={50} r={R} fill="none" stroke="currentColor" className="text-slate-200 dark:text-slate-700" strokeWidth={13} />
          {segments.map((s) => {
            if (s.value <= 0) return null;
            const frac = s.value / total;
            const el = (
              <circle
                key={s.label}
                cx={50}
                cy={50}
                r={R}
                fill="none"
                stroke={s.color}
                strokeWidth={13}
                strokeDasharray={`${frac * C} ${C}`}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 1s ease" }}
              />
            );
            offset += frac * C;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-3xl font-bold text-slate-900 dark:text-white">{center}</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">{sub}</div>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-2">
        {segments.map((s) => (
          <div key={s.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="font-semibold text-slate-900 dark:text-white">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, accent }: { label: string; value: string | number; hint: string; accent: string }) {
  return (
    <div className="card relative overflow-hidden p-5">
      <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accent}`} />
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 text-3xl font-bold text-slate-900 dark:text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</div>
    </div>
  );
}

function Insight({ icon, title, body, tone }: { icon: string; title: string; body: string; tone: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 dark:border-slate-700/60 dark:bg-slate-800/50">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d={icon} />
        </svg>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{body}</div>
      </div>
    </div>
  );
}

const BRAND_COLORS = [
  "#6d5efc",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#06b6d4",
  "#8b5cf6",
  "#ec4899",
  "#22c55e",
  "#f97316",
  "#3b82f6",
  "#14b8a6",
  "#a855f7",
  "#eab308",
  "#6366f1",
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Place bubbles inside [margin, W-margin] x [margin, H-margin] with no
// overlap. Circles are sorted largest-first; each is dropped at a random spot
// that clears all previously placed bubbles, falling back to a fine grid scan
// so placement is always guaranteed within bounds.
function packCircles(
  circles: { r: number }[],
  W: number,
  H: number,
  margin: number,
  rand: () => number,
): { x: number; y: number }[] {
  const placed: { x: number; y: number; r: number }[] = [];
  const minD = (a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const rr = a.r + b.r;
    return Math.hypot(dx, dy) >= rr + 6;
  };
  for (const c of circles) {
    let pos: { x: number; y: number } | null = null;
    const tries = 220;
    for (let i = 0; i < tries && !pos; i++) {
      const x = margin + c.r + rand() * (W - 2 * (margin + c.r));
      const y = margin + c.r + rand() * (H - 2 * (margin + c.r));
      if (placed.every((p) => minD(p, { x, y, r: c.r }))) pos = { x, y };
    }
    if (!pos) {
      // Grid scan fallback: guarantees a legal spot if any exists.
      const step = 4;
      outer: for (let gx = margin + c.r; gx <= W - margin - c.r; gx += step) {
        for (let gy = margin + c.r; gy <= H - margin - c.r; gy += step) {
          if (placed.every((p) => minD(p, { x: gx, y: gy, r: c.r }))) {
            pos = { x: gx, y: gy };
            break outer;
          }
        }
      }
    }
    if (!pos) pos = { x: margin + c.r, y: margin + c.r };
    placed.push({ x: pos.x, y: pos.y, r: c.r });
  }
  return placed;
}

function BrandBubbleChart({ data }: { data: BrandBucket[] }) {
  const [tick, setTick] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(760);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setBoxW(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 4500);
    return () => clearInterval(id);
  }, []);

  const bubbles = useMemo(() => {
    if (data.length === 0) return [];
    const max = Math.max(...data.map((b) => b.count), 1);
    const H = 340;
    const margin = 10;
    const availW = Math.max(120, boxW - 2 * margin);
    const availH = Math.max(120, H - 2 * margin);
    // Largest bubble must clear half the container on both axes.
    const maxR = Math.min(96, availW / 2 - 8, availH / 2 - 8, 90);
    // True proportional area: area ∝ count  →  r ∝ sqrt(count).
    const rScale = maxR / Math.sqrt(max);
    const circles = data
      .map((b) => ({ ...b, r: Math.max(11, rScale * Math.sqrt(b.count)) }))
      .sort((a, b) => b.r - a.r);

    const rand = mulberry32(tick * 7919 + 12345);
    const placed = packCircles(circles, boxW, H, margin, rand);
    return circles.map((c, i) => ({ ...c, x: placed[i].x, y: placed[i].y }));
  }, [data, tick, boxW]);

  return (
    <div>
      <div ref={boxRef} className="relative h-[340px] w-full overflow-hidden rounded-xl">
        {bubbles.map((b, i) => {
          const color = BRAND_COLORS[(i + tick * 2) % BRAND_COLORS.length];
          const showLabel = b.r >= 40;
          return (
            <div
              key={b.brand}
              className="absolute left-0 top-0 flex items-center justify-center overflow-hidden rounded-full border-2 text-center"
              style={{
                width: b.r * 2,
                height: b.r * 2,
                transform: `translate(${b.x - b.r}px, ${b.y - b.r}px)`,
                borderColor: color,
                background: `${color}1a`,
                boxShadow: `0 0 14px ${color}33`,
                transition: "transform 2400ms ease-in-out, background-color 1800ms ease, border-color 1800ms ease, box-shadow 1800ms ease",
              }}
              title={`${b.brand} — ${b.count} (${b.pct}%)`}
            >
              {showLabel ? (
                <div className="px-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>{b.brand}</div>
                  <div className="text-sm font-bold text-slate-800 dark:text-slate-100">{b.count.toLocaleString()}</div>
                  <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400">{b.pct}%</div>
                </div>
              ) : (
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{b.count}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {bubbles.map((b, i) => {
          const color = BRAND_COLORS[(i + tick * 2) % BRAND_COLORS.length];
          return (
            <span key={b.brand} className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
              {b.brand} · {b.count}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- OLT card */

function PortTile({ p }: { p: PortUsage }) {
  const used = pct(p.used, p.capacity);
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-bold text-brand-700 dark:text-cyan-300">{p.port}</span>
        <span className={`text-[11px] font-semibold ${p.remaining > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>
          {p.remaining} free
        </span>
      </div>
      <div className="mt-2"><GlowBar p={used} height="h-1.5" /></div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
        <span>{p.used}/{p.capacity} ONUs</span>
        <span className="flex gap-2">
          <span className="text-emerald-600 dark:text-emerald-300">{p.active} up</span>
          <span className="text-violet-600 dark:text-violet-300">{p.bound} bound</span>
        </span>
      </div>
    </div>
  );
}

function WeakSignalsCard({ olts }: { olts: OltUsage[] }) {
  const [oltId, setOltId] = useState("");
  const [port, setPort] = useState("");
  const [limit, setLimit] = useState(10);
  const [rows, setRows] = useState<WeakOnu[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (oltId) params.set("olt_id", oltId);
    if (port) params.set("port", port);
    params.set("limit", String(limit));
    api
      .get<WeakSignalReport>(`/reports/weakest?${params.toString()}`)
      .then((d) => setRows(d.rows))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [oltId, port, limit]);

  const portOptions = useMemo(() => {
    const list = oltId ? olts.filter((o) => String(o.id) === oltId) : olts;
    return Array.from(new Set(list.flatMap((o) => o.ports.map((p) => p.port)))).sort();
  }, [olts, oltId]);

  const exportFile = async (fmt: "xlsx" | "pdf") => {
    setExporting(true);
    const params = new URLSearchParams();
    if (oltId) params.set("olt_id", oltId);
    if (port) params.set("port", port);
    params.set("limit", String(limit));
    try {
      await downloadFile(`/reports/weakest/export?format=${fmt}&${params.toString()}`, `weakest-signals.${fmt}`);
    } catch {
      /* ignore */
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="card overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">
          Weakest Optical Signals <span className="font-normal text-slate-400">(Top {limit})</span>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">OLT</label>
            <select className="input w-44" value={oltId} onChange={(e) => { setOltId(e.target.value); setPort(""); }}>
              <option value="">All OLTs</option>
              {olts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Port</label>
            <select className="input w-40" value={port} onChange={(e) => setPort(e.target.value)}>
              <option value="">All ports</option>
              {portOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Top N</label>
            <select className="input w-24" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-secondary" disabled={exporting} onClick={() => exportFile("xlsx")}>
              {exporting ? "…" : "Excel"}
            </button>
            <button className="btn btn-secondary" disabled={exporting} onClick={() => exportFile("pdf")}>
              {exporting ? "…" : "PDF"}
            </button>
          </div>
        </div>
      </div>
      {loading ? (
        <div className="p-6 text-sm text-slate-400">Loading weak signals…</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="th">#</th>
              <th className="th">OLT</th>
              <th className="th">PON Port</th>
              <th className="th">Customer</th>
              <th className="th">Subscriber ID</th>
              <th className="th">RX Power</th>
              <th className="th">TX Power</th>
              <th className="th">State</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {rows.map((w, i) => (
              <tr key={`${w.olt_name}-${w.pon_port}-${w.onu_id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="td text-xs text-slate-400">{i + 1}</td>
                <td className="td">{w.olt_name || "—"}</td>
                <td className="td font-mono text-xs text-brand-700 dark:text-cyan-300">{w.pon_port}</td>
                <td className="td">{w.name || w.serial || "—"}</td>
                <td className="td"><SubscriberLink subscriber={w.subscriber} /></td>
                <td className="td font-semibold text-rose-600 dark:text-rose-300">{w.rx_power != null ? `${w.rx_power.toFixed(1)} dBm` : "—"}</td>
                <td className="td text-slate-500">{w.tx_power != null ? `${w.tx_power.toFixed(1)} dBm` : "—"}</td>
                <td className="td capitalize text-slate-500 dark:text-slate-400">{w.state || "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td className="td text-slate-500" colSpan={8}>No optical telemetry in this selection.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function OltCard({ olt, weak }: { olt: OltUsage; weak: WeakOnu[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button className="w-full p-5 text-left" onClick={() => setOpen(!open)}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`h-2.5 w-2.5 rounded-full ${olt.status === "reachable" ? "bg-emerald-500" : "bg-rose-500"}`} />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-slate-900 dark:text-white">{olt.name}</span>
                <span className="rounded-md bg-brand-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-700 dark:bg-brand-900/30 dark:text-cyan-300">
                  {olt.pon_type}
                </span>
              </div>
              <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{olt.ip} · {olt.port_count} PON ports · {olt.port_capacity} slots/port</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900 dark:text-white">{olt.onu_total}</div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">ONUs</div>
            </div>
            <div className="text-right">
              <div className={`text-2xl font-bold ${olt.free_slots > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>{olt.free_slots}</div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">free slots</div>
            </div>
            <div className="w-40">
              <div className="mb-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>Capacity</span>
                <span>{olt.utilization_pct}%</span>
              </div>
              <GlowBar p={olt.utilization_pct} />
              <div className="mt-1.5 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span className="text-emerald-600 dark:text-emerald-300">{olt.onu_active} active</span>
                <span className="text-violet-600 dark:text-violet-300">{olt.onu_bound} bound</span>
              </div>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-200 p-5 dark:border-slate-700">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Port usage & remaining ONU/ONT slots
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {olt.ports.map((p) => <PortTile key={p.port} p={p} />)}
          </div>
          {weak.length > 0 && (
            <div className="mt-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Weakest signals on this OLT</div>
              <div className="space-y-1.5">
                {weak.map((w) => (
                  <div key={`${w.olt_name}-${w.pon_port}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-800/60">
                    <span className="font-mono text-brand-700 dark:text-cyan-300">{w.pon_port}</span>
                    <span className="flex-1 px-3 text-slate-600 dark:text-slate-300">{w.name || w.subscriber || "—"}</span>
                    <span className="font-semibold text-rose-600 dark:text-rose-300">{w.rx_power != null ? `${w.rx_power.toFixed(1)} dBm` : "—"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- dashboard */

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [liveMassDowns, setLiveMassDowns] = useState<MassDownPort[]>([]);
  const [massDownsUpdated, setMassDownsUpdated] = useState<Date | null>(null);

  const load = useCallback(() => {
    api.get<DashboardSummary>("/dashboard").then(setData).catch((e) => setError(String(e)));
    setLastUpdated(new Date());
  }, []);

  const loadMassDowns = useCallback(() => {
    api.get<MassDownPort[]>("/dashboard/mass-downs").then(setLiveMassDowns).catch(() => undefined);
    setMassDownsUpdated(new Date());
  }, []);

  useEffect(() => {
    load();
    loadMassDowns();
    const dashId = setInterval(load, 60000);
    const massId = setInterval(loadMassDowns, 300000); // 5 minutes
    return () => { clearInterval(dashId); clearInterval(massId); };
  }, [load, loadMassDowns]);

  const stateSegments = useMemo(() => {
    if (!data) return [];
    return [
      { label: "Active", value: data.onu_active, color: "#10b981" },
      { label: "Inactive", value: data.onu_inactive, color: "#f59e0b" },
      { label: "Unknown / Offline", value: data.onu_total - data.onu_active - data.onu_inactive, color: "#f87171" },
    ];
  }, [data]);

  if (error) return <div className="text-red-600">Failed to load dashboard: {error}</div>;
  if (!data) return <div className="text-slate-500">Loading...</div>;

  const maxHist = Math.max(...data.signal_hist.map((s) => s.count), 1);
  const weak = data.weakest_onus[0];
  const busiest = data.olts.flatMap((o) => o.ports.map((p) => ({ o, p })))
    .sort((a, b) => b.p.used / b.p.capacity - a.p.used / a.p.capacity)[0];

  const insights = [
    {
      icon: "M3 17l5-5 4 4 7-7m0 0v4m0-4h-4",
      title: `${data.free_slots.toLocaleString()} free ONU/ONT slots`,
      body: `Across ${data.olts.reduce((a, o) => a + o.port_count, 0)} PON ports on ${data.olt_count} OLTs. ${data.total_slots.toLocaleString()} total capacity.`,
      tone: "bg-cyan-50 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300",
    },
    {
      icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
      title: busiest ? `${busiest.p.port} on ${busiest.o.name} is busiest` : "No port data yet",
      body: busiest ? `${busiest.p.used}/${busiest.p.capacity} ONUs (${pct(busiest.p.used, busiest.p.capacity)}%) — ${busiest.p.remaining} slots remaining.` : "Run an OLT scan to see port usage.",
      tone: "bg-violet-50 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
    },
    {
      icon: "M13 10V3L4 14h7v7l9-11h-7z",
      title: weak ? `Weakest signal: ${weak.pon_port}` : "No optical data yet",
      body: weak
        ? `${weak.rx_power?.toFixed(1) ?? "—"} dBm on ${weak.olt_name}${weak.name || weak.subscriber ? ` (${weak.name || weak.subscriber})` : ""}. ${data.signal_hist.filter((b) => b.label.includes("<= -28")).reduce((a, b) => a + b.count, 0)} ONUs below -28 dBm.`
        : "Enable SNMP on your OLTs to collect RX/TX optical power.",
      tone: "bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
    },
    {
      icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
      title: `${data.bound_pct}% of ONUs identified`,
      body: `${data.onu_bound} of ${data.onu_total} ONUs are bound to a Mikrotik subscriber. ${data.onu_total - data.onu_bound} still unmatched.`,
      tone: "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">PON Infrastructure Overview</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Telemetry across {data.olt_count} OLTs and {data.mikrotik_count} Mikrotik · last scan {fmtTime(data.last_scan)}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          Auto-refresh every 1 min{lastUpdated ? ` · updated ${fmtTime(lastUpdated)}` : ""}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="ONU / ONT Devices" value={data.onu_total.toLocaleString()} hint={`${data.onu_active} active · ${data.onu_manual} manual`} accent="from-cyan-400 to-blue-500" />
        <Kpi label="Online" value={`${pct(data.onu_active, data.onu_total)}%`} hint={`${data.onu_active} of ${data.onu_total} reporting`} accent={pct(data.onu_active, data.onu_total) >= 80 ? "from-emerald-400 to-cyan-400" : "from-amber-400 to-rose-400"} />
        <Kpi label="Subscribers Identified" value={`${data.bound_pct}%`} hint={`${data.onu_bound} bound to a PPPoE account`} accent="from-violet-400 to-fuchsia-500" />
        <Kpi label="Subscribers (PPP Secrets)" value={data.subscriber_total.toLocaleString()} hint={`${data.subscriber_active.toLocaleString()} connected now`} accent="from-indigo-400 to-violet-500" />
        <Kpi label="Free ONT Slots" value={data.free_slots.toLocaleString()} hint={`of ${data.total_slots.toLocaleString()} total capacity`} accent="from-emerald-400 to-lime-400" />
        <Kpi label="OLTs" value={data.olt_count} hint={`${data.olt_reachable} reachable`} accent="from-sky-400 to-cyan-400" />
        <Kpi label="Mikrotik Routers" value={data.mikrotik_count} hint="PPPoE source" accent="from-blue-400 to-indigo-500" />
        <Kpi label="MACs on PON Ports" value={data.olt_mac_count.toLocaleString()} hint={`${data.matched_mac_count} matched to subscribers`} accent="from-teal-400 to-emerald-400" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card flex h-full flex-col p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Insights
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {insights.map((ins) => <Insight key={ins.title} {...ins} />)}
          </div>

          <div className={`mt-4 flex-1 rounded-xl border p-4 ${(liveMassDowns.length > 0 || data.mass_down_ports.length > 0) ? "border-rose-300 bg-rose-50/60 dark:border-rose-800 dark:bg-rose-950/30" : "border-slate-200 dark:border-slate-700"}`}>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Power Outage / Mass Down Areas
              </h4>
              <div className="flex items-center gap-2">
                {massDownsUpdated && (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                    {massDownsUpdated.toLocaleTimeString()}
                  </span>
                )}
                <button
                  type="button"
                  onClick={loadMassDowns}
                  className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                  title="Refresh now"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 4v6h-6M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                  </svg>
                </button>
                <span className={`badge ${(liveMassDowns.length > 0 || data.mass_down_ports.length > 0) ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                  {liveMassDowns.length || data.mass_down_ports.length}
                </span>
              </div>
            </div>
            {(liveMassDowns.length > 0 || data.mass_down_ports.length > 0) ? (
              <div className="grid grid-cols-5 gap-2">
                {(liveMassDowns.length > 0 ? liveMassDowns : data.mass_down_ports).slice(0, 10).map((m) => (
                  <button
                    key={`${m.olt_id}-${m.port}`}
                    type="button"
                    onClick={() => navigate(`/live-downs?olt_id=${m.olt_id}&port=${encodeURIComponent(m.port)}`)}
                    className="flex flex-col gap-1 rounded-lg border border-rose-200 bg-white p-2.5 text-left transition-colors hover:border-rose-400 hover:bg-rose-50 dark:border-rose-800 dark:bg-slate-900/60 dark:hover:border-rose-600 dark:hover:bg-rose-950/40"
                  >
                    <span className="font-mono text-[11px] font-bold text-rose-600 dark:text-rose-300">{m.port}</span>
                    <span className="truncate text-[10px] text-slate-500 dark:text-slate-400">{m.olt_name}</span>
                    {m.label && <span className="truncate text-[10px] font-semibold text-slate-400 dark:text-slate-500">{m.label}</span>}
                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">{m.count} ONUs</span>
                      <span className={`badge text-[9px] px-1 py-0 ${m.reason === "power-off" ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300" : m.reason === "wire-down" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"}`}>
                        {m.reason === "power-off" ? "power" : m.reason === "wire-down" ? "wire" : "outage"}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-xs text-slate-400 dark:text-slate-500">
                No mass down areas detected — all ports healthy.
              </div>
            )}
          </div>
        </div>

        <div className="card flex h-full flex-col p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Router Brands (Proportional Area)
          </h3>
          <div className="flex-1">
            {data.router_brands.length > 0 ? (
              <BrandBubbleChart data={data.router_brands} />
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-slate-400 dark:text-slate-500">
                No router brands yet — resolve MAC vendors on bound ONUs.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">ONU State Distribution</h3>
          <Donut segments={stateSegments} center={String(data.onu_total)} sub="total ONUs" />
        </div>

        <div className="card p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">RX Signal Quality</h3>
          <div className="space-y-3">
            {data.signal_hist.map((s) => (
              <div key={s.label}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">{s.label}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{s.count}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${s.label.includes("<= -28") ? "from-rose-500 to-red-500" : s.label.includes("28") || s.label.includes("24") ? "from-amber-400 to-orange-400" : "from-emerald-400 to-cyan-400"}`}
                    style={{ width: `${Math.max((s.count / maxHist) * 100, 2)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">ONUs with optical telemetry only ({data.signal_hist.reduce((a, b) => a + b.count, 0)}). Lower = worse.</p>
        </div>

        <div className="card p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Capacity Utilization</h3>
          <div className="mb-6">
            <div className="mb-1 flex justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>All PON slots</span>
              <span>{pct(data.onu_total, data.total_slots)}%</span>
            </div>
            <GlowBar p={pct(data.onu_total, data.total_slots)} height="h-3" />
            <div className="mt-2 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>{data.onu_total.toLocaleString()} in use</span>
              <span className="text-emerald-600 dark:text-emerald-300">{data.free_slots.toLocaleString()} free</span>
            </div>
          </div>
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">OLT utilization</h4>
          <div className="space-y-3">
            {data.olts.map((o) => (
              <div key={o.id}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-slate-700 dark:text-slate-300">{o.name}</span>
                  <span className="text-slate-500 dark:text-slate-400">{o.utilization_pct}% · {o.free_slots} free</span>
                </div>
                <GlowBar p={o.utilization_pct} height="h-1.5" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          OLT Devices — click to expand port usage & remaining ONT slots
        </h3>
        <div className="space-y-3">
          {data.olts.map((o) => (
            <OltCard key={o.id} olt={o} weak={data.weakest_onus.filter((w) => w.olt_name === o.name)} />
          ))}
          {data.olts.length === 0 && (
            <div className="card border-dashed p-8 text-center text-slate-500">No OLT devices configured yet.</div>
          )}
        </div>
      </div>

      <WeakSignalsCard olts={data.olts} />
    </div>
  );
}