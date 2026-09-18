const tagColors: Record<string, string> = {
  multi: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  suspect: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const tagLabels: Record<string, string> = {
  multi: "Multi Router",
  suspect: "Suspect",
};

export default function TagBadge({ tag }: { tag: string }) {
  if (!tag) return null;
  const tags = tag.split(",").map((t) => t.trim()).filter(Boolean);
  if (tags.length === 0) return null;
  return (
    <span className="inline-flex gap-1">
      {tags.map((t) => (
        <span
          key={t}
          className={`badge text-[10px] font-semibold ${tagColors[t] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}
          title={tagLabels[t] || t}
        >
          {tagLabels[t] || t}
        </span>
      ))}
    </span>
  );
}
