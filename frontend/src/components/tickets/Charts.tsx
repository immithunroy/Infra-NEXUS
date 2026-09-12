export function BarChart({
  data,
  title,
  maxBars = 8,
}: {
  data: { label: string; count: number }[];
  title: string;
  maxBars?: number;
}) {
  if (!data.length) {
    return (
      <div className="card p-4">
        <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
        <p className="text-sm text-slate-400">No data</p>
      </div>
    );
  }
  const sorted = [...data].sort((a, b) => b.count - a.count).slice(0, maxBars);
  const max = Math.max(...sorted.map((d) => d.count), 1);
  return (
    <div className="card p-4">
      <p className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
      <div className="space-y-2">
        {sorted.map((d) => (
          <div key={d.label} className="flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-xs text-slate-600 dark:text-slate-400" title={d.label}>
              {d.label}
            </span>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
              <div
                className="absolute inset-y-0 left-0 rounded bg-brand-500/80 dark:bg-brand-400/60"
                style={{ width: `${(d.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right text-xs font-medium text-slate-700 dark:text-slate-300">{d.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SparkLine({ values, color = "brand" }: { values: number[]; color?: string }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const h = 32;
  const w = 120;
  const step = w / Math.max(values.length - 1, 1);
  const points = values.map((v, i) => `${i * step},${h - (v / max) * h}`).join(" ");
  const fillPoints = `0,${h} ${points} ${w},${h}`;
  const colors: Record<string, string> = {
    brand: "#6366f1",
    emerald: "#10b981",
    rose: "#f43f5e",
    amber: "#f59e0b",
  };
  return (
    <svg width={w} height={h} className="block">
      <polygon points={fillPoints} fill={colors[color] || colors.brand} fillOpacity={0.15} />
      <polyline points={points} fill="none" stroke={colors[color] || colors.brand} strokeWidth={1.5} />
    </svg>
  );
}
