import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api } from "../api/client";
import { OLTDevice, Onu, RejectedOnu } from "../api/types";
import SubscriberLink from "../components/SubscriberLink";
import MacCell from "../components/MacCell";
import StatusBadge from "../components/StatusBadge";
import ActionResultBanner from "../components/ActionResultBanner";
import WarningBanner from "../components/WarningBanner";
import CapsuleToggle from "../components/CapsuleToggle";
import { Pagination, usePagination } from "../components/Pagination";
import { useUserRole } from "../lib/role";
import { canWrite } from "../api/types";

interface FilterState {
  olt_id: string;
  pon_port: string;
  state: string;
  source: string;
  bound: string;
  search: string;
}

interface FormState {
  id?: number;
  olt_id: number;
  name: string;
  serial: string;
  mac: string;
  pon_port: string;
  onu_id: number;
  vlan: number;
  note: string;
}

export default function Onus() {
  const location = useLocation();
  const { role } = useUserRole();
  const writeOk = canWrite(role);
  const [onus, setOnus] = useState<Onu[]>([]);
  const [olts, setOlts] = useState<OLTDevice[]>([]);
  const [filter, setFilter] = useState<FilterState>(() => {
    const params = new URLSearchParams(location.search);
    const search = params.get("search") || "";
    return { olt_id: "", pon_port: "", state: "", source: "", bound: "", search };
  });
  const [searchText, setSearchText] = useState(filter.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [modal, setModal] = useState<FormState | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [queryVersion, setQueryVersion] = useState(0);
  const { page, setPage, totalPages, slice, total, pageSize } = usePagination(onus);
  const [portLoading, setPortLoading] = useState<string | null>(null);
  const [portStates, setPortStates] = useState<Record<string, boolean>>({});

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [scanOltId, setScanOltId] = useState<number | "">("");
  const [scanDesc, setScanDesc] = useState("");
  const [rejectedOnus, setRejectedOnus] = useState<RejectedOnu[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [addLoading, setAddLoading] = useState<number | null>(null);
  const [addResult, setAddResult] = useState<{ pon_port: string; onu_id: number; message: string } | null>(null);
  const [actionResult, setActionResult] = useState<{ message: string; ok: boolean } | null>(null);
  const [bwLoading, setBwLoading] = useState<number | null>(null);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const onSearchChange = useCallback((value: string) => {
    setSearchText(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilter((prev) => ({ ...prev, search: value }));
    }, 300);
  }, []);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  useEffect(() => {
    api.get<OLTDevice[]>("/devices/olts").then(setOlts).catch(() => undefined);
  }, []);

  const portOptions = useMemo(() => {
    const list = olts.filter((o) => !filter.olt_id || String(o.id) === filter.olt_id);
    return Array.from(new Set(list.flatMap((o) => (o.ports || [])))).sort();
  }, [olts, filter.olt_id]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filter.olt_id) params.set("olt_id", filter.olt_id);
    if (filter.pon_port) params.set("pon_port", filter.pon_port);
    if (filter.state) params.set("state", filter.state);
    if (filter.source) params.set("source", filter.source);
    if (filter.bound) params.set("bound", filter.bound === "1" ? "true" : "false");
    if (filter.search) params.set("search", filter.search);
    api
      .get<Onu[]>(`/onus?${params.toString()}`)
      .then(setOnus)
      .catch((e) => flash(String(e), false));
  }, [filter, queryVersion]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    try {
      if (modal.id) {
        await api.put(`/onus/${modal.id}`, {
          name: modal.name,
          serial: modal.serial,
          mac: modal.mac,
          pon_port: modal.pon_port,
          onu_id: modal.onu_id,
          vlan: modal.vlan,
          note: modal.note,
        });
        flash("ONU updated");
      } else {
        await api.post("/onus", {
          olt_id: modal.olt_id,
          name: modal.name,
          serial: modal.serial,
          mac: modal.mac,
          pon_port: modal.pon_port,
          onu_id: modal.onu_id,
          vlan: modal.vlan,
          note: modal.note,
        });
        flash("ONU added to inventory (Mikrotik / OLT untouched)");
      }
      setModal(null);
      setQueryVersion((v) => v + 1);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    }
  };

  const remove = async (onu: Onu) => {
    if (!confirm(`Remove ONU ${onu.pon_port || onu.serial || onu.name} from the application?\n\nThis only affects the application inventory — nothing is changed on the Mikrotik or OLT.`)) return;
    try {
      await api.del(`/onus/${onu.id}`);
      setActionResult({ message: "ONU removed from application inventory", ok: true });
      flash("ONU removed from application inventory");
      setQueryVersion((v) => v + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Delete failed";
      setActionResult({ message: msg, ok: false });
      flash(msg, false);
    }
  };

  const togglePort = async (onu: Onu, portId: number, enable: boolean) => {
    const label = enable ? "enable" : "disable";
    if (!confirm(`${label.toUpperCase()} Ethernet port ${portId} on ONU ${onu.pon_port || onu.serial}?\n\nThis sends a CLI command to the OLT.`)) return;
    const key = `${onu.id}-${portId}`;
    setPortLoading(key);
    try {
      const res = await api.post<{ ok: boolean; message: string }>("/onus/port-control", {
        olt_id: onu.olt_id,
        pon_port: onu.pon_port,
        onu_id: onu.onu_id,
        port_id: portId,
        enable,
      });
      setActionResult({ message: res.message, ok: true });
      flash(res.message);
      setPortStates((prev) => ({ ...prev, [`${onu.id}-1`]: enable }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Port control failed";
      setActionResult({ message: msg, ok: false });
      flash(msg, false);
    } finally {
      setPortLoading(null);
    }
  };

  const setBandwidth = async (onu: Onu, mode: string) => {
    const label = mode === "1g" ? "1 Gbps" : "100 Mbps";
    if (!confirm(`Set ONU ${onu.pon_port || onu.serial} to ${label}?\n\nThis sends a CLI command to the OLT.`)) return;
    setBwLoading(onu.id);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/devices/olts/${onu.olt_id}/set-bandwidth`, {
        pon_port: onu.pon_port,
        onu_id: onu.onu_id,
        mode,
      });
      setActionResult({ message: res.message, ok: true });
      flash(res.message);
      setQueryVersion((v) => v + 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bandwidth change failed";
      setActionResult({ message: msg, ok: false });
      flash(msg, false);
    } finally {
      setBwLoading(null);
    }
  };

  const scanRejected = async () => {
    if (!scanOltId) return;
    setScanLoading(true);
    setRejectedOnus([]);
    setAddResult(null);
    try {
      const data = await api.get<RejectedOnu[]>(`/devices/olts/${scanOltId}/rejected`);
      setRejectedOnus(data);
      if (data.length === 0) flash("No rejected ONUs found on this OLT.");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Scan failed", false);
    } finally {
      setScanLoading(false);
    }
  };

  const addRejected = async (r: RejectedOnu, idx: number) => {
    setAddLoading(idx);
    try {
      const ponBase = r.pon_port.replace(/:\d+$/, "");
      const res = await api.post<{ ok: boolean; message: string; pon_port: string; onu_id: number }>(`/devices/olts/${r.olt_id}/add-onu`, {
        pon_port: ponBase,
        identifier: r.serial || "",
        description: r.description || "",
        sequence: r.sequence || null,
      });
      setAddResult({ pon_port: res.pon_port, onu_id: res.onu_id, message: res.message });
      setRejectedOnus((prev) => prev.filter((_, i) => i !== idx));
      setQueryVersion((v) => v + 1);
      flash(res.message);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Add failed", false);
    } finally {
      setAddLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">ONU / ONT Inventory</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Adding or removing an ONU here only changes the application inventory — it never talks to the Mikrotik or the OLT.
          </p>
        </div>
      </header>

      {notice && (
        <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />
      )}

      {actionResult && (
        <ActionResultBanner ok={actionResult.ok} message={actionResult.message} onDismiss={() => setActionResult(null)} />
      )}

      {writeOk && (
        <div className="card overflow-hidden">
          <button
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/50"
            onClick={() => setQuickAddOpen(!quickAddOpen)}
          >
            <span>Quick Add from OLT — Scan & bind rejected ONUs</span>
            <svg className={`h-4 w-4 transition-transform ${quickAddOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {quickAddOpen && (
            <div className="border-t border-slate-200 px-4 pb-4 pt-3 dark:border-slate-700">
              <div className="mb-3 flex flex-wrap items-end gap-3">
                <div>
                  <label className="label">OLT</label>
                  <select className="input w-56" value={scanOltId} onChange={(e) => { setScanOltId(e.target.value ? Number(e.target.value) : ""); setRejectedOnus([]); setAddResult(null); }}>
                    <option value="">Select OLT</option>
                    {olts.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.pon_type})</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Description (no spaces, /;:)</label>
                  <input className="input w-56" placeholder="Max 32 chars" maxLength={32} value={scanDesc} onChange={(e) => setScanDesc(e.target.value.replace(/[\/;:\s]/g, "_"))} />
                </div>
                <button className="btn-primary" disabled={!scanOltId || scanLoading} onClick={scanRejected}>
                  {scanLoading ? "Scanning..." : "Scan"}
                </button>
              </div>

              {addResult && (
                <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    {addResult.message}
                    <button className="ml-auto text-emerald-400 hover:text-emerald-600" onClick={() => setAddResult(null)}>
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {rejectedOnus.length > 0 ? (
                <div className="card overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                      <tr>
                        <th className="th">PON Port</th>
                        <th className="th">Serial / MAC</th>
                        <th className="th">Description</th>
                        <th className="th">Seq</th>
                        <th className="th">Reason</th>
                        <th className="th">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                      {rejectedOnus.map((r, i) => (
                        <tr key={`${r.pon_port}-${r.onu_id}-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="td font-mono text-xs text-brand-700 dark:text-cyan-300">{r.pon_port}</td>
                          <td className="td font-mono text-xs">{r.serial || "—"}</td>
                          <td className="td">
                            <input
                              className="input w-56 text-xs py-1"
                              placeholder="Max 32 chars, no /;: or spaces"
                              maxLength={32}
                              value={r.description || ""}
                              onChange={(e) => {
                                const val = e.target.value.replace(/[\/;:\s]/g, "_");
                                setRejectedOnus((prev) => prev.map((item, idx) => idx === i ? { ...item, description: val } : item));
                              }}
                            />
                          </td>
                          <td className="td">
                            <input
                              className="input w-16 text-xs py-1"
                              type="number"
                              min="1"
                              max={olts.find((o) => o.id === r.olt_id)?.pon_type === "epon" ? 64 : 128}
                              placeholder="auto"
                              value={r.sequence || ""}
                              onChange={(e) => {
                                const val = e.target.value ? Number(e.target.value) : null;
                                setRejectedOnus((prev) => prev.map((item, idx) => idx === i ? { ...item, sequence: val } : item));
                              }}
                            />
                          </td>
                          <td className="td"><span className="badge bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{r.reason || "unknown"}</span></td>
                          <td className="td">
                            <button
                              className="btn-primary text-xs py-1 px-3"
                              disabled={addLoading === i}
                              onClick={() => addRejected(r, i)}
                            >
                              {addLoading === i ? "..." : "Add"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : scanLoading ? (
                <div className="py-6 text-center text-sm text-slate-400">Scanning for rejected ONUs...</div>
              ) : scanOltId ? (
                <div className="py-6 text-center text-sm text-slate-400">Click "Scan" to discover rejected ONUs.</div>
              ) : (
                <div className="py-6 text-center text-sm text-slate-400">Select an OLT and click "Scan".</div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">OLT</label>
          <select className="input w-48" value={filter.olt_id} onChange={(e) => setFilter({ ...filter, olt_id: e.target.value, pon_port: "" })}>
            <option value="">All</option>
            {olts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">PON Port</label>
          <select className="input w-48" value={filter.pon_port} onChange={(e) => setFilter({ ...filter, pon_port: e.target.value })}>
            <option value="">All ports</option>
            {portOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="label">State</label>
          <select className="input w-32" value={filter.state} onChange={(e) => setFilter({ ...filter, state: e.target.value })}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="offline">Offline</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <div>
          <label className="label">Source</label>
          <select className="input w-32" value={filter.source} onChange={(e) => setFilter({ ...filter, source: e.target.value })}>
            <option value="">All</option>
            <option value="manual">Manual</option>
            <option value="auto">Auto</option>
          </select>
        </div>
        <div>
          <label className="label">Binding</label>
          <select className="input w-32" value={filter.bound} onChange={(e) => setFilter({ ...filter, bound: e.target.value })}>
            <option value="">All</option>
            <option value="1">Bound</option>
            <option value="0">Unbound</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="label">Search (ID, name, SN, MAC, port)</label>
          <input className="input" value={searchText} onChange={(e) => onSearchChange(e.target.value)} placeholder="ID, name, SN, MAC, port" />
        </div>
      </div>

      <div className="card overflow-x-auto">
        <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} top />
        <table className="w-full">
          <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            <tr>
              <th className="th">#</th>
              <th className="th">OLT / Port</th>
              <th className="th">Name</th>
              <th className="th">Subscriber ID</th>
              <th className="th">Serial</th>
              <th className="th">MAC</th>
              <th className="th">State</th>
              <th className="th">RX / TX</th>
              <th className="th">Mikrotik IP</th>
              <th className="th">Source</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {slice.map((o, i) => (
              <tr key={o.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="td text-xs text-slate-400">{page * pageSize + i + 1}</td>
                <td className="td">
                  <div className="font-medium">{o.olt_name}</div>
                  <Link to={`/onus/${o.id}`} className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400">{o.pon_port || "—"}</Link>
                </td>
                <td className="td">
                  <div>{o.name || <span className="text-slate-400">—</span>}</div>
                  {o.vlan > 0 && <div className="text-xs text-slate-500">VLAN {o.vlan}</div>}
                </td>
                <td className="td"><SubscriberLink subscriber={o.subscriber} /></td>
                <td className="td font-mono text-xs">{o.serial || "—"}</td>
                <td className="td"><MacCell mac={o.last_mac || o.mac} vendor={o.mac_vendor} /></td>
                <td className="td"><StatusBadge status={o.status} /></td>
                <td className="td font-mono text-xs">
                  {o.rx_power != null || o.tx_power != null ? (
                    <>
                      <div className={o.rx_power != null && o.rx_power < -25 ? "text-red-600" : ""}>
                        RX {o.rx_power ?? "—"} dBm
                      </div>
                      <div>TX {o.tx_power ?? "—"} dBm</div>
                    </>
                  ) : "—"}
                </td>
                <td className="td">
                  {o.bound ? (
                    <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">{o.mikrotik_ip || "bound"}</span>
                  ) : (
                    <span className="badge bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">unbound</span>
                  )}
                </td>
                <td className="td">
                  <span className={`badge ${o.source === "manual" ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>
                    {o.source}
                  </span>
                </td>
                <td className="td">
                  <div className="flex items-center gap-2">
                    {writeOk && o.pon_port.toUpperCase().startsWith("EPON") && (
                      <CapsuleToggle
                        leftLabel="100M"
                        rightLabel="1G"
                        activeRight={(o.bandwidth_mode || "100m") === "1g"}
                        loading={bwLoading === o.id}
                        onToggle={(right) => setBandwidth(o, right ? "1g" : "100m")}
                      />
                    )}
                    {writeOk && (
                      <CapsuleToggle
                        leftLabel="OFF"
                        rightLabel="ON"
                        activeRight={portStates[`${o.id}-1`] !== false}
                        loading={portLoading === `${o.id}-1`}
                        activeColor="emerald"
                        onToggle={(right) => togglePort(o, 1, right)}
                      />
                    )}
                    {!writeOk && <span className="text-xs text-slate-400">—</span>}
                  </div>
                </td>
              </tr>
            ))}
            {onus.length === 0 && (
              <tr><td className="td" colSpan={11}>No ONUs found. Add one manually or run a scan on an OLT.</td></tr>
            )}
          </tbody>
        </table>
        <Pagination page={page} setPage={setPage} totalPages={totalPages} total={total} pageSize={pageSize} />
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setModal(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">
              {modal.id ? "Edit ONU" : "Add ONU to inventory"}
            </h2>
            {!modal.id && (
              <p className="mb-3 rounded-md bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                This only stores the ONU in the application. Nothing is sent to the Mikrotik or the OLT.
              </p>
            )}
            <form onSubmit={submit} className="space-y-3">
              {!modal.id && (
                <div>
                  <label className="label">OLT</label>
                  <select className="input" value={modal.olt_id} onChange={(e) => setModal({ ...modal, olt_id: Number(e.target.value) })} required>
                    <option value={0} disabled>Select OLT...</option>
                    {olts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Customer / Name</label>
                  <input className="input" value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} />
                </div>
                <div>
                  <label className="label">PON port (e.g. GPON0/1:5)</label>
                  <input className="input font-mono" value={modal.pon_port} onChange={(e) => setModal({ ...modal, pon_port: e.target.value })} placeholder="GPON0/1:5" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">ONU serial</label>
                  <input className="input font-mono" value={modal.serial} onChange={(e) => setModal({ ...modal, serial: e.target.value })} placeholder="BDCM12345678" />
                </div>
                <div>
                  <label className="label">ONU MAC</label>
                  <input className="input font-mono" value={modal.mac} onChange={(e) => setModal({ ...modal, mac: e.target.value })} placeholder="fc:fa:f7:9d:00:ea" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">ONU ID</label>
                  <input type="number" className="input" value={modal.onu_id} onChange={(e) => setModal({ ...modal, onu_id: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="label">VLAN</label>
                  <input type="number" className="input" value={modal.vlan} onChange={(e) => setModal({ ...modal, vlan: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <label className="label">Note</label>
                <input className="input" value={modal.note} onChange={(e) => setModal({ ...modal, note: e.target.value })} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}