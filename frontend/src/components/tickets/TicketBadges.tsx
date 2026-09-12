export function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    open: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    in_progress: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    resolved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    closed: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  return <span className={`badge ${cls[status] || cls.open}`}>{status.replace("_", " ")}</span>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  const cls: Record<string, string> = {
    low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    normal: "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
    high: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    urgent: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  };
  return <span className={`badge ${cls[priority] || cls.normal}`}>{priority}</span>;
}

export function CategoryBadge({ category }: { category: string }) {
  if (!category) return null;
  const cls: Record<string, string> = {
    installation: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    repair: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
    complaint: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    maintenance: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
    billing: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    inquiry: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  };
  return <span className={`badge ${cls[category] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>{category}</span>;
}
