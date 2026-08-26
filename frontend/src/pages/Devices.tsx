import React, { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import { canOps, canWrite, MikrotikDevice, OLTDevice, RejectedOnu, SwitchDevice, TestResult } from "../api/types";
import { Pagination, usePagination } from "../components/Pagination";
import { useUserRole } from "../lib/role";
import { fmtTime } from "../lib/time";
import ActionResultBanner from "../components/ActionResultBanner";
import WarningBanner from "../components/WarningBanner";

type Kind = "olt" | "mikrotik" | "switch";

interface NocItem {
  id: number;
  name: string;
  address: string;
  gps_lat: number | null;
  gps_lng: number | null;
  contact_name: string;
  contact_phone: string;
  notes: string;
  device_count: number;
}

interface PopItem {
  id: number;
  name: string;
  address: string;
  gps_lat: number | null;
  gps_lng: number | null;
  contact_name: string;
  contact_phone: string;
  notes: string;
  device_count: number;
}

interface FormState {
  id?: number;
  kind: Kind;
  name: string;
  ip: string;
  vendor: string;
  pon_type: string;
  access_method: string;
  port: number;
  username: string;
  password: string;
  enable_password: string;
  snmp_community: string;
  snmp_enabled: boolean;
  port_capacity: number;
  port_count: number;
  api_port: number;
  noc_id: number | null;
  pop_id: number | null;
  use_ssl: boolean;
  routeros_version: number;
  enabled: boolean;
}

const emptyForm = (kind: Kind): FormState => ({
  kind,
  name: "",
  ip: "",
  vendor: kind === "switch" ? "bdcom" : "bdcom",
  pon_type: "gpon",
  access_method: "telnet",
  port: 23,
  username: "admin",
  password: "",
  enable_password: "",
  snmp_community: "public",
  snmp_enabled: false,
  port_capacity: 64,
  port_count: 24,
  api_port: 8728,
  use_ssl: false,
  routeros_version: 7,
  enabled: true,
  noc_id: null,
  pop_id: null,
});

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    reachable: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    unreachable: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    unknown: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  };
  return <span className={`badge ${map[status] || map.unknown}`}>{status}</span>;
}

