import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { canOps, canWrite, DownEvent, DownStatus, OLTDevice, Outage, PortArea } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import ActionResultBanner from "../components/ActionResultBanner";
import WarningBanner from "../components/WarningBanner";
import { Pagination, usePagination } from "../components/Pagination";
import { useUserRole } from "../lib/role";
import { fmtTime, fmtTimeShort } from "../lib/time";

const kindBadge: Record<string, string> = {
  down: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  recovery: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  outage: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
};

const reasonBadge: Record<string, string> = {
  "power-off": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  "wire-down": "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "mpcp-down": "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  "oam-down": "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  "illegal-mac": "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "llid-admin-down": "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

function fmtDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function KindBadge({ kind }: { kind: string }) {
  return <span className={`badge ${kindBadge[kind] || kindBadge.down}`}>{kind}</span>;
}

function ReasonBadge({ reason }: { reason: string }) {
  if (!reason) return <span className="text-slate-400">—</span>;
  return <span className={`badge ${reasonBadge[reason] || "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>{reason}</span>;
}

export default function LiveDowns() {
  const [searchParams] = useSearchParams();
  const { role } = useUserRole();
  const opsOk = canOps(role);
  const writeOk = canWrite(role);
  const [olts, setOlts] = useState<OLTDevice[]>([]);
  const [status, setStatus] = useState<DownStatus | null>(null);
  const [events, setEvents] = useState<DownEvent[]>([]);
  const [outages, setOutages] = useState<Outage[]>([]);
  const [ports, setPorts] = useState<string[]>([]);
  const [oltId, setOltId] = useState(searchParams.get("olt_id") || "");
  const [port, setPort] = useState(searchParams.get("port") || "");
  const [interval, setIntervalSec] = useState(30);
  const [massThreshold, setMassThreshold] = useState(5);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [kindFilter, setKindFilter] = useState("");
  const [areaOpen, setAreaOpen] = useState(false);
  const [areas, setAreas] = useState<PortArea[]>([]);
  const [areaDraft, setAreaDraft] = useState<Record<string, string>>({});
  const [areaSaving, setAreaSaving] = useState(false);
  const lastNoticeRef = useRef<string>("");

  const { page, setPage, totalPages, slice, total, pageSize } = usePagination(events);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const loadStatus = useCallback(() => {
    api.get<DownStatus>("/downs/status").then(setStatus).catch(() => undefined);
  }, []);

  const loadEvents = useCallback(() => {
    const params = new URLSearchParams();
    if (oltId) params.set("olt_id", oltId);
    if (port) params.set("port", port);
    if (kindFilter) params.set("kind", kindFilter);
    api
      .get<DownEvent[]>(`/downs/events?${params.toString()}&limit=500`)
      .then(setEvents)
      .catch(() => undefined);
  }, [oltId, port, kindFilter]);

  const loadOutages = useCallback(() => {
    api.get<Outage[]>("/downs/outages?limit=50").then(setOutages).catch(() => undefined);
  }, []);

  const loadAreas = useCallback((oid: string) => {
    api
      .get<PortArea[]>(`/downs/areas?olt_id=${oid}`)
      .then((r) => {
        setAreas(r);
        setAreaDraft(Object.fromEntries(r.map((a) => [a.port, a.label])));
      })
      .catch(() => setAreas([]));
  }, []);

  const openAreas = () => {
    if (!oltId) {
      flash("Select an OLT first", false);
      return;
    }
    loadAreas(oltId);
    setAreaOpen(true);
  };

  const saveAreas = async () => {
    setAreaSaving(true);
    try {
      for (const [p, label] of Object.entries(areaDraft)) {
        await api.put<PortArea>("/downs/areas", { olt_id: Number(oltId), port: p, label });
      }
      flash("Area labels saved");
      loadAreas(oltId);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Save failed", false);
    } finally {
      setAreaSaving(false);
    }
  };

  // Load OLTs once.
  useEffect(() => {
    api.get<OLTDevice[]>("/devices/olts").then(setOlts).catch(() => undefined);
  }, []);

  // Prefill ports when arriving with olt_id/port from the dashboard card.
  useEffect(() => {
    if (oltId) {
      api.get<{ ports: string[] }>(`/downs/ports?olt_id=${oltId}`).then((r) => setPorts(r.ports)).catch(() => undefined);
    }
  }, [oltId]);

  // Poll status + live data every 5s while running; events/outages on changes.
  useEffect(() => {
    const id = setInterval(() => {
      loadStatus();
      if (status?.running) {
        loadOutages();
      }
    }, 5000);
    return () => clearInterval(id);
  }, [loadStatus, status?.running, loadOutages]);

  useEffect(() => {
    loadEvents();
    loadOutages();
  }, [loadEvents, loadOutages]);

  // Flash when a new outage appears.
  useEffect(() => {
    const open = outages.filter((o) => !o.resolved);
    const key = open.map((o) => `${o.pon_port}:${o.onu_count}`).join("|");
    if (key && key !== lastNoticeRef.current) {
      lastNoticeRef.current = key;
      flash(`⚠ ${open.length} mass outage(s) active — ${open.map((o) => `${o.olt_name} ${o.pon_port} (${o.onu_count} ONUs)`).join(", ")}`, false);
    }
  }, [outages]);

  const loadPorts = async (oid: string) => {
    if (!oid) {
      setPorts([]);
      setPort("");
      return;
    }
    const r = await api.get<{ ports: string[] }>(`/downs/ports?olt_id=${oid}`).catch(() => ({ ports: [] as string[] }));
    setPorts(r.ports);
  };

  const onOltChange = (v: string) => {
    setOltId(v);
    setPort("");
    loadPorts(v);
  };

  const start = async () => {
    if (!oltId) {
      flash("Select an OLT first", false);
      return;
    }
    setBusy(true);
    try {
      const s = await api.post<DownStatus>("/downs/start", {
        olt_id: Number(oltId),
        port,
        interval,
        mass_threshold: massThreshold,
      });
      setStatus(s);
      flash(`Detection started on ${s.olt_name || "OLT"}${s.port ? ` (port ${s.port})` : ""}`);
      loadOutages();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Start failed", false);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await api.post("/downs/stop");
      setStatus(null);
      loadStatus();
      flash("Detection stopped");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Stop failed", false);
    } finally {
      setBusy(false);
    }
  };

  const openOutages = outages.filter((o) => !o.resolved);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Live Down Detection</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Poll an OLT via CLI every few seconds and flag ONUs going down — with the OLT's dereg reason — plus mass outages (feeder/cable cuts).
          </p>
        </div>
        <span className={`badge ${status?.running ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
          {status?.running ? "● LIVE" : "○ idle"}
        </span>
      </header>

      {notice && (
        <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />
      )}

      {/* Control card */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">OLT</label>
          <select className="input w-56" value={oltId} onChange={(e) => onOltChange(e.target.value)}>
            <option value="">Select OLT…</option>
            {olts.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.pon_type})</option>)}
          </select>
        </div>
        <div>
          <label className="label">PON Port</label>
          <select className="input w-40" value={port} onChange={(e) => setPort(e.target.value)}>
            <option value="">All ports</option>
            {ports.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Interval (s)</label>
          <input type="number" min={10} max={300} className="input w-24" value={interval} onChange={(e) => setIntervalSec(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Mass-outage ≥ ONUs</label>
          <input type="number" min={2} max={64} className="input w-24" value={massThreshold} onChange={(e) => setMassThreshold(Number(e.target.value))} />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {writeOk && (
            <button className="btn-secondary" onClick={openAreas} disabled={!oltId}>
              Area labels
            </button>
          )}
          {opsOk && (status?.running ? (
            <button className="btn-secondary border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950" onClick={stop} disabled={busy}>
              ■ Stop detection
            </button>
          ) : (
            <button className="btn-primary" onClick={start} disabled={busy}>
              ▶ Start detection
            </button>
          ))}
        </div>
      </div>

      {/* Live session info */}
      {status?.running && (
        <div className="card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <strong className="text-slate-800 dark:text-slate-100">{status.olt_name}</strong>
            {status.port && <span className="font-mono text-slate-500">{status.port}</span>}
          </span>
          <span className="text-slate-500 dark:text-slate-400">started {fmtTime(status.started_at)}</span>
          <span className="text-slate-500 dark:text-slate-400">last poll {fmtTime(status.last_poll_at)}</span>
          <span className="font-semibold text-rose-600 dark:text-rose-300">{status.current_down_count} down now</span>
          <span className="text-xs text-slate-400">polling every {status.interval}s · threshold {status.mass_threshold}</span>
          {status.last_error && <span className="ml-auto text-xs text-red-600 dark:text-red-400">error: {status.last_error}</span>}
        </div>
      )}

      {/* Mass outage banner */}
      {openOutages.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {openOutages.map((o) => (
            <div key={o.id} className="card border-rose-300 p-4 dark:border-rose-800">
              <div className="flex items-center justify-between">
                <span className="badge bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">MASS OUTAGE</span>
                <span className="text-xs text-slate-400">{fmtTimeShort(o.started_at)}</span>
              </div>
              <div className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                {o.olt_name} · <span className="font-mono">{o.pon_port}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{o.onu_count} ONUs down — possible feeder/cable cut</div>
            </div>
          ))}
        </div>
      )}

      {/* Currently down (live) */}
      <div className="card overflow-x-auto">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">
            Currently Down <span className="text-slate-400">(live)</span>
          </div>
          <span className="badge bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">{status?.current_down_count ?? 0}</span>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="th">PON Port</th>
              <th className="th">ONU ID</th>
              <th className="th">Serial</th>
              <th className="th">Reason</th>
              <th className="th">Down since</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {(status?.current_down || []).slice(0, 50).map((d) => (
              <tr key={`${d.pon_port}:${d.onu_id}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="td font-mono text-xs text-brand-700 dark:text-cyan-300">{d.pon_port}</td>
                <td className="td">{d.onu_id}</td>
                <td className="td font-mono text-xs">{d.serial || "—"}</td>
                <td className="td"><ReasonBadge reason={d.reason} /></td>
                <td className="td text-xs text-slate-500">{fmtTimeShort(d.detected_at)}</td>
              </tr>
            ))}
            {(status?.current_down || []).length === 0 && (
              <tr><td className="td text-slate-500" colSpan={5}>{status?.running ? "No ONUs currently down." : "Start detection to see live state."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Event history */}
      <div className="card overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Detection History</div>
          <div className="flex items-center gap-2">
            <select className="input w-32" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
              <option value="">All kinds</option>
              <option value="down">Down</option>
              <option value="recovery">Recovery</option>
              <option value="outage">Outage</option>
            </select>
          </div>
        </div>
        <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} top />
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="th">When</th>
              <th className="th">OLT</th>
              <th className="th">PON Port</th>
              <th className="th">ONU ID</th>
              <th className="th">Serial</th>
              <th className="th">Kind</th>
              <th className="th">Reason</th>
              <th className="th">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {slice.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="td text-xs text-slate-500">{fmtTime(e.detected_at)}</td>
                <td className="td">{e.olt_name}</td>
                <td className="td font-mono text-xs text-brand-700 dark:text-cyan-300">{e.pon_port}</td>
                <td className="td">{e.onu_id}</td>
                <td className="td font-mono text-xs">{e.serial || "—"}</td>
                <td className="td"><KindBadge kind={e.kind} /></td>
                <td className="td"><ReasonBadge reason={e.reason} /></td>
                <td className="td text-xs">{e.kind === "recovery" ? fmtDuration(e.duration_seconds) : "—"}</td>
              </tr>
            ))}
            {events.length === 0 && (
              <tr><td className="td text-slate-500" colSpan={8}>No down/recovery events yet. Start detection and an up→down transition will be recorded here.</td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} />
      </div>

      {areaOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setAreaOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-bold text-slate-900 dark:text-white">Area labels</h2>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
              Name each PON port (e.g. "Rampura South") so power-outage areas on the dashboard show the location, not just the port number.
            </p>
            <div className="space-y-2">
              {ports.map((p) => (
                <div key={p} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">{p}</span>
                  <input
                    className="input flex-1"
                    value={areaDraft[p] ?? ""}
                    onChange={(e) => setAreaDraft({ ...areaDraft, [p]: e.target.value })}
                    placeholder="Area / location label"
                  />
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setAreaOpen(false)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={saveAreas} disabled={areaSaving}>
                {areaSaving ? "Saving…" : "Save labels"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
