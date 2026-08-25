import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { AcsDevice, AcsWifiStatus, canOps, RemoteAccess, SubscriberProfile } from "../api/types";
import { useUserRole } from "../lib/role";
import { fmtTime, fmtTimeShort } from "../lib/time";
import StatusBadge from "../components/StatusBadge";
import ActionResultBanner from "../components/ActionResultBanner";
import WarningBanner from "../components/WarningBanner";

const ranges = [
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "1m", hours: 720 },
  { label: "3m", hours: 2160 },
  { label: "6m", hours: 4380 },
  { label: "1y", hours: 8760 },
];

function fmtBw(mbps: number) {
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
  return `${mbps.toFixed(mbps >= 100 ? 0 : mbps >= 10 ? 1 : 2)} Mbps`;
}

function OpticalChart({ subscriber }: { subscriber: string }) {
  const [hours, setHours] = useState(168);
  const [data, setData] = useState<SubscriberProfile["telemetry"]>([]);
  const [loading, setLoading] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; mx: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<SubscriberProfile["telemetry"]>(
        `/subscribers/${encodeURIComponent(subscriber)}/telemetry?hours=${hours}`
      )
      .then((pts) => {
        if (alive) {
          setData(pts.filter((p) => p.rx_power != null || p.tx_power != null));
          setLoading(false);
        }
      })
      .catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [subscriber, hours]);

  const W = 760, H = 240, PAD_L = 52, PAD_R = 16, PAD_T = 12, PAD_B = 36;
  const PW = W - PAD_L - PAD_R, PH = H - PAD_T - PAD_B;
  const vals = data.flatMap((p) => [p.rx_power, p.tx_power]).filter((v): v is number => v != null);
  const lo = vals.length > 0 ? Math.floor(Math.min(...vals)) : 0;
  const hi = vals.length > 0 ? Math.ceil(Math.max(...vals)) : 2;
  const span = Math.max(hi - lo, 2);
  const t0 = data.length > 0 ? new Date(data[0].sampled_at).getTime() : 0;
  const t1 = data.length > 0 ? new Date(data[data.length - 1].sampled_at).getTime() : 0;

  const xOf = (i: number) =>
    data.length === 0 ? PAD_L :
    PAD_L + (t1 > t0 ? ((new Date(data[i].sampled_at).getTime() - t0) / (t1 - t0)) * PW : (i / Math.max(data.length - 1, 1)) * PW);
  const yOf = (v: number) => PAD_T + ((hi - v) / span) * PH;

  const GAP_MS = 30 * 60 * 1000;
  const buildPath = (key: "rx_power" | "tx_power") => {
    let d = "";
    let prevT: number | null = null;
    data.forEach((p, i) => {
      if (p[key] == null) return;
      const t = new Date(p.sampled_at).getTime();
      const cmd = !d || (prevT != null && t - prevT > GAP_MS) ? "M" : "L";
      d += `${cmd}${xOf(i).toFixed(1)},${yOf(p[key] as number).toFixed(1)}`;
      prevT = t;
    });
    return d;
  };

  const gridCount = 5;
  const grids = Array.from({ length: gridCount }, (_, i) => ({
    y: PAD_T + (i / (gridCount - 1)) * PH,
    val: (hi - (i / (gridCount - 1)) * span).toFixed(0),
  }));

  const handleMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || data.length === 0) return;
      const svgX = ((e.clientX - rect.left) / rect.width) * W;
      let closest = 0;
      let minDist = Infinity;
      data.forEach((_, i) => {
        const dist = Math.abs(xOf(i) - svgX);
        if (dist < minDist) { minDist = dist; closest = i; }
      });
      setHover({ idx: closest, mx: xOf(closest) });
    },
    [data, t0, t1],
  );

  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">Loading optical data...</div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        <div className="mb-3 flex items-center justify-end gap-1">
          {ranges.map((r) => (
            <button key={`opt-${r.label}`}
              className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium ${hours === r.hours ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
              onClick={() => setHours(r.hours)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
          No optical telemetry yet.
        </div>
      </div>
    );
  }

  const lastRx = data[data.length - 1].rx_power;
  const lastTx = data[data.length - 1].tx_power;

  const formatVal = (v: number) => `${v.toFixed(1)} dBm`;

  return (
    <div className="relative">
      {/* Time range selector + Legend */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#7c6dfc] shadow-[0_0_6px_rgba(124,109,252,0.5)]" />
            <span className="text-slate-500 dark:text-slate-400">RX</span>
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-100">{lastRx != null ? formatVal(lastRx) : "\u2014"}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.5)]" />
            <span className="text-slate-500 dark:text-slate-400">TX</span>
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-100">{lastTx != null ? formatVal(lastTx) : "\u2014"}</span>
          </span>
          <span className="text-slate-400 dark:text-slate-500">{data.length} pts</span>
        </div>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button key={`opt-${r.label}`}
              className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium ${hours === r.hours ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
              onClick={() => setHours(r.hours)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative w-full overflow-hidden rounded-xl border border-slate-200/60 bg-white/50 p-2 shadow-sm backdrop-blur-sm dark:border-slate-700/40 dark:bg-slate-900/40">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full cursor-crosshair"
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <filter id="optGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Grid */}
          {grids.map((g) => (
            <line key={g.val} x1={PAD_L} y1={g.y} x2={W - PAD_R} y2={g.y}
              stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}

          {/* Y-axis labels */}
          {grids.map((g) => (
            <text key={`l${g.val}`} x={PAD_L - 8} y={g.y + 3.5} textAnchor="end"
              className="fill-slate-400 dark:fill-slate-500" fontSize={9.5} fontFamily="ui-monospace,monospace">
              {g.val}
            </text>
          ))}

          {/* Lines */}
          <path d={buildPath("rx_power")} fill="none" stroke="#7c6dfc" strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" filter="url(#optGlow)" />
          <path d={buildPath("tx_power")} fill="none" stroke="#fbbf24" strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" filter="url(#optGlow)" />

          {/* Hover crosshair */}
          {hover && (
            <>
              <line x1={hover.mx} y1={PAD_T} x2={hover.mx} y2={PAD_T + PH}
                stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} strokeDasharray="3,3" vectorEffect="non-scaling-stroke" />
              {data[hover.idx].rx_power != null && (
                <circle cx={xOf(hover.idx)} cy={yOf(data[hover.idx].rx_power!)} r={4.5}
                  fill="#7c6dfc" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke"
                  style={{ filter: "drop-shadow(0 0 4px rgba(124,109,252,0.6))" }} />
              )}
              {data[hover.idx].tx_power != null && (
                <circle cx={xOf(hover.idx)} cy={yOf(data[hover.idx].tx_power!)} r={4.5}
                  fill="#fbbf24" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke"
                  style={{ filter: "drop-shadow(0 0 4px rgba(251,191,36,0.6))" }} />
              )}
            </>
          )}

          {/* X-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const t = new Date(t0 + f * (t1 - t0));
            return (
              <text key={`x${f}`} x={PAD_L + f * PW} y={H - 6} textAnchor="middle"
                className="fill-slate-400 dark:fill-slate-500" fontSize={9} fontFamily="ui-monospace,monospace">
                {fmtTimeShort(t)}
              </text>
            );
          })}
        </svg>

        {/* Tooltip */}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-slate-200/80 bg-white/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur-sm dark:border-slate-600/60 dark:bg-slate-800/95"
            style={{
              left: `${(hover.mx / W) * 100}%`,
              top: "8px",
              transform: hover.mx > W * 0.65 ? "translateX(-110%)" : "translateX(10%)",
            }}
          >
            <div className="mb-1 font-medium text-slate-600 dark:text-slate-300">{fmtTime(data[hover.idx].sampled_at)}</div>
            {data[hover.idx].rx_power != null && (
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-[#7c6dfc]" />
                <span className="text-slate-500 dark:text-slate-400">RX:</span>
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-100">{data[hover.idx].rx_power!.toFixed(1)} dBm</span>
              </div>
            )}
            {data[hover.idx].tx_power != null && (
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="text-slate-500 dark:text-slate-400">TX:</span>
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-100">{data[hover.idx].tx_power!.toFixed(1)} dBm</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BandwidthChart({ subscriber }: { subscriber: string }) {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState<SubscriberProfile["telemetry"]>([]);
  const [loading, setLoading] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ idx: number; mx: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<SubscriberProfile["telemetry"]>(
        `/subscribers/${encodeURIComponent(subscriber)}/telemetry?hours=${hours}`
      )
      .then((pts) => {
        if (alive) {
          setData(pts.filter((p) => p.rx_mbps != null || p.tx_mbps != null));
          setLoading(false);
        }
      })
      .catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [subscriber, hours]);

  const W = 760, H = 240, PAD_L = 52, PAD_R = 16, PAD_T = 12, PAD_B = 36;
  const PW = W - PAD_L - PAD_R, PH = H - PAD_T - PAD_B;
  const vals = data.flatMap((p) => [p.rx_mbps, p.tx_mbps]).filter((v): v is number => v != null);
  const lo = 0;
  const hi = vals.length > 0 ? Math.max(Math.ceil(Math.max(...vals) * 1.15), 1) : 1;
  const span = Math.max(hi - lo, 1);
  const t0 = data.length > 0 ? new Date(data[0].sampled_at).getTime() : 0;
  const t1 = data.length > 0 ? new Date(data[data.length - 1].sampled_at).getTime() : 0;

  const xOf = (i: number) =>
    data.length === 0 ? PAD_L :
    PAD_L + (t1 > t0 ? ((new Date(data[i].sampled_at).getTime() - t0) / (t1 - t0)) * PW : (i / Math.max(data.length - 1, 1)) * PW);
  const yOf = (v: number) => PAD_T + ((hi - v) / span) * PH;

  const GAP_MS = 30 * 60 * 1000;
  const buildPath = (key: "rx_mbps" | "tx_mbps") => {
    let d = "";
    let prevT: number | null = null;
    data.forEach((p, i) => {
      if (p[key] == null) return;
      const t = new Date(p.sampled_at).getTime();
      const cmd = !d || (prevT != null && t - prevT > GAP_MS) ? "M" : "L";
      d += `${cmd}${xOf(i).toFixed(1)},${yOf(p[key] as number).toFixed(1)}`;
      prevT = t;
    });
    return d;
  };

  const gridCount = 5;
  const grids = Array.from({ length: gridCount }, (_, i) => ({
    y: PAD_T + (i / (gridCount - 1)) * PH,
    val: hi - (i / (gridCount - 1)) * span,
  }));

  const handleMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect || data.length === 0) return;
      const svgX = ((e.clientX - rect.left) / rect.width) * W;
      let closest = 0;
      let minDist = Infinity;
      data.forEach((_, i) => {
        const dist = Math.abs(xOf(i) - svgX);
        if (dist < minDist) { minDist = dist; closest = i; }
      });
      setHover({ idx: closest, mx: xOf(closest) });
    },
    [data, t0, t1],
  );

  if (loading) {
    return (
      <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">Loading bandwidth data...</div>
    );
  }

  if (data.length === 0) {
    return (
      <div>
        <div className="mb-3 flex items-center justify-end gap-1">
          {ranges.map((r) => (
            <button key={`bw-${r.label}`}
              className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium ${hours === r.hours ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
              onClick={() => setHours(r.hours)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
          No bandwidth data yet.
        </div>
      </div>
    );
  }

  const lastRx = data[data.length - 1].rx_mbps;
  const lastTx = data[data.length - 1].tx_mbps;

  return (
    <div className="relative">
      {/* Time range selector + Legend */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-teal-400 shadow-[0_0_6px_rgba(45,212,191,0.5)]" />
            <span className="text-slate-500 dark:text-slate-400">RX</span>
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-100">{lastRx != null ? fmtBw(lastRx) : "\u2014"}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.5)]" />
            <span className="text-slate-500 dark:text-slate-400">TX</span>
            <span className="font-mono font-semibold text-slate-700 dark:text-slate-100">{lastTx != null ? fmtBw(lastTx) : "\u2014"}</span>
          </span>
          <span className="text-slate-400 dark:text-slate-500">{data.length} pts</span>
        </div>
        <div className="flex gap-1">
          {ranges.map((r) => (
            <button key={`bw-${r.label}`}
              className={`rounded-md px-2.5 py-0.5 text-[11px] font-medium ${hours === r.hours ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}
              onClick={() => setHours(r.hours)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative w-full overflow-hidden rounded-xl border border-slate-200/60 bg-white/50 p-2 shadow-sm backdrop-blur-sm dark:border-slate-700/40 dark:bg-slate-900/40">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full cursor-crosshair"
          preserveAspectRatio="xMidYMid meet"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <filter id="bwGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Grid */}
          {grids.map((g) => (
            <line key={g.y.toFixed(0)} x1={PAD_L} y1={g.y} x2={W - PAD_R} y2={g.y}
              stroke="currentColor" strokeOpacity={0.07} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}

          {/* Y-axis labels */}
          {grids.map((g) => (
            <text key={`l${g.y.toFixed(0)}`} x={PAD_L - 8} y={g.y + 3.5} textAnchor="end"
              className="fill-slate-400 dark:fill-slate-500" fontSize={9.5} fontFamily="ui-monospace,monospace">
              {fmtBw(g.val)}
            </text>
          ))}

          {/* Lines */}
          <path d={buildPath("rx_mbps")} fill="none" stroke="#2dd4bf" strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" filter="url(#bwGlow)" />
          <path d={buildPath("tx_mbps")} fill="none" stroke="#fb923c" strokeWidth={2}
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" filter="url(#bwGlow)" />

          {/* Hover crosshair */}
          {hover && (
            <>
              <line x1={hover.mx} y1={PAD_T} x2={hover.mx} y2={PAD_T + PH}
                stroke="currentColor" strokeOpacity={0.2} strokeWidth={1} strokeDasharray="3,3" vectorEffect="non-scaling-stroke" />
              {data[hover.idx].rx_mbps != null && (
                <circle cx={xOf(hover.idx)} cy={yOf(data[hover.idx].rx_mbps!)} r={4.5}
                  fill="#2dd4bf" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke"
                  style={{ filter: "drop-shadow(0 0 4px rgba(45,212,191,0.6))" }} />
              )}
              {data[hover.idx].tx_mbps != null && (
                <circle cx={xOf(hover.idx)} cy={yOf(data[hover.idx].tx_mbps!)} r={4.5}
                  fill="#fb923c" stroke="white" strokeWidth={2} vectorEffect="non-scaling-stroke"
                  style={{ filter: "drop-shadow(0 0 4px rgba(251,146,60,0.6))" }} />
              )}
            </>
          )}

          {/* X-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const t = new Date(t0 + f * (t1 - t0));
            return (
              <text key={`x${f}`} x={PAD_L + f * PW} y={H - 6} textAnchor="middle"
                className="fill-slate-400 dark:fill-slate-500" fontSize={9} fontFamily="ui-monospace,monospace">
                {fmtTimeShort(t)}
              </text>
            );
          })}
        </svg>

        {/* Tooltip */}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-slate-200/80 bg-white/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur-sm dark:border-slate-600/60 dark:bg-slate-800/95"
            style={{
              left: `${(hover.mx / W) * 100}%`,
              top: "8px",
              transform: hover.mx > W * 0.65 ? "translateX(-110%)" : "translateX(10%)",
            }}
          >
            <div className="mb-1 font-medium text-slate-600 dark:text-slate-300">{fmtTime(data[hover.idx].sampled_at)}</div>
            {data[hover.idx].rx_mbps != null && (
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                <span className="text-slate-500 dark:text-slate-400">RX:</span>
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-100">{fmtBw(data[hover.idx].rx_mbps!)}</span>
              </div>
            )}
            {data[hover.idx].tx_mbps != null && (
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                <span className="text-slate-500 dark:text-slate-400">TX:</span>
                <span className="font-mono font-semibold text-slate-700 dark:text-slate-100">{fmtBw(data[hover.idx].tx_mbps!)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function SubscriberProfilePage() {
  const { subscriber = "" } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<SubscriberProfile | null>(null);
  const [hours, setHours] = useState(168);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [form, setForm] = useState({ address: "", gps_lat: "", gps_lng: "", gps_accuracy: "", phone: "", mobile2: "", email: "", note: "", division: "", district: "", upazila: "", union_ward: "", village_area: "", post_code: "", holding_house: "", name: "", govt_id_type: "", govt_id_number: "", dob: "", landmark: "" });
  const [saving, setSaving] = useState(false);
  const [remote, setRemote] = useState<RemoteAccess | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const { role } = useUserRole();
  const opsOk = canOps(role);
  const [acsDevice, setAcsDevice] = useState<AcsDevice | null>(null);
  const [wifi, setWifi] = useState<AcsWifiStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [wifiForm, setWifiForm] = useState({ ssid: "", passphrase: "", enable: true, band: "2.4g" });
  const [fwUrl, setFwUrl] = useState("");
  const [wanForm, setWanForm] = useState({ ip_address: "", subnet_mask: "", default_gateway: "", dns_servers: "", username: "", password: "", addressing_type: "DHCP" });
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!profile || !profile.mikrotik_ip) {
      setRemote(null);
      return;
    }
    let alive = true;
    setRemoteLoading(true);
    api
      .get<RemoteAccess>(`/subscribers/${encodeURIComponent(subscriber)}/remote`)
      .then((r) => alive && setRemote(r))
      .catch(() => alive && setRemote(null))
      .finally(() => alive && setRemoteLoading(false));
    return () => {
      alive = false;
    };
  }, [profile?.mikrotik_ip, subscriber]);

  useEffect(() => {
    api
      .get<SubscriberProfile>(`/subscribers/${encodeURIComponent(subscriber)}?hours=${hours}`)
      .then((p) => {
        setProfile(p);
        let addr: Record<string, string> = {};
        try { addr = JSON.parse(p.address); } catch { /* plain text address */ }
        setForm({
          address: addr.full ?? p.address,
          gps_lat: p.gps_lat != null ? String(p.gps_lat) : "",
          gps_lng: p.gps_lng != null ? String(p.gps_lng) : "",
          gps_accuracy: p.gps_accuracy != null ? String(p.gps_accuracy) : "",
          phone: p.phone,
          mobile2: p.mobile2,
          email: p.email,
          note: p.note,
          division: addr.division ?? "",
          district: addr.district ?? "",
          upazila: addr.upazila ?? "",
          union_ward: addr.union_ward ?? "",
          village_area: addr.village_area ?? "",
          post_code: addr.post_code ?? "",
          holding_house: addr.holding_house ?? "",
          name: p.onu_name,
          govt_id_type: p.govt_id_type,
          govt_id_number: p.govt_id_number,
          dob: p.dob,
          landmark: p.landmark,
        });
      })
      .catch(() => setError("Subscriber not found"));
  }, [subscriber, hours]);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const runAction = async (path: string, body: unknown, okMsg: string) => {
    if (!acsDevice) return;
    setBusy(true);
    try {
      await api.post(path, body);
      flash(okMsg);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Action failed", false);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!profile?.acs_device_id) {
      setAcsDevice(null);
    } else {
      let alive = true;
      api
        .get<AcsDevice>(`/acs/devices/${profile.acs_device_id}`)
        .then((d) => alive && setAcsDevice(d))
        .catch(() => alive && setAcsDevice(null));
      return () => {
        alive = false;
      };
    }
  }, [profile?.acs_device_id]);

  useEffect(() => {
    if (!subscriber) {
      setWifi(null);
      return;
    }
    let alive = true;
    api
      .get<AcsWifiStatus>(`/subscribers/${encodeURIComponent(subscriber)}/wifi`)
      .then((w) => alive && setWifi(w))
      .catch(() => alive && setWifi(null));
    return () => {
      alive = false;
    };
  }, [subscriber]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    try {
      const lat = form.gps_lat.trim() ? Number(form.gps_lat) : null;
      const lng = form.gps_lng.trim() ? Number(form.gps_lng) : null;
      const accuracy = form.gps_accuracy.trim() ? Number(form.gps_accuracy) : null;
      if ((form.gps_lat.trim() && isNaN(lat as number)) || (form.gps_lng.trim() && isNaN(lng as number))) {
        flash("GPS coordinates must be numbers", false);
        return;
      }
      if (form.gps_accuracy.trim() && (isNaN(accuracy as number) || accuracy! < 0)) {
        flash("GPS accuracy must be a number in meters", false);
        return;
      }
      if (accuracy != null && accuracy >= 9) {
        flash("GPS accuracy must be less than 9 meters — move to an open area and re-capture.", false);
        return;
      }
      const addressJson = JSON.stringify({
        division: form.division, district: form.district, upazila: form.upazila,
        union_ward: form.union_ward, village_area: form.village_area,
        post_code: form.post_code, holding_house: form.holding_house,
        full: form.address,
      });
      await api.put(`/onus/${profile.onu_id}`, {
        name: form.name,
        address: addressJson,
        gps_lat: lat,
        gps_lng: lng,
        gps_accuracy: accuracy,
        phone: form.phone,
        mobile2: form.mobile2,
        email: form.email,
        note: form.note,
        govt_id_type: form.govt_id_type,
        govt_id_number: form.govt_id_number,
        dob: form.dob,
        landmark: form.landmark,
      });
      flash("Profile saved");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    } finally {
      setSaving(false);
    }
  };

  if (error) {
    return (
      <div className="card p-6 text-sm text-red-600 dark:text-red-400">
        {error} — <Link className="font-medium text-brand-600 dark:text-brand-400" to="/subscribers">back to subscribers</Link>
      </div>
    );
  }
  if (!profile) {
    return <div className="p-6 text-sm text-slate-400">Loading profile…</div>;
  }

  const connected = profile.status === "pppoe" || (profile.bound && profile.state === "active");

  return (
    <div className="space-y-4">
      {notice && <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />}

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/subscribers" className="mr-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">←</Link>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">{profile.subscriber}</h1>
        <StatusBadge status={profile.status} />
        {profile.last_seen && <span className="text-xs text-slate-400">last seen {fmtTimeShort(profile.last_seen)}</span>}
      </div>

      {/* ── Info strip ── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
        <span><span className="text-slate-400">OLT</span> <span className="font-medium">{profile.olt_name}</span> <span className="font-mono text-slate-400">{profile.pon_port || "—"}</span></span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span className="font-mono font-medium">{profile.last_mac || "—"}</span>
        {profile.mac_vendor && <span className="text-[10px] font-semibold uppercase text-brand-600 dark:text-brand-400">{profile.mac_vendor}</span>}
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>S/N <span className="font-mono">{profile.serial || "—"}</span></span>
        {profile.mikrotik_ip && <><span className="text-slate-300 dark:text-slate-600">|</span> <span>MikroTik <span className="font-mono">{profile.mikrotik_ip}</span></span></>}
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{profile.mac_history.length}× MAC changes</span>
        {profile.down_reason && <><span className="text-slate-300 dark:text-slate-600">|</span> <span className="text-amber-600 dark:text-amber-400">dereg: {profile.down_reason}</span></>}
      </div>

      {/* ── Charts ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Optical Power</div>
          <OpticalChart subscriber={subscriber} />
        </div>
        <div className="card p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Bandwidth (SNMP)</div>
          <BandwidthChart subscriber={subscriber} />
        </div>
      </div>

      {/* ── Remote + ACS + WiFi ── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <div className="card p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Remote Access</div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-medium text-slate-800 dark:text-slate-100">{profile.mikrotik_ip || "—"}</span>
            {remote?.reachable && remote.url ? <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">reachable</span> : remoteLoading ? <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">checking…</span> : profile.mikrotik_ip ? <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">unreachable</span> : null}
          </div>
          {remote?.reachable && (
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-500">
              {remote.ports.filter((p) => p.open).map((p) => <span key={`${p.scheme}-${p.port}`} className="rounded bg-slate-100 px-1 py-0.5 font-mono dark:bg-slate-800">{p.scheme}:{p.port}</span>)}
            </div>
          )}
          <div className="mt-2">
            {remote?.reachable && remote.url ? <button className="btn-primary w-full py-1 text-xs" onClick={() => window.open(remote.url, "_blank", "noopener,noreferrer")}>Open remote ↗</button> : <span className="text-[11px] text-slate-400">{profile.mikrotik_ip ? "No ports 8080/80/443/8443 responded" : "No PPPoE IP"}</span>}
          </div>
        </div>

        <div className="card p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">ACS Router</div>
          {acsDevice ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className={`badge ${acsDevice.online ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>{acsDevice.online ? "Online" : "Offline"}</span>
              </div>
              <div className="mt-1 text-sm font-medium text-slate-800 dark:text-slate-100">{acsDevice.model_name || acsDevice.product_class || acsDevice.serial_number}</div>
              <div className="text-[11px] text-slate-500">
                <span className="font-mono">{acsDevice.serial_number}</span>
                {acsDevice.ip && <span className="ml-1.5 font-mono">{acsDevice.ip}</span>}
                {acsDevice.last_inform && <span className="ml-1.5">inform {fmtTimeShort(acsDevice.last_inform)}</span>}
              </div>
            </>
          ) : <div className="text-xs text-slate-400">{profile.acs_device_id ? "Loading…" : "No TR-069 router"}</div>}
          <div className="mt-2 flex gap-1.5">
            <button className="btn-secondary flex-1 py-1 text-xs" onClick={() => navigate(profile.acs_device_id ? `/acs?device=${profile.acs_device_id}` : "/acs")}>ACS ↗</button>
            <button className="btn-secondary border-rose-300 py-1 text-xs text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950" disabled={busy || !acsDevice} onClick={() => { if (confirm(`Reboot ${acsDevice?.model_name || acsDevice?.serial_number}?`)) runAction(`/acs/devices/${acsDevice!.id}/reboot`, {}, "Reboot queued"); }}>Reboot</button>
          </div>
        </div>

        <div className="card p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">WiFi</div>
          {wifi && wifi.supported ? (
            <div className="space-y-1.5">
              {wifi.bands.map((b) => {
                const label = b.band === "2.4g" ? "2.4G" : b.band === "5g" ? "5G" : b.band === "5g2" ? "5G²" : b.band;
                return (
                  <div key={b.instance} className="flex items-center justify-between gap-1 text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-300">{label}</span>
                    <span className={`badge text-[10px] ${b.enable ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>{b.enable ? "ON" : "OFF"}</span>
                    <span className="font-mono text-slate-600 dark:text-slate-300 truncate">{b.ssid || "—"}</span>
                    <span className="font-mono text-[10px] text-slate-400 truncate">{b.passphrase || "—"}</span>
                  </div>
                );
              })}
            </div>
          ) : <div className="text-xs text-slate-400">{wifi?.summary || "No WiFi info"}</div>}
          {acsDevice && opsOk && (
            <div className="mt-2"><button className="btn-secondary w-full py-1 text-xs" onClick={() => setShowAdvanced((s) => !s)}>{showAdvanced ? "Hide" : "WiFi / WAN / Firmware"}</button></div>
          )}
        </div>

        {/* ── MAC History ── */}
        <div className="card p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">MAC History</div>
          {profile.mac_history.length === 0 ? (
            <div className="text-xs text-slate-400">No MAC changes yet.</div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {profile.mac_history.slice(0, 10).map((m, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="font-mono text-slate-700 dark:text-slate-200">{m.mac}</span>
                  {m.mac_vendor && <span className="text-[9px] font-semibold uppercase text-brand-600 dark:text-brand-400 truncate max-w-[60px]">{m.mac_vendor}</span>}
                  <span className="text-[10px] text-slate-400 whitespace-nowrap">{fmtTimeShort(m.changed_at)}</span>
                </div>
              ))}
              {profile.mac_history.length > 10 && <div className="text-[10px] text-slate-400">+{profile.mac_history.length - 10} more</div>}
            </div>
          )}
        </div>
      </div>

      {/* ── Advanced: WiFi change + WAN + Firmware (collapsed) ── */}
      {showAdvanced && acsDevice && opsOk && (
        <div className="card p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">WiFi Password Change</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input className="input" placeholder="SSID (optional)" value={wifiForm.ssid} onChange={(e) => setWifiForm({ ...wifiForm, ssid: e.target.value })} />
            <input className="input" placeholder="New passphrase (min 8)" value={wifiForm.passphrase} onChange={(e) => setWifiForm({ ...wifiForm, passphrase: e.target.value })} />
            <select className="input" value={wifiForm.band} onChange={(e) => setWifiForm({ ...wifiForm, band: e.target.value })}>
              <option value="2.4g">2.4 GHz</option><option value="5g">5 GHz</option><option value="5g2">5 GHz (2nd)</option><option value="all">All bands</option>
            </select>
            <button className="btn-primary" disabled={busy || wifiForm.passphrase.length < 8} onClick={() => runAction(`/acs/devices/${acsDevice.id}/wifi`, { ssid: wifiForm.ssid || null, passphrase: wifiForm.passphrase, enable: wifiForm.enable, band: wifiForm.band }, "WiFi change queued")}>Push WiFi</button>
          </div>
          <div className="h-px bg-slate-200 dark:bg-slate-700" />
          <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">WAN &amp; Firmware (Careful!)</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <input className="input" placeholder="IP address" value={wanForm.ip_address} onChange={(e) => setWanForm({ ...wanForm, ip_address: e.target.value })} />
            <input className="input" placeholder="Subnet mask" value={wanForm.subnet_mask} onChange={(e) => setWanForm({ ...wanForm, subnet_mask: e.target.value })} />
            <input className="input" placeholder="Gateway" value={wanForm.default_gateway} onChange={(e) => setWanForm({ ...wanForm, default_gateway: e.target.value })} />
            <input className="input" placeholder="DNS" value={wanForm.dns_servers} onChange={(e) => setWanForm({ ...wanForm, dns_servers: e.target.value })} />
            <input className="input" placeholder="PPPoE user" value={wanForm.username} onChange={(e) => setWanForm({ ...wanForm, username: e.target.value })} />
            <input className="input" placeholder="PPPoE pass" value={wanForm.password} onChange={(e) => setWanForm({ ...wanForm, password: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input flex-1 font-mono" placeholder="Firmware URL http(s)://…/firmware.bin" value={fwUrl} onChange={(e) => setFwUrl(e.target.value)} />
            <button className="btn-primary" disabled={busy || !/^https?:\/\//.test(fwUrl)} onClick={() => runAction(`/acs/devices/${acsDevice.id}/firmware`, { url: fwUrl }, "Firmware download queued")}>Firmware</button>
            <button className="btn-primary" disabled={busy} onClick={() => runAction(`/acs/devices/${acsDevice.id}/wan`, { ip_address: wanForm.ip_address || null, subnet_mask: wanForm.subnet_mask || null, default_gateway: wanForm.default_gateway || null, dns_servers: wanForm.dns_servers || null, username: wanForm.username || null, password: wanForm.password || null }, "WAN config queued")}>Push WAN</button>
          </div>
        </div>
      )}

      {/* ── Contact & Location ── */}
      <div className="card p-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Contact &amp; Location</div>
        <form onSubmit={save} className="space-y-2.5">
          {/* Row 1: Personal info */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <div><label className="label">Name <span className="text-rose-500">*</span></label><input className="input text-xs" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" /></div>
            <div><label className="label">Mobile 1 <span className="text-rose-500">*</span></label><input className="input text-xs" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+8801…" /></div>
            <div><label className="label">Mobile 2</label><input className="input text-xs" value={form.mobile2} onChange={(e) => setForm({ ...form, mobile2: e.target.value })} placeholder="+8801…" /></div>
            <div>
              <label className="label">Govt ID Type <span className="text-rose-500">*</span></label>
              <select className="input text-xs" required value={form.govt_id_type} onChange={(e) => setForm({ ...form, govt_id_type: e.target.value })}>
                <option value="">Select</option><option value="NID">NID (জাতীয় পরিচয়পত্র)</option><option value="DL">DL (ড্রাইভিং লাইসেন্স)</option><option value="PP">Passport (পাসপোর্ট)</option>
              </select>
            </div>
            <div><label className="label">Govt ID No. <span className="text-rose-500">*</span></label><input className="input text-xs" required value={form.govt_id_number} onChange={(e) => setForm({ ...form, govt_id_number: e.target.value })} placeholder="NID / DL / PP number" /></div>
          </div>

          {/* Row 2: DOB + Landmark + Email */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <div><label className="label">Date of Birth</label><input className="input text-xs" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></div>
            <div><label className="label">Landmark</label><input className="input text-xs" value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} placeholder="Near mosque / school / market" /></div>
            <div><label className="label">Email</label><input className="input text-xs" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" /></div>
          </div>

          {/* Row3: Bangladeshi address hierarchy */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
            <div><label className="label">Division</label><input className="input text-xs" value={form.division} onChange={(e) => setForm({ ...form, division: e.target.value })} placeholder="Dhaka" /></div>
            <div><label className="label">District</label><input className="input text-xs" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="Dhaka" /></div>
            <div><label className="label">Upazila</label><input className="input text-xs" value={form.upazila} onChange={(e) => setForm({ ...form, upazila: e.target.value })} placeholder="Mirpur" /></div>
            <div><label className="label">Union / Ward</label><input className="input text-xs" value={form.union_ward} onChange={(e) => setForm({ ...form, union_ward: e.target.value })} placeholder="Ward 12" /></div>
            <div><label className="label">Village / Area</label><input className="input text-xs" value={form.village_area} onChange={(e) => setForm({ ...form, village_area: e.target.value })} placeholder="Mirpur-10" /></div>
            <div><label className="label">Post Code</label><input className="input text-xs font-mono" value={form.post_code} onChange={(e) => setForm({ ...form, post_code: e.target.value })} placeholder="1216" /></div>
            <div><label className="label">Holding / House</label><input className="input text-xs" value={form.holding_house} onChange={(e) => setForm({ ...form, holding_house: e.target.value })} placeholder="Holding 12" /></div>
          </div>

          {/* Row4: Full address + GPS */}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
            <div className="lg:col-span-2"><label className="label">Full Address</label><input className="input text-xs" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Holding 12, Road 5, Block C, Mirpur-10, Dhaka-1216" /></div>
            <div><label className="label">GPS lat</label><input className="input font-mono text-xs" value={form.gps_lat} onChange={(e) => setForm({ ...form, gps_lat: e.target.value })} placeholder="23.8103" /></div>
            <div><label className="label">GPS lng</label><input className="input font-mono text-xs" value={form.gps_lng} onChange={(e) => setForm({ ...form, gps_lng: e.target.value })} placeholder="90.4125" /></div>
          </div>

          {/* Row5: Note + Save */}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-4">
            <div className="lg:col-span-3"><label className="label">Note</label><input className="input text-xs" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <div className="flex items-end justify-end">
              <button type="submit" className="btn-primary py-1 text-xs" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}