import { FormEvent, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Onu } from "../api/types";
import StatusBadge from "../components/StatusBadge";
import SubscriberLink from "../components/SubscriberLink";
import MacCell from "../components/MacCell";
import { useUserRole } from "../lib/role";
import { canWrite } from "../api/types";
import ActionResultBanner from "../components/ActionResultBanner";
import WarningBanner from "../components/WarningBanner";
import SpeedToggle from "../components/SpeedToggle";
import CapsuleToggle from "../components/CapsuleToggle";

export default function OnuProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { role } = useUserRole();
  const writeOk = canWrite(role);
  const [onu, setOnu] = useState<Onu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", serial: "", mac: "", pon_port: "", onu_id: 0, vlan: 0, note: "", subscriber: "", address: "", phone: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [portLoading, setPortLoading] = useState("");
  const [portStates, setPortStates] = useState<Record<number, boolean>>({});
  const [oltDesc, setOltDesc] = useState("");
  const [descSaving, setDescSaving] = useState(false);
  const [bwSaving, setBwSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const noticeRef = useRef<HTMLDivElement | null>(null);

  const flash = (text: string, ok = true) => {
    setNotice({ text, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  useEffect(() => {
    if (notice && noticeRef.current) {
      noticeRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [notice]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.get<Onu>(`/onus/${id}`)
      .then((o) => {
        setOnu(o);
        setForm({
          name: o.name, serial: o.serial, mac: o.mac, pon_port: o.pon_port,
          onu_id: o.onu_id, vlan: o.vlan, note: o.note, subscriber: o.subscriber,
          address: o.address, phone: o.phone, email: o.email,
        });
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      await api.put(`/onus/${id}`, form);
      const updated = await api.get<Onu>(`/onus/${id}`);
      setOnu(updated);
      setEditing(false);
    } catch (e) { setError(String(e)); }
    setSaving(false);
  };

  const togglePort = async (pid: number, enable: boolean) => {
    if (!onu) return;
    const key = `${pid}`;
    setPortLoading(key);
    try {
      const res = await api.post<{ ok: boolean; message: string }>("/onus/port-control", {
        olt_id: onu.olt_id,
        pon_port: onu.pon_port,
        onu_id: onu.onu_id,
        port_id: pid,
        enable,
      });
      flash(res.message);
      const updated = await api.get<Onu>(`/onus/${onu.id}`);
      setOnu(updated);
      setPortStates((prev) => ({ ...prev, [pid]: enable }));
    } catch (e) { setError(String(e)); }
    setPortLoading("");
  };

  const saveDescription = async () => {
    if (!onu || !oltDesc.trim()) return;
    setDescSaving(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/devices/olts/${onu.olt_id}/set-description`, {
        pon_port: onu.pon_port,
        onu_id: onu.onu_id,
        description: oltDesc.trim(),
      });
      flash(res.message);
      const updated = await api.get<Onu>(`/onus/${onu.id}`);
      setOnu(updated);
      setOltDesc("");
    } catch (e) { setError(String(e)); }
    setDescSaving(false);
  };

  const setBandwidth = async (mode: string) => {
    if (!onu) return;
    setBwSaving(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/devices/olts/${onu.olt_id}/set-bandwidth`, {
        pon_port: onu.pon_port,
        onu_id: onu.onu_id,
        mode,
      });
      flash(res.message);
      const updated = await api.get<Onu>(`/onus/${onu.id}`);
      setOnu(updated);
    } catch (e) { setError(String(e)); }
    setBwSaving(false);
  };

  const deleteFromOlt = async () => {
    if (!onu) return;
    if (!confirm(`DELETE ONU ${onu.pon_port} (ID ${onu.onu_id}) from the OLT?\n\nThis will deregister the ONU from the OLT and remove it from the application.`)) return;
    setDeleting(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/devices/olts/${onu.olt_id}/delete-onu`, {
        pon_port: onu.pon_port,
        onu_id: onu.onu_id,
      });
      await api.del(`/onus/${onu.id}`);
      flash(res.message || "ONU deleted from OLT and application");
      setTimeout(() => navigate(-1), 1500);
    } catch (e) { setError(String(e)); }
    setDeleting(false);
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!onu) return <div className="p-8 text-center text-slate-500">ONU not found</div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="btn-secondary text-sm">&larr; Back</button>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">ONU Profile</h1>
        {writeOk && !editing && (
          <button className="btn-primary text-sm" onClick={() => setEditing(true)}>Edit</button>
        )}
      </div>

      {notice && (
        <div ref={noticeRef}>
          <ActionResultBanner ok={notice.ok} message={notice.text} onDismiss={() => setNotice(null)} />
        </div>
      )}

      {/* Main info card */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-bold text-slate-900 dark:text-white">{onu.name || "Unnamed ONU"}</div>
            <div className="text-sm text-slate-500">{onu.olt_name} &middot; {onu.pon_port}</div>
          </div>
          <StatusBadge status={onu.status} />
        </div>

        {onu.down_reason && (
          <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <span className="font-semibold">Deregistered:</span> {onu.down_reason}
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <InfoBox label="Serial" value={onu.serial} mono />
          <InfoBox label="MAC" value={<MacCell mac={onu.last_mac || onu.mac} vendor={onu.mac_vendor} />} />
          <InfoBox label="PON Port" value={onu.pon_port} mono />
          <InfoBox label="ONU ID" value={String(onu.onu_id)} mono />
          <InfoBox label="VLAN" value={onu.vlan > 0 ? String(onu.vlan) : "—"} mono />
          <InfoBox label="RX Power" value={onu.rx_power != null ? `${onu.rx_power} dBm` : "—"} danger={onu.rx_power != null && onu.rx_power < -25} />
          <InfoBox label="TX Power" value={onu.tx_power != null ? `${onu.tx_power} dBm` : "—"} />
          <InfoBox label="Distance" value={onu.distance != null ? `${onu.distance} km` : "—"} />
          <InfoBox label="Source" value={onu.source} />
          <InfoBox label="Subscriber" value={<SubscriberLink subscriber={onu.subscriber} />} />
          <InfoBox label="Mikrotik IP" value={onu.mikrotik_ip || "—"} />
          <InfoBox label="Last Seen" value={onu.last_seen ? new Date(onu.last_seen).toLocaleString() : "—"} />
          <InfoBox label="State" value={onu.state} />
        </div>
      </div>

      {/* Ethernet Port Control */}
      {writeOk && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Ethernet Port Control</h3>
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4].map((pid) => {
              const isLoading = portLoading === `${pid}`;
              return (
                <div key={pid} className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">P{pid}</span>
                  <CapsuleToggle
                    leftLabel="OFF"
                    rightLabel="ON"
                    activeRight={portStates[pid] !== false}
                    loading={isLoading}
                    onToggle={(right) => togglePort(pid, right)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* EPON Bandwidth / Speed */}
      {writeOk && onu.pon_port.toUpperCase().startsWith("EPON") && (
        <div className="card p-4">
          <div className="flex items-center gap-4">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">ONU Speed</h3>
            <SpeedToggle
              value={onu.bandwidth_mode || "100m"}
              leftLabel="100M"
              rightLabel="1G"
              leftValue="100m"
              rightValue="1g"
              loading={bwSaving}
              onChange={setBandwidth}
            />
            <span className="text-[11px] text-slate-400">EPON SLA &middot; 100M = 100 Mbps guaranteed &middot; 1G = 1 Gbps peak</span>
          </div>
        </div>
      )}

      {/* OLT Description */}
      {writeOk && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">OLT Description</h3>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="label">Current: {onu.name || "—"}</label>
              <input className="input" placeholder="Type full new description (no spaces, use _)" value={oltDesc} onChange={(e) => setOltDesc(e.target.value)} />
            </div>
            <button className="btn-primary" disabled={!oltDesc.trim() || descSaving} onClick={saveDescription}>
              {descSaving ? "Saving..." : "Set on OLT"}
            </button>
          </div>
          <div className="mt-1 text-[11px] text-slate-400">Description cannot be edited — type the full new text. Format: UserID_Name_Location</div>
        </div>
      )}

      {/* Delete from OLT */}
      {writeOk && (
        <div className="card border-2 border-red-200 p-4 dark:border-red-900/50">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
              <svg className="h-5 w-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-red-700 dark:text-red-400">Delete ONU from OLT</div>
              <div className="text-xs text-red-500 dark:text-red-400/70">This will deregister the ONU from the OLT and remove it from the application. The ONU will need to be re-added manually.</div>
            </div>
            <button className="btn-primary bg-red-600 hover:bg-red-700" disabled={deleting} onClick={deleteFromOlt}>
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      )}

      {/* Location */}
      {(onu.gps_lat != null || onu.address) && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Location</h3>
          <div className="grid grid-cols-2 gap-3">
            {onu.gps_lat != null && <InfoBox label="GPS" value={`${onu.gps_lat.toFixed(6)}, ${onu.gps_lng?.toFixed(6)}`} mono />}
            {onu.gps_accuracy != null && <InfoBox label="Accuracy" value={`±${onu.gps_accuracy.toFixed(2)} m`} />}
            {onu.address && <InfoBox label="Address" value={onu.address} />}
          </div>
        </div>
      )}

      {/* Contact */}
      {(onu.phone || onu.email) && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Contact</h3>
          <div className="grid grid-cols-2 gap-3">
            {onu.phone && <InfoBox label="Phone" value={onu.phone} />}
            {onu.email && <InfoBox label="Email" value={onu.email} />}
          </div>
        </div>
      )}

      {/* Notes */}
      {onu.note && (
        <div className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">Notes</h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">{onu.note}</p>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setEditing(false)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">Edit ONU</h2>
            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Name</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><label className="label">Subscriber</label><input className="input" value={form.subscriber} onChange={(e) => setForm({ ...form, subscriber: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Serial</label><input className="input" value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} /></div>
                <div><label className="label">MAC</label><input className="input" value={form.mac} onChange={(e) => setForm({ ...form, mac: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">PON Port</label><input className="input" value={form.pon_port} onChange={(e) => setForm({ ...form, pon_port: e.target.value })} /></div>
                <div><label className="label">ONU ID</label><input type="number" className="input" value={form.onu_id} onChange={(e) => setForm({ ...form, onu_id: Number(e.target.value) })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">VLAN</label><input type="number" className="input" value={form.vlan} onChange={(e) => setForm({ ...form, vlan: Number(e.target.value) })} /></div>
                <div><label className="label">Address</label><input className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><label className="label">Email</label><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoBox({ label, value, mono, danger }: { label: string; value: React.ReactNode; mono?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
      <div className="text-[11px] text-slate-400 dark:text-slate-500">{label}</div>
      <div className={`text-sm ${mono ? "font-mono" : ""} ${danger ? "text-red-600" : "text-slate-700 dark:text-slate-200"}`}>{value || "—"}</div>
    </div>
  );
}
