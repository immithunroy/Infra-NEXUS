export default function MacCell({
  mac,
  vendor,
  className = "",
}: {
  mac: string;
  vendor?: string;
  className?: string;
}) {
  if (!mac) {
    return <span className="text-slate-400">—</span>;
  }
  return (
    <span className={className}>
      <span className="font-mono text-xs">{mac}</span>
      {vendor ? (
        <span className="mt-0.5 block font-semibold uppercase tracking-wide text-[10px] text-brand-600 dark:text-brand-400">
          {vendor}
        </span>
      ) : null}
    </span>
  );
}