export default function Devices() {
  const { role } = useUserRole();
  const writeOk = canWrite(role);
  const opsOk = canOps(role);
  const [olts, setOlts] = useState<OLTDevice[]>([]);
  const [mikrotiks, setMikrotiks] = useState<MikrotikDevice[]>([]);
  const [switches, setSwitches] = useState<SwitchDevice[]>([]);
  const [modal, setModal] = useState<FormState | null>(null);
  const [busyId, setBusyId] = useState<string>("");
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const oltPager = usePagination(olts);
  const mktPager = usePagination(mikrotiks);
  const swPager = usePagination(switches);

  const [rejectedOnus, setRejectedOnus] = useState<RejectedOnu[]>([]);
  const [rejectedLoading, setRejectedLoading] = useState<number | null>(null);
  const [authorizeModal, setAuthorizeModal] = useState<RejectedOnu | null>(null);
  const [authName, setAuthName] = useState("");
  const [expandedSwitch, setExpandedSwitch] = useState<number | null>(null);

  const [nocs, setNocs] = useState<NocItem[]>([]);
  const [pops, setPops] = useState<PopItem[]>([]);
  const [nocModal, setNocModal] = useState<{ id?: number; name: string; address: string; gps_lat: string; gps_lng: string; contact_name: string; contact_phone: string; notes: string } | null>(null);
  const [popModal, setPopModal] = useState<{ id?: number; name: string; address: string; gps_lat: string; gps_lng: string; contact_name: string; contact_phone: string; notes: string } | null>(null);
  const [expandedNoc, setExpandedNoc] = useState<number | null>(null);
  const [expandedPop, setExpandedPop] = useState<number | null>(null);
  const [nocPopTab, setNocPopTab] = useState<"noc" | "pop">("noc");

  const [onuOltId, setOnuOltId] = useState<number | "">("");
  const [onuAction, setOnuAction] = useState<"delete" | "add" | "description">("delete");
  const [onuPonPort, setOnuPonPort] = useState("");
  const [onuId, setOnuId] = useState("");
  const [onuIdentifier, setOnuIdentifier] = useState("");
  const [onuDesc, setOnuDesc] = useState("");
  const [onuBusy, setOnuBusy] = useState(false);

  const [scanOltId, setScanOltId] = useState<number | "">("");
  const [addResult, setAddResult] = useState<{ pon_port: string; onu_id: number; message: string } | null>(null);
  const [onuActionResult, setOnuActionResult] = useState<{ message: string; ok: boolean } | null>(null);

  const load = async () => {
    setOlts(await api.get<OLTDevice[]>("/devices/olts"));
    setMikrotiks(await api.get<MikrotikDevice[]>("/devices/mikrotiks"));
    setSwitches(await api.get<SwitchDevice[]>("/devices/switches"));
    setNocs(await api.get<NocItem[]>("/noc-pop/nocs"));
    setPops(await api.get<PopItem[]>("/noc-pop/pops"));
  };

  useEffect(() => {
    load().catch((e) => setNotice({ text: String(e), ok: false }));
  }, []);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const openNew = (kind: Kind) => setModal(emptyForm(kind));
  const openEdit = (kind: Kind, device: OLTDevice | MikrotikDevice | SwitchDevice) => {
    setModal({
      ...emptyForm(kind),
      id: device.id,
      name: device.name,
      ip: device.ip,
      enabled: device.enabled,
      ...(kind === "olt"
        ? {
            vendor: (device as OLTDevice).vendor,
            pon_type: (device as OLTDevice).pon_type,
            access_method: (device as OLTDevice).access_method,
            port: (device as OLTDevice).port,
            username: (device as OLTDevice).username,
            password: (device as OLTDevice).password,
            enable_password: (device as OLTDevice).enable_password,
            snmp_community: (device as OLTDevice).snmp_community,
            snmp_enabled: (device as OLTDevice).snmp_enabled,
            port_capacity: (device as OLTDevice).port_capacity,
            noc_id: (device as OLTDevice).noc_id,
            pop_id: (device as OLTDevice).pop_id,
          }
        : kind === "switch"
          ? {
              vendor: (device as SwitchDevice).vendor,
              port_count: (device as SwitchDevice).port_count,
              access_method: (device as SwitchDevice).access_method,
              port: (device as SwitchDevice).port,
              username: (device as SwitchDevice).username,
              password: (device as SwitchDevice).password,
              enable_password: (device as SwitchDevice).enable_password,
              snmp_community: (device as SwitchDevice).snmp_community,
              snmp_enabled: (device as SwitchDevice).snmp_enabled,
            }
          : {
              api_port: (device as MikrotikDevice).api_port,
              use_ssl: (device as MikrotikDevice).use_ssl,
              routeros_version: (device as MikrotikDevice).routeros_version,
              username: (device as MikrotikDevice).username,
              password: (device as MikrotikDevice).password,
            }),
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!modal) return;
    const base = { name: modal.name, ip: modal.ip, enabled: modal.enabled };
    try {
      if (modal.kind === "olt") {
        const body = {
          ...base,
          vendor: modal.vendor,
          pon_type: modal.pon_type,
          access_method: modal.access_method,
          port: modal.port,
          username: modal.username,
          password: modal.password,
          enable_password: modal.enable_password,
          snmp_community: modal.snmp_community,
          snmp_enabled: modal.snmp_enabled,
          port_capacity: modal.port_capacity,
          noc_id: modal.noc_id,
          pop_id: modal.pop_id,
        };
        if (modal.id) await api.put(`/devices/olts/${modal.id}`, body);
        else await api.post("/devices/olts", body);
      } else if (modal.kind === "switch") {
        const body = {
          ...base,
          vendor: modal.vendor,
          port_count: modal.port_count,
          access_method: modal.access_method,
          port: modal.port,
          username: modal.username,
          password: modal.password,
          enable_password: modal.enable_password,
          snmp_community: modal.snmp_community,
          snmp_enabled: modal.snmp_enabled,
        };
        if (modal.id) await api.put(`/devices/switches/${modal.id}`, body);
        else await api.post("/devices/switches", body);
      } else {
        const body = {
          ...base,
          api_port: modal.api_port,
          use_ssl: modal.use_ssl,
          routeros_version: modal.routeros_version,
          username: modal.username,
          password: modal.password,
        };
        if (modal.id) await api.put(`/devices/mikrotiks/${modal.id}`, body);
        else await api.post("/devices/mikrotiks", body);
      }
      flash("Device saved");
      setModal(null);
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    }
  };

  const remove = async (kind: Kind, id: number) => {
    if (!confirm("Delete this device? This also removes its collected data.")) return;
    try {
      const path = kind === "olt" ? "olts" : kind === "switch" ? "switches" : "mikrotiks";
      await api.del(`/devices/${path}/${id}`);
      flash("Device deleted");
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", false);
    }
  };

  const test = async (kind: Kind, id: number) => {
    setBusyId(`test-${kind}-${id}`);
    try {
      const path = kind === "olt" ? "olts" : kind === "switch" ? "switches" : "mikrotiks";
      const res = await api.post<TestResult>(`/devices/${path}/${id}/test`);
      flash(res.success ? `Test OK: ${res.message}` : `Test failed: ${res.message}`, res.success);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Test failed", false);
    } finally {
      setBusyId("");
      await load();
    }
  };

  const scan = async (kind: Kind, id: number) => {
    setBusyId(`scan-${kind}-${id}`);
    try {
      const res = await api.post<TestResult>(`/devices/${kind === "olt" ? "olts" : "mikrotiks"}/${id}/scan`);
      flash(res.success ? `Scan complete: ${res.message}` : `Scan failed: ${res.message}`, res.success);
    } catch (err) {
      flash(err instanceof Error ? err.message : "Scan failed", false);
    } finally {
      setBusyId("");
      await load();
    }
  };

  const discoverRejected = async (oltId: number) => {
    setRejectedLoading(oltId);
    setRejectedOnus([]);
    try {
      const data = await api.get<RejectedOnu[]>(`/devices/olts/${oltId}/rejected`);
      setRejectedOnus(data);
      if (data.length === 0) flash("No rejected ONUs found on this OLT");
    } catch (err) {
      flash(err instanceof Error ? err.message : "Discovery failed", false);
    } finally {
      setRejectedLoading(null);
    }
  };

  const authorizeOnu = async () => {
    if (!authorizeModal) return;
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/devices/olts/${authorizeModal.olt_id}/authorize-onu`,
        {
          pon_port: authorizeModal.pon_port,
          onu_id: authorizeModal.onu_id,
          serial: authorizeModal.serial,
          name: authName,
        },
      );
      flash(res.message);
      setAuthorizeModal(null);
      setAuthName("");
      // Remove the authorized ONU from the rejected list
      setRejectedOnus((prev) =>
        prev.filter((r) => !(r.pon_port === authorizeModal!.pon_port && r.onu_id === authorizeModal!.onu_id))
      );
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Authorization failed", false);
    }
  };

  const onuOlt = olts.find((o) => o.id === onuOltId);
  const isGpon = onuOlt?.pon_type === "gpon";
  const onuPorts = onuOlt?.ports || [];

  const execOnuAction = async () => {
    if (onuOltId === "" || !onuPonPort) return;
    const confirmMsg = onuAction === "delete"
      ? `Delete ONU ${onuId} from ${onuPonPort}? This removes it from the OLT.`
      : onuAction === "add"
      ? `Add ONU on ${onuPonPort} with ${isGpon ? "SN" : "MAC"}: ${onuIdentifier}?`
      : `Set description on ${onuPonPort}:${onuId}?`;
    if (!confirm(confirmMsg)) return;
    setOnuBusy(true);
    try {
      let res;
      if (onuAction === "delete") {
        res = await api.post<{ ok: boolean; message: string }>(`/devices/olts/${onuOltId}/delete-onu`, {
          pon_port: onuPonPort, onu_id: Number(onuId),
        });
      } else if (onuAction === "add") {
        res = await api.post<{ ok: boolean; message: string }>(`/devices/olts/${onuOltId}/add-onu`, {
          pon_port: onuPonPort, identifier: onuIdentifier, description: onuDesc,
        });
      } else {
        res = await api.post<{ ok: boolean; message: string }>(`/devices/olts/${onuOltId}/set-description`, {
          pon_port: onuPonPort, onu_id: Number(onuId), description: onuDesc,
        });
      }
      flash(res.message);
      setOnuActionResult({ message: res.message, ok: true });
      setOnuIdentifier("");
      setOnuDesc("");
      setOnuId("");
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Operation failed";
      flash(msg, false);
      setOnuActionResult({ message: msg, ok: false });
    } finally {
      setOnuBusy(false);
    }
  };

  const saveNoc = async () => {
    if (!nocModal) return;
    try {
      const body = {
        name: nocModal.name,
        address: nocModal.address,
        gps_lat: nocModal.gps_lat ? parseFloat(nocModal.gps_lat) : null,
        gps_lng: nocModal.gps_lng ? parseFloat(nocModal.gps_lng) : null,
        contact_name: nocModal.contact_name,
        contact_phone: nocModal.contact_phone,
        notes: nocModal.notes,
      };
      if (nocModal.id) await api.put(`/noc-pop/nocs/${nocModal.id}`, body);
      else await api.post("/noc-pop/nocs", body);
      flash("NOC saved");
      setNocModal(null);
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    }
  };

  const deleteNoc = async (id: number) => {
    if (!confirm("Delete this NOC?")) return;
    try {
      await api.del(`/noc-pop/nocs/${id}`);
      flash("NOC deleted");
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", false);
    }
  };

  const savePop = async () => {
    if (!popModal) return;
    try {
      const body = {
        name: popModal.name,
        address: popModal.address,
        gps_lat: popModal.gps_lat ? parseFloat(popModal.gps_lat) : null,
        gps_lng: popModal.gps_lng ? parseFloat(popModal.gps_lng) : null,
        contact_name: popModal.contact_name,
        contact_phone: popModal.contact_phone,
        notes: popModal.notes,
      };
      if (popModal.id) await api.put(`/noc-pop/pops/${popModal.id}`, body);
      else await api.post("/noc-pop/pops", body);
      flash("POP saved");
      setPopModal(null);
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Save failed", false);
    }
  };

  const deletePop = async (id: number) => {
    if (!confirm("Delete this POP?")) return;
    try {
      await api.del(`/noc-pop/pops/${id}`);
      flash("POP deleted");
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Delete failed", false);
    }
  };

  const assignDevice = async (deviceId: number, nocId: number | null, popId: number | null) => {
    try {
      await api.put(`/noc-pop/assign-device/${deviceId}`, { noc_id: nocId, pop_id: popId });
      flash("Device assigned");
      await load();
    } catch (err) {
      flash(err instanceof Error ? err.message : "Assign failed", false);
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Devices</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">OLT and Mikrotik servers</p>
        </div>
        <div className="flex gap-2">
          {writeOk && <button className="btn-secondary" onClick={() => openNew("mikrotik")}>+ Mikrotik</button>}
          {writeOk && <button className="btn-primary" onClick={() => openNew("switch")}>+ Switch</button>}
          {writeOk && <button className="btn-primary" onClick={() => openNew("olt")}>+ OLT</button>}
        </div>
      </header>

      {notice && (
        <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Mikrotik Servers</h2>
        <div className="card overflow-x-auto">
          <Pagination page={mktPager.page} setPage={mktPager.setPage} totalPages={mktPager.totalPages} total={mktPager.total} pageSize={mktPager.pageSize} top />
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="th">#</th>
                <th className="th">Name</th>
                <th className="th">IP</th>
                <th className="th">API</th>
                <th className="th">RouterOS</th>
                <th className="th">Status</th>
                <th className="th">Last scan</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {mktPager.slice.map((d, i) => (
                <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="td text-xs text-slate-400">{mktPager.page * mktPager.pageSize + i + 1}</td>
                  <td className="td font-medium">{d.name}</td>
                  <td className="td font-mono text-xs">{d.ip}</td>
                  <td className="td">{d.api_port}{d.use_ssl ? " (TLS)" : ""}</td>
                  <td className="td">v{d.routeros_version}</td>
                  <td className="td"><StatusBadge status={d.status} /></td>
                  <td className="td text-xs">{d.last_scan_at ? fmtTime(d.last_scan_at) : "—"}</td>
                  <td className="td">
                    <div className="flex gap-1">
                      {opsOk && (
                        <>
                          <button className="btn-ghost" disabled={!!busyId} onClick={() => test("mikrotik", d.id)}>
                            {busyId === `test-mikrotik-${d.id}` ? "..." : "Test"}
                          </button>
                          <button className="btn-ghost" disabled={!!busyId} onClick={() => scan("mikrotik", d.id)}>
                            {busyId === `scan-mikrotik-${d.id}` ? "..." : "Scan"}
                          </button>
                        </>
                      )}
                      {writeOk && (
                        <>
                          <button className="btn-ghost" onClick={() => openEdit("mikrotik", d)}>Edit</button>
                          <button className="btn-ghost text-red-600" onClick={() => remove("mikrotik", d.id)}>Del</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {mikrotiks.length === 0 && (
                <tr><td className="td" colSpan={8}>No Mikrotik servers configured yet.</td></tr>
              )}
            </tbody>
          </table>
          <Pagination page={mktPager.page} setPage={mktPager.setPage} totalPages={mktPager.totalPages} total={mktPager.total} pageSize={mktPager.pageSize} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Switches</h2>
        <div className="card overflow-x-auto">
          <Pagination page={swPager.page} setPage={swPager.setPage} totalPages={swPager.totalPages} total={swPager.total} pageSize={swPager.pageSize} top />
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="th">#</th>
                <th className="th">Name</th>
                <th className="th">IP</th>
                <th className="th">Vendor</th>
                <th className="th">Access</th>
                <th className="th">Ports</th>
                <th className="th">Status</th>
                <th className="th">Last scan</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {swPager.slice.map((d, i) => (
                <React.Fragment key={d.id}>
                <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => setExpandedSwitch(expandedSwitch === d.id ? null : d.id)}>
                  <td className="td text-xs text-slate-400">{swPager.page * swPager.pageSize + i + 1}</td>
                  <td className="td font-medium">{d.name} {d.ports?.length ? <span className="ml-1 text-xs text-slate-400">({d.ports.length} ports)</span> : null}</td>
                  <td className="td font-mono text-xs">{d.ip}</td>
                  <td className="td">{d.vendor}</td>
                  <td className="td">{d.access_method}{d.access_method !== "snmp" ? `:${d.port}` : ""}{d.snmp_enabled ? " + SNMP" : ""}</td>
                  <td className="td">{d.port_count}</td>
                  <td className="td"><StatusBadge status={d.status} /></td>
                  <td className="td text-xs">{d.last_scan_at ? fmtTime(d.last_scan_at) : "—"}</td>
                  <td className="td" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      {opsOk && (
                        <>
                          <button className="btn-ghost" disabled={!!busyId} onClick={() => test("switch", d.id)}>
                            {busyId === `test-switch-${d.id}` ? "..." : "Test"}
                          </button>
                          <button className="btn-ghost" disabled={!!busyId} onClick={() => scan("switch", d.id)}>
                            {busyId === `scan-switch-${d.id}` ? "..." : "Scan"}
                          </button>
                        </>
                      )}
                      {writeOk && (
                        <>
                          <button className="btn-ghost" onClick={() => openEdit("switch", d)}>Edit</button>
                          <button className="btn-ghost text-red-600" onClick={() => remove("switch", d.id)}>Del</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {expandedSwitch === d.id && d.ports?.length ? (
                  <tr>
                    <td colSpan={9} className="bg-slate-50 dark:bg-slate-800/30 px-6 py-3">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-slate-500 dark:text-slate-400">
                            <th className="py-1 pr-4">Port</th>
                            <th className="py-1 pr-4">Status</th>
                            <th className="py-1 pr-4">Speed</th>
                            <th className="py-1 pr-4">VLAN</th>
                            <th className="py-1 pr-4">MAC</th>
                            <th className="py-1 pr-4">Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                          {d.ports.map((p) => (
                            <tr key={p.id}>
                              <td className="py-1 pr-4 font-mono">{p.name}</td>
                              <td className="py-1 pr-4">
                                <span className={`badge ${p.status === "up" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"}`}>{p.status}</span>
                              </td>
                              <td className="py-1 pr-4">{p.speed || "—"}</td>
                              <td className="py-1 pr-4">{p.vlan || "—"}</td>
                              <td className="py-1 pr-4 font-mono">{p.mac_address || "—"}</td>
                              <td className="py-1 pr-4">{p.description || "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                ) : null}
                </React.Fragment>
              ))}
              {switches.length === 0 && (
                <tr><td className="td" colSpan={9}>No switches configured yet.</td></tr>
              )}
            </tbody>
          </table>
          <Pagination page={swPager.page} setPage={swPager.setPage} totalPages={swPager.totalPages} total={swPager.total} pageSize={swPager.pageSize} />
        </div>
      </section>

      {/* NOC / POP Tabbed Section */}
      <section>
        <div className="card">
          <div className="flex border-b border-slate-200 dark:border-slate-700">
            <button className={`px-4 py-2.5 text-sm font-medium transition ${nocPopTab === "noc" ? "text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`} onClick={() => setNocPopTab("noc")}>
              NOC <span className="ml-1 text-xs bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{nocs.length}</span>
            </button>
            <button className={`px-4 py-2.5 text-sm font-medium transition ${nocPopTab === "pop" ? "text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"}`} onClick={() => setNocPopTab("pop")}>
              POP <span className="ml-1 text-xs bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded-full">{pops.length}</span>
            </button>
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{nocPopTab === "noc" ? "Network Operations Center" : "Point of Presence"}</h3>
              {writeOk && (
                <button className="btn-primary text-xs" onClick={() => nocPopTab === "noc"
                  ? setNocModal({ name: "", address: "", gps_lat: "", gps_lng: "", contact_name: "", contact_phone: "", notes: "" })
                  : setPopModal({ name: "", address: "", gps_lat: "", gps_lng: "", contact_name: "", contact_phone: "", notes: "" })
                }>+ {nocPopTab === "noc" ? "NOC" : "POP"}</button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {nocPopTab === "noc" ? nocs.map((n) => (
                <div key={n.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold text-slate-900 dark:text-white text-sm">{n.name}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{n.address || "No address"}</p>
                      {n.gps_lat && n.gps_lng && <p className="text-xs text-slate-400 mt-0.5">GPS: {n.gps_lat}, {n.gps_lng}</p>}
                    </div>
                    <div className="flex gap-0.5">
                      {writeOk && <button className="btn-ghost text-xs px-1.5 py-0.5" onClick={() => setNocModal({ id: n.id, name: n.name, address: n.address, gps_lat: String(n.gps_lat || ""), gps_lng: String(n.gps_lng || ""), contact_name: n.contact_name, contact_phone: n.contact_phone, notes: n.notes })}>Edit</button>}
                      {writeOk && <button className="btn-ghost text-xs text-red-600 px-1.5 py-0.5" onClick={() => deleteNoc(n.id)}>Del</button>}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>{n.device_count} device{n.device_count !== 1 ? "s" : ""}</span>
                    {n.contact_name && <span>Contact: {n.contact_name}</span>}
                  </div>
                </div>
              )) : pops.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold text-slate-900 dark:text-white text-sm">{p.name}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{p.address || "No address"}</p>
                      {p.gps_lat && p.gps_lng && <p className="text-xs text-slate-400 mt-0.5">GPS: {p.gps_lat}, {p.gps_lng}</p>}
                    </div>
                    <div className="flex gap-0.5">
                      {writeOk && <button className="btn-ghost text-xs px-1.5 py-0.5" onClick={() => setPopModal({ id: p.id, name: p.name, address: p.address, gps_lat: String(p.gps_lat || ""), gps_lng: String(p.gps_lng || ""), contact_name: p.contact_name, contact_phone: p.contact_phone, notes: p.notes })}>Edit</button>}
                      {writeOk && <button className="btn-ghost text-xs text-red-600 px-1.5 py-0.5" onClick={() => deletePop(p.id)}>Del</button>}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>{p.device_count} device{p.device_count !== 1 ? "s" : ""}</span>
                    {p.contact_name && <span>Contact: {p.contact_name}</span>}
                  </div>
                </div>
              ))}
              {((nocPopTab === "noc" && nocs.length === 0) || (nocPopTab === "pop" && pops.length === 0)) && (
                <p className="text-sm text-slate-400 col-span-full">No {nocPopTab === "noc" ? "NOCs" : "POPs"} configured yet.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="card overflow-x-auto">
          <Pagination page={oltPager.page} setPage={oltPager.setPage} totalPages={oltPager.totalPages} total={oltPager.total} pageSize={oltPager.pageSize} top />
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
              <tr>
                <th className="th">#</th>
                <th className="th">Name</th>
                <th className="th">IP</th>
                <th className="th">Vendor / PON</th>
                <th className="th">Access</th>
                <th className="th">NOC</th>
                <th className="th">POP</th>
                <th className="th">ONUs</th>
                <th className="th">Status</th>
                <th className="th">Last scan</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
              {oltPager.slice.map((d, i) => (
                <tr key={d.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="td text-xs text-slate-400">{oltPager.page * oltPager.pageSize + i + 1}</td>
                  <td className="td font-medium">{d.name}</td>
                  <td className="td font-mono text-xs">{d.ip}</td>
                  <td className="td">{d.vendor} · {d.pon_type.toUpperCase()}</td>
                  <td className="td">{d.access_method}{d.access_method !== "snmp" ? `:${d.port}` : ""}{d.snmp_enabled ? " + SNMP" : ""}</td>
                  <td className="td text-xs">{nocs.find((n) => n.id === d.noc_id)?.name || "—"}</td>
                  <td className="td text-xs">{pops.find((p) => p.id === d.pop_id)?.name || "—"}</td>
                  <td className="td">{d.onu_count}</td>
                  <td className="td"><StatusBadge status={d.status} /></td>
                  <td className="td text-xs">{d.last_scan_at ? fmtTime(d.last_scan_at) : "—"}</td>
                  <td className="td">
                    <div className="flex gap-1">
                      {opsOk && (
                        <>
                          <button className="btn-ghost" disabled={!!busyId} onClick={() => test("olt", d.id)}>
                            {busyId === `test-olt-${d.id}` ? "..." : "Test"}
                          </button>
                          <button className="btn-ghost" disabled={!!busyId} onClick={() => scan("olt", d.id)}>
                            {busyId === `scan-olt-${d.id}` ? "..." : "Scan"}
                          </button>
                        </>
                      )}
                      {writeOk && (
                        <>
                          <button className="btn-ghost" onClick={() => openEdit("olt", d)}>Edit</button>
                          <button className="btn-ghost text-red-600" onClick={() => remove("olt", d.id)}>Del</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {olts.length === 0 && (
                <tr><td className="td" colSpan={11}>No OLT devices configured yet.</td></tr>
              )}
            </tbody>
          </table>
          <Pagination page={oltPager.page} setPage={oltPager.setPage} totalPages={oltPager.totalPages} total={oltPager.total} pageSize={oltPager.pageSize} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">ONU / ONT Management</h2>

        <div className="card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label">OLT</label>
              <select className="input w-56" value={onuOltId} onChange={(e) => { setOnuOltId(e.target.value ? Number(e.target.value) : ""); setOnuPonPort(""); setOnuId(""); setOnuIdentifier(""); setOnuDesc(""); }}>
                <option value="">Select OLT</option>
                {olts.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.pon_type})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Action</label>
              <select className="input w-40" value={onuAction} onChange={(e) => { setOnuAction(e.target.value as typeof onuAction); setOnuId(""); setOnuIdentifier(""); setOnuDesc(""); }}>
                <option value="delete">Delete from OLT</option>
                <option value="add">Add to OLT</option>
                <option value="description">Set Description</option>
              </select>
            </div>
            <div>
              <label className="label">PON Port</label>
              <select className="input w-48" value={onuPonPort} onChange={(e) => { setOnuPonPort(e.target.value); setOnuId(""); }} disabled={!onuOltId}>
                <option value="">Select port</option>
                {onuPorts.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {(onuAction === "delete" || onuAction === "description") && (
              <div>
                <label className="label">ONU ID</label>
                <input className="input w-24" type="number" min="1" placeholder="e.g. 5" value={onuId} onChange={(e) => setOnuId(e.target.value)} disabled={!onuPonPort} />
              </div>
            )}
            {onuAction === "add" && (
              <div>
                <label className="label">{isGpon ? "SN (VENDOR:SERIAL)" : "MAC (XX.XX.XX.XX.XX.XX)"}</label>
                <input className="input w-56" placeholder={isGpon ? "HWTC:9E6DDA88" : "00d5.9f92.0c88"} value={onuIdentifier} onChange={(e) => setOnuIdentifier(e.target.value)} disabled={!onuPonPort} />
              </div>
            )}
            {(onuAction === "add" || onuAction === "description") && (
              <div>
                <label className="label">Description (no spaces, use _)</label>
                <input className="input w-64" placeholder="25021902_RPM_C_B" value={onuDesc} onChange={(e) => setOnuDesc(e.target.value)} disabled={!onuPonPort} />
              </div>
            )}
            <button
              className={onuAction === "delete" ? "btn-primary bg-red-600 hover:bg-red-700" : "btn-primary"}
              disabled={!onuPonPort || onuBusy || (onuAction === "delete" && !onuId) || (onuAction === "add" && !onuIdentifier) || (onuAction === "description" && (!onuId || !onuDesc))}
              onClick={execOnuAction}
            >
              {onuBusy ? "Working..." : onuAction === "delete" ? "Delete from OLT" : onuAction === "add" ? "Add to OLT" : "Set Description"}
            </button>
          </div>
          {onuOlt && onuAction === "delete" && (
            <WarningBanner level="danger" title="Warning: This will permanently remove the ONU from the OLT" className="mt-3">
              Enter the PON port and ONU ID, then click "Delete from OLT" to proceed.
            </WarningBanner>
          )}
          {onuOlt && onuAction === "add" && (
            <div className="mt-3 text-xs text-slate-400">
              {onuOlt.name} &middot; {isGpon ? "GPON" : "EPON"} &middot; Enter {isGpon ? "Serial Number with vendor prefix" : "MAC address"} and optional description
            </div>
          )}
          {onuOlt && onuAction === "description" && (
            <div className="mt-3 text-xs text-slate-400">
              {onuOlt.name} &middot; {isGpon ? "GPON" : "EPON"} &middot; Sets ONU description on OLT (no spaces, max 32 chars)
            </div>
          )}
        </div>

        {onuActionResult && (
          <ActionResultBanner ok={onuActionResult.ok} message={onuActionResult.message} onDismiss={() => setOnuActionResult(null)} className="mt-3" />
        )}

        <div className="mt-4">
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Scan Rejected ONUs</h3>
            <select className="input w-56 text-xs py-1" value={scanOltId} onChange={(e) => { setScanOltId(e.target.value ? Number(e.target.value) : ""); setRejectedOnus([]); setAddResult(null); }}>
              <option value="">Select OLT</option>
              {olts.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.pon_type})</option>)}
            </select>
            <button className="btn-secondary text-xs" disabled={!scanOltId || rejectedLoading !== null} onClick={() => scanOltId && discoverRejected(scanOltId)}>
              {rejectedLoading ? "Scanning..." : "Scan"}
            </button>
          </div>

          {addResult && (
            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
                  <svg className="h-4 w-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{addResult.message}</div>
                  <div className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                    Bound on <span className="font-mono font-semibold">{addResult.pon_port}</span> as sequence <span className="font-mono font-semibold">{addResult.onu_id}</span>
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-emerald-500 dark:text-emerald-500">
                    {(() => {
                      const m = addResult.pon_port.match(/^(EPON|GPON)(\d+\/\d+):(\d+)$/);
                      if (!m) return addResult.pon_port;
                      const type = m[1].toLowerCase();
                      const base = m[2];
                      const seq = addResult.onu_id;
                      return type === "epon"
                        ? `interface epon ${base}\nepon bind-onu sequence ${seq}`
                        : `interface gpon ${base}\ngpon bind-onu sequence ${seq}`;
                    })()}
                  </div>
                </div>
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
                        {writeOk && (
                          <button
                            className="btn-primary text-xs py-1 px-3"
                            disabled={rejectedLoading === -1}
                            onClick={async () => {
                              setRejectedLoading(-1);
                              try {
                                const ponBase = r.pon_port.replace(/:\d+$/, "");
                                const res = await api.post<{ ok: boolean; message: string; pon_port: string; onu_id: number }>(`/devices/olts/${r.olt_id}/add-onu`, {
                                  pon_port: ponBase,
                                  identifier: r.serial || "",
                                  description: r.description || "",
                                  sequence: r.sequence || null,
                                });
                                setAddResult({ pon_port: res.pon_port, onu_id: res.onu_id, message: res.message });
                                setRejectedOnus((prev) => prev.filter((_, idx) => idx !== i));
                                await load();
                              } catch (err) {
                                flash(err instanceof Error ? err.message : "Add failed", false);
                              } finally {
                                setRejectedLoading(null);
                              }
                            }}
                          >
                            {rejectedLoading === -1 ? "..." : "Add"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : rejectedLoading ? (
            <div className="card p-4 text-sm text-slate-400">Scanning for rejected ONUs...</div>
          ) : scanOltId ? (
            <div className="card p-4 text-sm text-slate-400">Click "Scan" to discover rejected ONUs.</div>
          ) : (
            <div className="card p-4 text-sm text-slate-400">Select an OLT and click "Scan" to discover rejected ONUs.</div>
          )}
        </div>
      </section>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setModal(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">
              {modal.id ? "Edit" : "Add"}               {modal.kind === "olt" ? "OLT Device" : modal.kind === "switch" ? "Switch" : "Mikrotik Server"}
            </h2>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <label className="label">Name</label>
                <input className="input" value={modal.name} onChange={(e) => setModal({ ...modal, name: e.target.value })} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">IP Address</label>
                  <input className="input font-mono" value={modal.ip} onChange={(e) => setModal({ ...modal, ip: e.target.value })} required />
                </div>
                <div>
                  <label className="label">Enabled</label>
                  <select className="input" value={modal.enabled ? "1" : "0"} onChange={(e) => setModal({ ...modal, enabled: e.target.value === "1" })}>
                    <option value="1">Yes</option>
                    <option value="0">No</option>
                  </select>
                </div>
              </div>

              {modal.kind === "olt" && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="label">Vendor</label>
                      <select className="input" value={modal.vendor} onChange={(e) => setModal({ ...modal, vendor: e.target.value })}>
                        <option value="bdcom">BDCOM</option>
                        <option value="zte">ZTE</option>
                        <option value="huawei">Huawei</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">PON type</label>
                      <select className="input" value={modal.pon_type} onChange={(e) => setModal({ ...modal, pon_type: e.target.value })}>
                        <option value="gpon">GPON</option>
                        <option value="epon">EPON</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Management Access</label>
                      <select className="input" value={modal.access_method} onChange={(e) => setModal({ ...modal, access_method: e.target.value })}>
                        <option value="telnet">Telnet</option>
                        <option value="ssh">SSH</option>
                        <option value="both">Both (SSH + Telnet)</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="label">Port ({modal.access_method === "both" ? "SSH" : modal.access_method})</label>
                      <input type="number" className="input" value={modal.port} onChange={(e) => setModal({ ...modal, port: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label className="label">SNMP Monitoring</label>
                      <select className="input" value={modal.snmp_enabled ? "1" : "0"} onChange={(e) => setModal({ ...modal, snmp_enabled: e.target.value === "1" })}>
                        <option value="0">Disabled</option>
                        <option value="1">Enabled</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">SNMP Community</label>
                      <input className="input" value={modal.snmp_community} onChange={(e) => setModal({ ...modal, snmp_community: e.target.value })} disabled={!modal.snmp_enabled} />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="label">Username</label>
                      <input className="input" value={modal.username} onChange={(e) => setModal({ ...modal, username: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Password</label>
                      <input className="input" type="password" value={modal.password} onChange={(e) => setModal({ ...modal, password: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Enable password</label>
                      <input className="input" type="password" value={modal.enable_password} onChange={(e) => setModal({ ...modal, enable_password: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">NOC</label>
                      <select className="input" value={modal.noc_id || ""} onChange={(e) => setModal({ ...modal, noc_id: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">None</option>
                        {nocs.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">POP</label>
                      <select className="input" value={modal.pop_id || ""} onChange={(e) => setModal({ ...modal, pop_id: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">None</option>
                        {pops.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {modal.kind === "mikrotik" && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="label">API port</label>
                      <input type="number" className="input" value={modal.api_port} onChange={(e) => setModal({ ...modal, api_port: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label className="label">RouterOS</label>
                      <select className="input" value={modal.routeros_version} onChange={(e) => setModal({ ...modal, routeros_version: Number(e.target.value) })}>
                        <option value={6}>v6</option>
                        <option value={7}>v7</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Use SSL</label>
                      <select className="input" value={modal.use_ssl ? "1" : "0"} onChange={(e) => setModal({ ...modal, use_ssl: e.target.value === "1" })}>
                        <option value="0">No</option>
                        <option value="1">Yes</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="label">Username</label>
                      <input className="input" value={modal.username} onChange={(e) => setModal({ ...modal, username: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Password</label>
                      <input className="input" type="password" value={modal.password} onChange={(e) => setModal({ ...modal, password: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Enable password</label>
                      <input className="input" type="password" value={modal.enable_password} onChange={(e) => setModal({ ...modal, enable_password: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">NOC</label>
                      <select className="input" value={modal.noc_id || ""} onChange={(e) => setModal({ ...modal, noc_id: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">None</option>
                        {nocs.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">POP</label>
                      <select className="input" value={modal.pop_id || ""} onChange={(e) => setModal({ ...modal, pop_id: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">None</option>
                        {pops.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}

              {modal.kind === "switch" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Vendor</label>
                      <select className="input" value={modal.vendor} onChange={(e) => setModal({ ...modal, vendor: e.target.value })}>
                        <option value="bdcom">BDCOM</option>
                        <option value="cisco">Cisco</option>
                        <option value="huawei">Huawei</option>
                        <option value="mikrotik">Mikrotik</option>
                        <option value="generic">Generic</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="label">Management Access</label>
                      <select className="input" value={modal.access_method} onChange={(e) => setModal({ ...modal, access_method: e.target.value })}>
                        <option value="telnet">Telnet</option>
                        <option value="ssh">SSH</option>
                        <option value="both">Both (SSH + Telnet)</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Port ({modal.access_method === "both" ? "SSH" : modal.access_method})</label>
                      <input type="number" className="input" value={modal.port} onChange={(e) => setModal({ ...modal, port: Number(e.target.value) })} />
                    </div>
                    <div>
                      <label className="label">SNMP Monitoring</label>
                      <select className="input" value={modal.snmp_enabled ? "1" : "0"} onChange={(e) => setModal({ ...modal, snmp_enabled: e.target.value === "1" })}>
                        <option value="0">Disabled</option>
                        <option value="1">Enabled</option>
                      </select>
                    </div>
                  </div>
                  {modal.snmp_enabled && (
                    <div>
                      <label className="label">SNMP Community</label>
                      <input className="input" value={modal.snmp_community} onChange={(e) => setModal({ ...modal, snmp_community: e.target.value })} />
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="label">Username</label>
                      <input className="input" value={modal.username} onChange={(e) => setModal({ ...modal, username: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Password</label>
                      <input className="input" type="password" value={modal.password} onChange={(e) => setModal({ ...modal, password: e.target.value })} />
                    </div>
                    <div>
                      <label className="label">Enable password</label>
                      <input className="input" type="password" value={modal.enable_password} onChange={(e) => setModal({ ...modal, enable_password: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">NOC</label>
                      <select className="input" value={modal.noc_id || ""} onChange={(e) => setModal({ ...modal, noc_id: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">None</option>
                        {nocs.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">POP</label>
                      <select className="input" value={modal.pop_id || ""} onChange={(e) => setModal({ ...modal, pop_id: e.target.value ? Number(e.target.value) : null })}>
                        <option value="">None</option>
                        {pops.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" className="btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {authorizeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setAuthorizeModal(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">Authorize ONU from Rejected</h2>
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              This will register the ONU on the OLT and add it to the application inventory.
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">PON Port</label>
                  <input className="input font-mono" value={authorizeModal.pon_port} disabled />
                </div>
                <div>
                  <label className="label">ONU ID</label>
                  <input className="input" value={authorizeModal.onu_id} disabled />
                </div>
              </div>
              <div>
                <label className="label">Serial / MAC</label>
                <input className="input font-mono" value={authorizeModal.serial} disabled />
              </div>
              <div>
                <label className="label">Description</label>
                <input className="input" value={authorizeModal.description || "—"} disabled />
              </div>
              <div>
                <label className="label">Reason</label>
                <input className="input" value={authorizeModal.reason || "—"} disabled />
              </div>
              <div>
                <label className="label">Customer / Name (optional)</label>
                <input className="input" value={authName} onChange={(e) => setAuthName(e.target.value)} placeholder="e.g. John Doe" />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <button type="button" className="btn-secondary" onClick={() => setAuthorizeModal(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={authorizeOnu}>Authorize & Add ONU</button>
            </div>
          </div>
        </div>
      )}

      {/* NOC Modal */}
      {nocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setNocModal(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">{nocModal.id ? "Edit NOC" : "New NOC"}</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Name *</label>
                <input className="input" value={nocModal.name} onChange={(e) => setNocModal({ ...nocModal, name: e.target.value.toUpperCase() })} placeholder="NOC BARISHAL" />
              </div>
              <div>
                <label className="label">Address *</label>
                <input className="input" value={nocModal.address} onChange={(e) => setNocModal({ ...nocModal, address: e.target.value })} placeholder="123 Main St, Barishal" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Latitude</label>
                  <input className="input" type="number" step="any" value={nocModal.gps_lat} onChange={(e) => setNocModal({ ...nocModal, gps_lat: e.target.value })} placeholder="22.701" />
                </div>
                <div>
                  <label className="label">Longitude</label>
                  <input className="input" type="number" step="any" value={nocModal.gps_lng} onChange={(e) => setNocModal({ ...nocModal, gps_lng: e.target.value })} placeholder="90.353" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Contact Name</label>
                  <input className="input" value={nocModal.contact_name} onChange={(e) => setNocModal({ ...nocModal, contact_name: e.target.value })} />
                </div>
                <div>
                  <label className="label">Contact Phone</label>
                  <input className="input" value={nocModal.contact_phone} onChange={(e) => setNocModal({ ...nocModal, contact_phone: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input" rows={2} value={nocModal.notes} onChange={(e) => setNocModal({ ...nocModal, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <button type="button" className="btn-secondary" onClick={() => setNocModal(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={saveNoc}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* POP Modal */}
      {popModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setPopModal(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white">{popModal.id ? "Edit POP" : "New POP"}</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Name *</label>
                <input className="input" value={popModal.name} onChange={(e) => setPopModal({ ...popModal, name: e.target.value.toUpperCase() })} placeholder="POP SADAR" />
              </div>
              <div>
                <label className="label">Address *</label>
                <input className="input" value={popModal.address} onChange={(e) => setPopModal({ ...popModal, address: e.target.value })} placeholder="Sadar Road, Barishal" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Latitude</label>
                  <input className="input" type="number" step="any" value={popModal.gps_lat} onChange={(e) => setPopModal({ ...popModal, gps_lat: e.target.value })} placeholder="22.715" />
                </div>
                <div>
                  <label className="label">Longitude</label>
                  <input className="input" type="number" step="any" value={popModal.gps_lng} onChange={(e) => setPopModal({ ...popModal, gps_lng: e.target.value })} placeholder="90.370" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Contact Name</label>
                  <input className="input" value={popModal.contact_name} onChange={(e) => setPopModal({ ...popModal, contact_name: e.target.value })} />
                </div>
                <div>
                  <label className="label">Contact Phone</label>
                  <input className="input" value={popModal.contact_phone} onChange={(e) => setPopModal({ ...popModal, contact_phone: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input" rows={2} value={popModal.notes} onChange={(e) => setPopModal({ ...popModal, notes: e.target.value })} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <button type="button" className="btn-secondary" onClick={() => setPopModal(null)}>Cancel</button>
              <button type="button" className="btn-primary" onClick={savePop}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
