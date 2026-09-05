const statusBadge: Record<string, string> = {
  pppoe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  up: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  power_off: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  wire_down: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  inactive: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  offline: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  disabled: "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  unknown: "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
};

const statusLabel: Record<string, string> = {
  pppoe: "Connected",
  up: "UP (No PPPoE)",
  power_off: "Power Off",
  wire_down: "Wire Down",
  inactive: "Inactive",
  offline: "Offline",
  disabled: "Disabled",
  unknown: "Unknown",
};

export default function StatusBadge({ status }: { status: string }) {
  const key = statusBadge[status] ? status : "unknown";
  return (
    <span className={`badge ${statusBadge[key]}`} title={statusLabel[status]}>
      {statusLabel[key] || status}
    </span>
  );
}
