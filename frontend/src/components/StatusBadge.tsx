const statusBadge: Record<string, string> = {
  connected: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  pppoe: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  up: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  power_off: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  wire_down: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  inactive: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  offline: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  disconnected: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  disabled: "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  unknown: "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400",
  no_onu: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
};

const statusLabel: Record<string, string> = {
  connected: "Connected",
  pppoe: "Connected",
  up: "UP (No PPPoE)",
  power_off: "Power Off",
  wire_down: "Wire Down",
  inactive: "Inactive",
  offline: "Offline",
  disconnected: "Disconnected",
  disabled: "Disabled",
  unknown: "Unknown",
  no_onu: "No ONU",
};

export default function StatusBadge({ status }: { status: string }) {
  const key = statusBadge[status] ? status : "unknown";
  return (
    <span className={`badge ${statusBadge[key]}`} title={statusLabel[status]}>
      {statusLabel[key] || status}
    </span>
  );
}
