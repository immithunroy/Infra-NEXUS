import { useState } from "react";

export const PAGE_SIZE = 50;

export function usePagination<T>(items: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(Math.ceil(items.length / pageSize), 1);
  const current = Math.min(page, totalPages - 1);
  const slice = items.slice(current * pageSize, (current + 1) * pageSize);
  return { page: current, setPage, totalPages, slice, total: items.length, pageSize };
}

export function Pagination({
  page,
  setPage,
  totalPages,
  total,
  pageSize,
  top = false,
}: {
  page: number;
  setPage: (p: number) => void;
  totalPages: number;
  total: number;
  pageSize: number;
  top?: boolean;
}) {
  if (totalPages <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm text-slate-500 dark:text-slate-400 ${
        top
          ? "border-b border-slate-200 dark:border-slate-700"
          : "border-t border-slate-200 dark:border-slate-700"
      }`}
    >
      <span>
        Showing {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <button className="btn-ghost px-2" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ← Prev
        </button>
        <span className="px-2 py-1 text-xs">
          {page + 1} / {totalPages}
        </span>
        <button className="btn-ghost px-2" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
          Next →
        </button>
      </div>
    </div>
  );
}