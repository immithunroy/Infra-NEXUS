interface CapsuleToggleProps {
  leftLabel: string;
  rightLabel: string;
  activeRight: boolean;
  onToggle: (activeRight: boolean) => void;
  loading?: boolean;
  disabled?: boolean;
  activeColor?: string;
  className?: string;
}

export default function CapsuleToggle({
  leftLabel,
  rightLabel,
  activeRight,
  onToggle,
  loading = false,
  disabled = false,
  activeColor = "emerald",
  className = "",
}: CapsuleToggleProps) {
  const colors: Record<string, { bg: string; border: string; knob: string }> = {
    emerald: {
      bg: "bg-emerald-500 dark:bg-emerald-600",
      border: "border-emerald-300 dark:border-emerald-600",
      knob: "",
    },
    red: {
      bg: "bg-red-500 dark:bg-red-600",
      border: "border-red-300 dark:border-red-600",
      knob: "",
    },
  };
  const c = colors[activeColor] || colors.emerald;

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={() => onToggle(!activeRight)}
      className={`relative inline-flex h-8 w-[75px] items-center rounded-full border transition-colors duration-200 ${
        activeRight
          ? `${c.bg} ${c.border}`
          : "border-slate-300 bg-slate-300 dark:border-slate-600 dark:bg-slate-600"
      } ${disabled || loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${className}`}
    >
      <span className={`absolute left-2 text-[10px] font-semibold leading-none transition-colors duration-200 ${!activeRight ? "text-white" : "text-emerald-700 dark:text-emerald-200"}`}>
        {leftLabel}
      </span>
      <span className={`absolute right-2 text-[10px] font-semibold leading-none transition-colors duration-200 ${activeRight ? "text-white" : "text-slate-500 dark:text-slate-300"}`}>
        {rightLabel}
      </span>
      <span
        className={`absolute top-[3px] h-[25px] w-[25px] rounded-full bg-white shadow transition-all duration-200 ease-in-out ${
          activeRight ? "left-[calc(100%-28px)]" : "left-[3px]"
        }`}
      >
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
          </span>
        )}
      </span>
    </button>
  );
}
