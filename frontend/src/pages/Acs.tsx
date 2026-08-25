import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { AcsDevice, AcsJob, AcsMetric, AcsParameter, AcsWifiStatus } from "../api/types";
import { canOps } from "../api/types";
import ActionResultBanner from "../components/ActionResultBanner";
import WarningBanner from "../components/WarningBanner";
import { useUserRole } from "../lib/role";
import { fmtTimeShort } from "../lib/time";

function fmtBw(bps: number | null | undefined): string {
  if (bps == null) return "—";
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbps`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbps`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} Kbps`;
  return `${bps.toFixed(0)} bps`;
}

function MemPct(d: AcsDevice): number | null {
  if (d.last_mem_total && d.last_mem_used != null) {
    return Math.round((d.last_mem_used / d.last_mem_total) * 100);
  }
  return null;
}

function ActionBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
    sent: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    failed: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
    timeout: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  };
  return <span className={`badge ${map[status] || map.queued}`}>{status}</span>;
}

function RateChart({ metrics, title, field }: { metrics: AcsMetric[]; title: string; field: "rx_rate" | "tx_rate" }) {
  const data = metrics.filter((m) => m[field] != null);
  if (data.length === 0) return null;
  const W = 520;
  const H = 120;
  const PAD = 6;
  const vals = data.map((m) => m[field] as number);
  const max = Math.max(...vals, 1);
  const t0 = new Date(data[0].sampled_at).getTime();
  const t1 = new Date(data[data.length - 1].sampled_at).getTime();
  const x = (i: number) => PAD + (t1 > t0 ? ((new Date(data[i].sampled_at).getTime() - t0) / (t1 - t0)) * (W - PAD * 2) : (i / Math.max(data.length - 1, 1)) * (W - PAD * 2));
  const y = (v: number) => PAD + (1 - v / max) * (H - PAD * 2);
  const d = data.map((m, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(m[field] as number).toFixed(1)}`).join("");
  const color = field === "rx_rate" ? "#6d5efc" : "#f59e0b";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: color }} /> {title}
        </span>
        <span className="font-semibold text-slate-800 dark:text-slate-100">{fmtBw(data[data.length - 1][field])}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function CpuChart({ metrics }: { metrics: AcsMetric[] }) {
  const data = metrics.filter((m) => m.cpu != null);
  if (data.length === 0) return null;
  const W = 520;
  const H = 80;
  const PAD = 6;
  const x = (i: number) => PAD + (i / Math.max(data.length - 1, 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - v / 100) * (H - PAD * 2);
  const d = data.map((m, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(m.cpu as number).toFixed(1)}`).join("");
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <span className="inline-block h-0.5 w-4 rounded bg-emerald-500" /> CPU
        </span>
        <span className="font-semibold text-slate-800 dark:text-slate-100">{data[data.length - 1].cpu}%</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none">
        <path d={d} fill="none" stroke="#10b981" strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export default function Acs() {
  const { role } = useUserRole();
  const opsOk = canOps(role);
  const [searchParams] = useSearchParams();
  const [devices, setDevices] = useState<AcsDevice[]>([]);
  const [selected, setSelected] = useState<AcsDevice | null>(null);
  const [params, setParams] = useState<AcsParameter[]>([]);
  const [metrics, setMetrics] = useState<AcsMetric[]>([]);
  const [jobs, setJobs] = useState<AcsJob[]>([]);
  const [wifi, setWifi] = useState<AcsWifiStatus | null>(null);
  const [paramSearch, setParamSearch] = useState("");
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [wifiForm, setWifiForm] = useState({ ssid: "", passphrase: "", enable: true, band: "2.4g" });
  const [wanForm, setWanForm] = useState({ ip_address: "", subnet_mask: "", default_gateway: "", dns_servers: "", username: "", password: "", addressing_type: "DHCP" });
  const [fwUrl, setFwUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const loadDevices = useCallback(() => {
    api.get<AcsDevice[]>("/acs/devices").then(setDevices).catch(() => undefined);
  }, []);

  const loadDetail = useCallback((id: number) => {
    api.get<AcsDevice>(`/acs/devices/${id}`).then(setSelected).catch(() => undefined);
    api.get<AcsParameter[]>(`/acs/devices/${id}/parameters`).then(setParams).catch(() => setParams([]));
    api.get<AcsMetric[]>(`/acs/devices/${id}/metrics?hours=24`).then(setMetrics).catch(() => setMetrics([]));
    api.get<AcsJob[]>(`/acs/devices/${id}/jobs`).then(setJobs).catch(() => setJobs([]));
    api.get<AcsWifiStatus>(`/acs/devices/${id}/wifi`).then(setWifi).catch(() => setWifi(null));
  }, []);

  useEffect(() => {
    loadDevices();
    pollRef.current = window.setInterval(loadDevices, 30000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [loadDevices]);

  // Deep link from a subscriber list/profile: auto-select the ACS device.
  useEffect(() => {
    const idParam = searchParams.get("device");
    if (idParam && /^\d+$/.test(idParam)) {
      const id = Number(idParam);
      const existing = devices.find((d) => d.id === id);
      if (existing) {
        setSelected(existing);
      }
      loadDetail(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (selected) {
      const id = window.setInterval(() => loadDetail(selected.id), 20000);
      return () => window.clearInterval(id);
    }
  }, [selected, loadDetail]);

  const acsUrl = `${window.location.protocol}//${window.location.host}/api/acs/cwmp`;

  const filteredParams = useMemo(() => {
    const q = paramSearch.toLowerCase();
    return params.filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [params, paramSearch]);

  const runAction = async (path: string, body: unknown, okMsg: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.post(path, body);
      flash(okMsg);
      loadDetail(selected.id);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Action failed", false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">ACS · Router Management</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            TR-069 device management — WiFi password, firmware, WAN config, resource & traffic monitoring.
          </p>
        </div>
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          ACS URL (point routers here): <code className="font-mono text-brand-700 dark:text-cyan-300">{acsUrl}</code>
        </div>
      </header>

      {notice && (
        <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Device list */}
        <div className="card overflow-hidden lg:col-span-1">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
            Routers ({devices.length})
          </div>
          <div className="max-h-[70vh] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700/60">
            {devices.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-400">
                No routers connected yet.<br />
                <span className="text-xs">Point a TR-069 router to the ACS URL above.</span>
              </div>
            )}
            {devices.map((d) => (
              <button
                key={d.id}
                onClick={() => { setSelected(d); loadDetail(d.id); }}
                className={`w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${selected?.id === d.id ? "bg-brand-50 dark:bg-brand-900/20" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                      {d.model_name || d.product_class || d.serial_number}
                    </div>
                    <div className="truncate font-mono text-[11px] text-slate-400">{d.serial_number} · {d.manufacturer || "—"}</div>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${d.online ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                    {d.online ? "ONLINE" : "OFFLINE"}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                  <span>CPU {d.last_cpu != null ? `${d.last_cpu}%` : "—"}</span>
                  <span>Mem {MemPct(d) != null ? `${MemPct(d)}%` : "—"}</span>
                  <span className="ml-auto">↓{fmtBw(d.last_rx_rate)} ↑{fmtBw(d.last_tx_rate)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Device detail */}
        <div className="space-y-4 lg:col-span-2">
          {!selected ? (
            <div className="card p-10 text-center text-sm text-slate-400 dark:text-slate-500">
              Select a router on the left to manage it.
            </div>
          ) : (
            <>
              {/* Summary card */}
              <div className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-bold text-slate-900 dark:text-white">
                      {selected.model_name || selected.product_class || "CPE"}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {selected.manufacturer} {selected.product_class} · HW {selected.hardware_version || "—"} · FW {selected.software_version || "—"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono">{selected.serial_number}</span>
                      <span className="font-mono">{selected.mac || "—"}</span>
                      <span className="font-mono">{selected.ip || "—"}</span>
                      {selected.last_inform && <span>last inform {fmtTimeShort(selected.last_inform)}</span>}
                    </div>
                  </div>
                  <span className={`badge ${selected.online ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                    {selected.online ? "Online" : "Offline"}
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">CPU</div>
                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{selected.last_cpu != null ? `${selected.last_cpu}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">Memory</div>
                    <div className="text-lg font-bold text-slate-800 dark:text-slate-100">{MemPct(selected) != null ? `${MemPct(selected)}%` : "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">RX rate</div>
                    <div className="text-lg font-bold text-brand-700 dark:text-cyan-300">{fmtBw(selected.last_rx_rate)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <div className="text-[10px] uppercase tracking-wide text-slate-400">TX rate</div>
                    <div className="text-lg font-bold text-amber-600 dark:text-amber-300">{fmtBw(selected.last_tx_rate)}</div>
                  </div>
                </div>
              </div>

              {/* Resource + traffic monitor */}
              <div className="card p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Resource & Traffic Monitor
                </h3>
                <div className="space-y-3">
                  <CpuChart metrics={metrics} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <RateChart metrics={metrics} title="Downstream (RX)" field="rx_rate" />
                    <RateChart metrics={metrics} title="Upstream (TX)" field="tx_rate" />
                  </div>
                  {metrics.length === 0 && (
                    <div className="py-6 text-center text-sm text-slate-400">No telemetry yet — waiting for the router's periodic Inform.</div>
                  )}
                </div>
              </div>

              {/* WiFi status */}
              <div className="card p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Current WiFi Config <span className="text-slate-400">(reported by router)</span>
                </h3>
                {!wifi || !wifi.supported ? (
                  <div className="py-6 text-center text-sm text-slate-400">
                    {wifi?.summary || "This router does not expose WiFi (WLANConfiguration) parameters via TR-069."}
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {wifi.bands.map((b) => {
                      const bandLabel = b.band === "2.4g" ? "2.4 GHz" : b.band === "5g" ? "5 GHz" : b.band === "5g2" ? "5 GHz (2nd)" : "Band";
                      return (
                        <div key={b.instance} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                          <div className="mb-2 flex items-center justify-between">
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                              {bandLabel}
                              <span className="ml-1 text-xs font-normal text-slate-400">WLAN {b.instance}</span>
                            </span>
                            <span className={`badge ${b.enable === true ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : b.enable === false ? "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
                              {b.enable === true ? "Enabled" : b.enable === false ? "Disabled" : "Unknown"}
                            </span>
                          </div>
                          <dl className="space-y-1.5 text-sm">
                            <div className="flex justify-between gap-2">
                              <dt className="text-slate-500 dark:text-slate-400">SSID</dt>
                              <dd className="font-medium text-slate-800 dark:text-slate-100">{b.ssid || "—"}</dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-slate-500 dark:text-slate-400">Password</dt>
                              <dd className="font-mono text-slate-800 dark:text-slate-100">{b.passphrase ? "••••••••" : "—"}</dd>
                            </div>
                            {b.channel && (
                              <div className="flex justify-between gap-2">
                                <dt className="text-slate-500 dark:text-slate-400">Channel</dt>
                                <dd className="text-slate-800 dark:text-slate-100">{b.channel}</dd>
                              </div>
                            )}
                            {b.standard && (
                              <div className="flex justify-between gap-2">
                                <dt className="text-slate-500 dark:text-slate-400">Standard</dt>
                                <dd className="text-slate-800 dark:text-slate-100">{b.standard}</dd>
                              </div>
                            )}
                            {b.security_mode && (
                              <div className="flex justify-between gap-2">
                                <dt className="text-slate-500 dark:text-slate-400">Security</dt>
                                <dd className="text-slate-800 dark:text-slate-100">{b.security_mode}</dd>
                              </div>
                            )}
                          </dl>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="card p-5">
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">Actions</h3>
                {!opsOk && (
                  <p className="mb-3 text-xs text-slate-400">Your role cannot push changes to routers.</p>
                )}
                {opsOk && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {/* WiFi */}
                    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                      <div className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">WiFi password change</div>
                      <div className="space-y-2">
                        <input className="input" placeholder="SSID (optional)" value={wifiForm.ssid} onChange={(e) => setWifiForm({ ...wifiForm, ssid: e.target.value })} />
                        <input className="input" placeholder="New passphrase (min 8)" value={wifiForm.passphrase} onChange={(e) => setWifiForm({ ...wifiForm, passphrase: e.target.value })} />
                        <div>
                          <label className="label">Band</label>
                          <select className="input" value={wifiForm.band} onChange={(e) => setWifiForm({ ...wifiForm, band: e.target.value })}>
                            <option value="2.4g">2.4 GHz</option>
                            <option value="5g">5 GHz</option>
                            <option value="5g2">5 GHz (second radio)</option>
                            <option value="all">All bands</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                          <input type="checkbox" checked={wifiForm.enable} onChange={(e) => setWifiForm({ ...wifiForm, enable: e.target.checked })} />
                          Enable WiFi
                        </label>
                        <button
                          className="btn-primary w-full"
                          disabled={busy || wifiForm.passphrase.length < 8}
                          onClick={() => runAction(`/acs/devices/${selected.id}/wifi`, { ssid: wifiForm.ssid || null, passphrase: wifiForm.passphrase, enable: wifiForm.enable, band: wifiForm.band }, "WiFi password change queued — applied on next router Inform")}
                        >
                          Push WiFi config
                        </button>
                      </div>
                    </div>

                    {/* Firmware */}
                    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
                      <div className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">Firmware update</div>
                      <div className="space-y-2">
                        <input className="input font-mono" placeholder="http(s)://…/firmware.bin" value={fwUrl} onChange={(e) => setFwUrl(e.target.value)} />
                        <button
                          className="btn-primary w-full"
                          disabled={busy || !/^https?:\/\//.test(fwUrl)}
                          onClick={() => runAction(`/acs/devices/${selected.id}/firmware`, { url: fwUrl }, "Firmware download queued — the router will pull and apply it")}
                        >
                          Queue firmware download
                        </button>
                      </div>
                    </div>

                    {/* WAN */}
                    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700 lg:col-span-2">
                      <div className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">WAN config push</div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        <input className="input" placeholder="IP address" value={wanForm.ip_address} onChange={(e) => setWanForm({ ...wanForm, ip_address: e.target.value })} />
                        <input className="input" placeholder="Subnet mask" value={wanForm.subnet_mask} onChange={(e) => setWanForm({ ...wanForm, subnet_mask: e.target.value })} />
                        <input className="input" placeholder="Default gateway" value={wanForm.default_gateway} onChange={(e) => setWanForm({ ...wanForm, default_gateway: e.target.value })} />
                        <input className="input" placeholder="DNS servers" value={wanForm.dns_servers} onChange={(e) => setWanForm({ ...wanForm, dns_servers: e.target.value })} />
                        <input className="input" placeholder="PPPoE username" value={wanForm.username} onChange={(e) => setWanForm({ ...wanForm, username: e.target.value })} />
                        <input className="input" placeholder="PPPoE password" value={wanForm.password} onChange={(e) => setWanForm({ ...wanForm, password: e.target.value })} />
                      </div>
                      <button
                        className="btn-primary mt-3"
                        disabled={busy}
                        onClick={() => runAction(
                          `/acs/devices/${selected.id}/wan`,
                          {
                            ip_address: wanForm.ip_address || null,
                            subnet_mask: wanForm.subnet_mask || null,
                            default_gateway: wanForm.default_gateway || null,
                            dns_servers: wanForm.dns_servers || null,
                            username: wanForm.username || null,
                            password: wanForm.password || null,
                          },
                          "WAN config queued — applied on next router Inform"
                        )}
                      >
                        Push WAN config
                      </button>
                    </div>

                    {/* Reboot */}
                    <div className="rounded-xl border border-rose-200 p-4 dark:border-rose-900/40 lg:col-span-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-rose-700 dark:text-rose-300">Reboot router</div>
                        <button
                          className="btn-secondary border-rose-300 text-rose-600 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950"
                          disabled={busy}
                          onClick={() => { if (confirm(`Reboot ${selected.model_name || selected.serial_number}?`)) runAction(`/acs/devices/${selected.id}/reboot`, {}, "Reboot queued"); }}
                        >
                          Reboot
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Parameters */}
              <div className="card p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">TR-069 Parameters</h3>
                  <input className="input w-56" placeholder="Search parameters…" value={paramSearch} onChange={(e) => setParamSearch(e.target.value)} />
                </div>
                <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700">
                  <table className="w-full text-xs">
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {filteredParams.slice(0, 200).map((p) => (
                        <tr key={p.name}>
                          <td className="px-3 py-1.5 font-mono text-slate-600 dark:text-slate-300">{p.name}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-slate-800 dark:text-slate-100">{p.value}</td>
                        </tr>
                      ))}
                      {filteredParams.length === 0 && (
                        <tr><td className="px-3 py-4 text-center text-slate-400">No parameters.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Jobs */}
              <div className="card overflow-x-auto">
                <div className="border-b border-slate-200 px-5 py-4 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
                  Recent Jobs
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <tr>
                      <th className="th">#</th>
                      <th className="th">Action</th>
                      <th className="th">Status</th>
                      <th className="th">Created</th>
                      <th className="th">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                    {jobs.map((j, i) => (
                      <tr key={j.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="td text-xs text-slate-400">{i + 1}</td>
                        <td className="td"><span className="font-medium">{j.action}</span></td>
                        <td className="td"><ActionBadge status={j.status} /></td>
                        <td className="td text-xs text-slate-500">{fmtTimeShort(j.created_at)}</td>
                        <td className="td text-xs text-slate-500">{j.result || "—"}</td>
                      </tr>
                    ))}
                    {jobs.length === 0 && <tr><td className="td text-slate-500" colSpan={5}>No jobs yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
