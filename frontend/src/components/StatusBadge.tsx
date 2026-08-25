const statusBadge: Record<string, string> = {
  pppoe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  up: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  power_off: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  wire_down: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  inactive: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  offline: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  unknown: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

const statusLabel: Record<string, string> = {
  pppoe: "PPPoE connected",
  up: "UP",
  power_off: "power off",
  wire_down: "wire down",
  inactive: "inactive",
  offline: "offline",
  unknown: "unknown",
};

export default function StatusBadge({ status }: { status: string }) {
  const key = statusBadge[status] ? status : "unknown";
  return (
    <span className={`badge ${statusBadge[key]}`} title={statusLabel[status]}>
      {statusLabel[key] || status}
    </span>
  );
}