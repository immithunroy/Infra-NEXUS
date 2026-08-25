import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { SearchResult } from "../api/types";
import StatusBadge from "./StatusBadge";

export default function GlobalSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .get<SearchResult>(`/search?q=${encodeURIComponent(term)}`)
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const goOnu = (o: SearchResult["onus"][number]) => {
    setOpen(false);
    setQ("");
    if (o.subscriber) {
      navigate(`/subscribers/${encodeURIComponent(o.subscriber)}`);
    } else {
      navigate(`/onus?search=${encodeURIComponent(o.pon_port || o.name || o.serial)}`);
    }
  };

  const goDevices = () => {
    setOpen(false);
    setQ("");
    navigate("/devices");
  };

  const total = results ? results.onus.length + results.olts.length + results.mikrotiks.length : 0;

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <div className="relative">
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          className="input pl-9"
          placeholder="Search ONUs, subscribers, MACs, devices..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (results && q.trim().length >= 2) setOpen(true); }}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        />
      </div>

      {open && results && (
        <div className="absolute z-40 mt-2 max-h-96 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {total > 0 ? (
            <>
              {results.onus.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    ONUs ({results.onus.length})
                  </div>
                  {results.onus.slice(0, 8).map((o) => (
                    <button
                      key={o.id}
                      onClick={() => goOnu(o)}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {o.name || o.subscriber || "—"}
                        </span>
                        <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                          {o.pon_port || "—"} · {o.olt_name}
                        </span>
                        {o.last_mac && (
                          <span className="block truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">
                            {o.last_mac}
                            {o.mac_vendor ? (
                              <span className="ml-1.5 font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                                {o.mac_vendor}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0"><StatusBadge status={o.status} /></span>
                    </button>
                  ))}
                  {results.onus.length > 8 && (
                    <div className="px-3 py-1.5 text-xs text-slate-400">{results.onus.length - 8} more matches…</div>
                  )}
                </div>
              )}
              {(results.olts.length > 0 || results.mikrotiks.length > 0) && (
                <div className="border-t border-slate-100 py-1 dark:border-slate-800">
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Devices
                  </div>
                  {[...results.olts, ...results.mikrotiks].map((d) => (
                    <button
                      key={`${d.kind}-${d.id}`}
                      onClick={goDevices}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{d.name}</span>
                        <span className="block truncate font-mono text-xs text-slate-500 dark:text-slate-400">{d.ip}</span>
                      </span>
                      <span className="badge shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">{d.kind}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="px-3 py-3 text-sm text-slate-500 dark:text-slate-400">No results for “{q}”</div>
          )}
        </div>
      )}
    </div>
  );
}