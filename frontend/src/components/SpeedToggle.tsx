interface SpeedToggleProps {
  value: string;
  leftLabel: string;
  rightLabel: string;
  leftValue: string;
  rightValue: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export default function SpeedToggle({
  value,
  leftLabel,
  rightLabel,
  leftValue,
  rightValue,
  onChange,
  disabled = false,
  loading = false,
  className = "",
}: SpeedToggleProps) {
  const isRight = value === rightValue;

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={() => onChange(isRight ? leftValue : rightValue)}
      className={`group relative inline-flex h-8 w-[75px] items-center rounded-full border transition-colors duration-200 ${
        isRight
          ? "border-emerald-300 bg-emerald-500 dark:border-emerald-600 dark:bg-emerald-600"
          : "border-slate-300 bg-slate-300 dark:border-slate-600 dark:bg-slate-600"
      } ${disabled || loading ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${className}`}
    >
      {/* Labels */}
      <span className={`absolute left-2 text-[10px] font-semibold transition-colors duration-200 ${!isRight ? "text-white" : "text-emerald-700 dark:text-emerald-200"}`}>
        {leftLabel}
      </span>
      <span className={`absolute right-2 text-[10px] font-semibold transition-colors duration-200 ${isRight ? "text-white" : "text-slate-500 dark:text-slate-300"}`}>
        {rightLabel}
      </span>

      {/* Knob */}
      <span
        className={`absolute top-[3px] h-[25px] w-[25px] rounded-full bg-white shadow-md transition-all duration-200 ease-in-out ${
          isRight ? "left-[calc(100%-28px)]" : "left-[3px]"
        }`}
      >
        {loading && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="h-2 w-2 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
          </span>
        )}
      </span>
    </button>
  );
}
