"""Restore the original SubscriberProfile.tsx by reversing the specific edits made."""
import re

with open('C:/projects/olt-commander/frontend/src/pages/SubscriberProfile.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Revert 1: Import change
content = content.replace(
    'import { FormEvent, useEffect, useRef, useState } from "react";',
    'import { FormEvent, useEffect, useState } from "react";'
)

# Revert 2: Restore original OpticalChart
optical_start = content.find('function OpticalChart(')
optical_end = content.find('function BandwidthChart(')

original_optical = '''function OpticalChart({ points }: { points: SubscriberProfile["telemetry"] }) {
  const data = points.filter((p) => p.rx_power != null || p.tx_power != null);
  if (data.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
        No optical telemetry yet — the collector samples RX/TX power every 5 minutes.
      </div>
    );
  }
  const W = 760;
  const H = 220;
  const PAD = 10;
  const vals = data.flatMap((p) => [p.rx_power, p.tx_power]).filter((v): v is number => v != null);
  const lo = Math.floor(Math.min(...vals));
  const hi = Math.ceil(Math.max(...vals));
  const span = Math.max(hi - lo, 1);
  const t0 = new Date(data[0].sampled_at).getTime();
  const t1 = new Date(data[data.length - 1].sampled_at).getTime();

  const x = (i: number) =>
    PAD +
    (t1 > t0
      ? ((new Date(data[i].sampled_at).getTime() - t0) / (t1 - t0)) * (W - PAD * 2)
      : (i / Math.max(data.length - 1, 1)) * (W - PAD * 2));
  const y = (v: number) => PAD + ((hi - v) / span) * (H - PAD * 2);

  // Break the line when samples are >30 min apart (ONU stopped reporting).
  const GAP_MS = 30 * 60 * 1000;
  const buildPath = (key: "rx_power" | "tx_power") => {
    let d = "";
    let prevT: number | null = null;
    data.forEach((p, i) => {
      if (p[key] == null) return;
      const t = new Date(p.sampled_at).getTime();
      const cmd = !d || (prevT != null && t - prevT > GAP_MS) ? "M" : "L";
      d += `${cmd}${x(i).toFixed(1)},${y(p[key] as number).toFixed(1)}`;
      prevT = t;
    });
    return d;
  };

  const grids = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD + f * (H - PAD * 2),
    val: (hi - f * span).toFixed(0),
  }));

  const lastRx = data[data.length - 1].rx_power;
  const lastTx = data[data.length - 1].tx_power;
  const plotTopPct = (PAD / H) * 100;
  const plotBotPct = (1 - PAD / H) * 100;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-brand-500" /> RX
          <span className="font-mono text-slate-700 dark:text-slate-200">{lastRx != null ? `${lastRx.toFixed(1)} dBm` : "\\u2014"}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-amber-500" /> TX
          <span className="font-mono text-slate-700 dark:text-slate-200">{lastTx != null ? `${lastTx.toFixed(1)} dBm` : "\\u2014"}</span>
        </span>
        <span className="ml-auto text-slate-400">{data.length} samples</span>
      </div>
      <div className="relative w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
          {grids.map((g) => (
            <line
              key={g.val}
              x1={PAD}
              y1={g.y}
              x2={W - PAD}
              y2={g.y}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={buildPath("rx_power")}
            fill="none"
            stroke="#6d5efc"
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={buildPath("tx_power")}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div
          className="pointer-events-none absolute inset-x-0 flex flex-col justify-between text-[10px] font-medium text-slate-400 dark:text-slate-500"
          style={{ top: `${plotTopPct}%`, bottom: `${plotBotPct}%` }}
        >
          {grids.map((g) => (
            <div key={g.val} className="flex items-center justify-between">
              <span>{g.val}</span>
              <span>{g.val}</span>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-1 text-[10px] text-slate-400 dark:text-slate-500">
          <span>{fmtTimeShort(data[0].sampled_at)}</span>
          <span>{fmtTimeShort(data[data.length - 1].sampled_at)}</span>
        </div>
      </div>
    </div>
  );
}

'''

content = content[:optical_start] + original_optical + content[optical_end:]

# Revert 3: Restore original BandwidthChart
bw_start = content.find('function BandwidthChart(')
bw_end = content.find('export default function SubscriberProfilePage')

original_bandwidth = '''function BandwidthChart({ points }: { points: SubscriberProfile["telemetry"] }) {
  const data = points.filter((p) => p.rx_mbps != null || p.tx_mbps != null);
  if (data.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
        No bandwidth data yet — byte counters are sampled every 5 minutes.
      </div>
    );
  }
  const W = 760;
  const H = 220;
  const PAD = 10;
  const vals = data.flatMap((p) => [p.rx_mbps, p.tx_mbps]).filter((v): v is number => v != null);
  const lo = 0;
  const hi = Math.max(Math.ceil(Math.max(...vals)), 1);
  const span = Math.max(hi - lo, 1);
  const t0 = new Date(data[0].sampled_at).getTime();
  const t1 = new Date(data[data.length - 1].sampled_at).getTime();

  const x = (i: number) =>
    PAD +
    (t1 > t0
      ? ((new Date(data[i].sampled_at).getTime() - t0) / (t1 - t0)) * (W - PAD * 2)
      : (i / Math.max(data.length - 1, 1)) * (W - PAD * 2));
  const y = (v: number) => PAD + ((hi - v) / span) * (H - PAD * 2);

  // Break the line when samples are >30 min apart (ONU stopped reporting).
  const GAP_MS = 30 * 60 * 1000;
  const buildPath = (key: "rx_mbps" | "tx_mbps") => {
    let d = "";
    let prevT: number | null = null;
    data.forEach((p, i) => {
      if (p[key] == null) return;
      const t = new Date(p.sampled_at).getTime();
      const cmd = !d || (prevT != null && t - prevT > GAP_MS) ? "M" : "L";
      d += `${cmd}${x(i).toFixed(1)},${y(p[key] as number).toFixed(1)}`;
      prevT = t;
    });
    return d;
  };

  const grids = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD + f * (H - PAD * 2),
    val: (hi - f * span).toFixed(0),
  }));

  const lastRx = data[data.length - 1].rx_mbps;
  const lastTx = data[data.length - 1].tx_mbps;
  const plotTopPct = (PAD / H) * 100;
  const plotBotPct = (1 - PAD / H) * 100;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-teal-500" /> RX
          <span className="font-mono text-slate-700 dark:text-slate-200">{lastRx != null ? fmtBw(lastRx) : "\\u2014"}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded bg-orange-500" /> TX
          <span className="font-mono text-slate-700 dark:text-slate-200">{lastTx != null ? fmtBw(lastTx) : "\\u2014"}</span>
        </span>
        <span className="ml-auto text-slate-400">{data.length} samples</span>
      </div>
      <div className="relative w-full">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
          {grids.map((g) => (
            <line
              key={g.val}
              x1={PAD}
              y1={g.y}
              x2={W - PAD}
              y2={g.y}
              stroke="currentColor"
              strokeOpacity={0.08}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={buildPath("rx_mbps")}
            fill="none"
            stroke="#14b8a6"
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={buildPath("tx_mbps")}
            fill="none"
            stroke="#f97316"
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div
          className="pointer-events-none absolute inset-x-0 flex flex-col justify-between text-[10px] font-medium text-slate-400 dark:text-slate-500"
          style={{ top: `${plotTopPct}%`, bottom: `${plotBotPct}%` }}
        >
          {grids.map((g) => (
            <div key={g.val} className="flex items-center justify-between">
              <span>{g.val}</span>
              <span>{g.val}</span>
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-1 text-[10px] text-slate-400 dark:text-slate-500">
          <span>{fmtTimeShort(data[0].sampled_at)}</span>
          <span>{fmtTimeShort(data[data.length - 1].sampled_at)}</span>
        </div>
      </div>
    </div>
  );
}

'''

content = content[:bw_start] + original_bandwidth + content[bw_end:]

with open('C:/projects/olt-commander/frontend/src/pages/SubscriberProfile.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Restored original SubscriberProfile.tsx')
