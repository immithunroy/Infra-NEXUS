import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { RemoteAccess } from "../api/types";

/**
 * Small remote-access indicator + one-click open.
 *
 * Probes the given IP(s) against the common management ports (8080/80/443/8443)
 * and shows either a green "accessible remotely" link (click to open) or a muted
 * "not reachable" state. Probing is cached server-side for ~1 minute.
 */

function openLink(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function RemoteAccessButton({
  ip,
  label,
  className = "",
}: {
  ip: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "ready">("idle");
  const [result, setResult] = useState<RemoteAccess | null>(null);
  const [error, setError] = useState("");
  const ipRef = useRef(ip);

  useEffect(() => {
    ipRef.current = ip;
    if (!ip) {
      setState("idle");
      setResult(null);
      return;
    }
    let alive = true;
    setState("loading");
    setError("");
    api
      .post<{ results: Record<string, RemoteAccess> }>("/subscribers/remote/probe", { ips: [ip] })
      .then((r) => {
        if (!alive) return;
        setResult(r.results[ip] || null);
        setState("ready");
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e));
        setState("ready");
      });
    return () => {
      alive = false;
    };
  }, [ip]);

  if (!ip) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-slate-400 ${className}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
        no IP
      </span>
    );
  }

  if (state === "loading") {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-slate-400 ${className}`}>
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" />
        probing…
      </span>
    );
  }

  if (result?.reachable && result.url) {
    return (
      <button
        type="button"
        title={`Open ${result.url}`}
        className={`inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 ${className}`}
        onClick={() => openLink(result.url)}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        {label || `Open :${result.url.split(":").pop()}`}
      </button>
    );
  }

  if (error) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 ${className}`} title={error}>
        ⚠ check failed
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs text-slate-400 ${className}`} title="None of 8080/80/443/8443 answered">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
      not reachable
    </span>
  );
}
