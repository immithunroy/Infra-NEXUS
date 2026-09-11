/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { NocItem, PopItem, NOC_PHOTO_TYPES, NOC_PHOTO_LABELS, POP_PHOTO_TYPES, POP_PHOTO_LABELS } from "../api/types";
import PhotoGallery from "./PhotoGallery";

type NocPopItem = (NocItem | PopItem) & { type: "noc" | "pop" };

export default function NocPopDetailPanel({ item, onClose, onRefresh, writeOk }: {
  item: NocPopItem;
  onClose: () => void;
  onRefresh: () => void;
  writeOk: boolean;
}) {
  const [tab, setTab] = useState<"olts" | "tjs" | "photos">("olts");
  const [showAddOlt, setShowAddOlt] = useState(false);
  const [showAddTj, setShowAddTj] = useState(false);
  const [editForm, setEditForm] = useState({
    name: item.name || "",
    address: item.address || "",
    contact_name: item.contact_name || (item as any).contact_name || "",
    contact_phone: item.contact_phone || (item as any).contact_phone || "",
    notes: item.notes || "",
  });
  const [showEdit, setShowEdit] = useState(false);
  const [allOlts, setAllOlts] = useState<any[]>([]);
  const [allTjs, setAllTjs] = useState<any[]>([]);

  const isNoc = item.type === "noc";
  const photoTypes = isNoc ? NOC_PHOTO_TYPES : POP_PHOTO_TYPES;
  const photoLabels = isNoc ? NOC_PHOTO_LABELS : POP_PHOTO_LABELS;
  const entityPrefix = isNoc ? "noc" : "pop";

  useEffect(() => {
    Promise.allSettled([
      api.get<any[]>("/devices/olts"),
      api.get<any[]>("/fiber/tj-boxes"),
    ]).then(([oltsRes, tjsRes]) => {
      if (oltsRes.status === "fulfilled") setAllOlts(oltsRes.value);
      if (tjsRes.status === "fulfilled") setAllTjs(tjsRes.value);
    });
  }, []);

  const hostedOlts = allOlts.filter((o: any) => isNoc ? o.noc_id === item.id : o.pop_id === item.id);
  const hostedTjs = allTjs.filter((t: any) => isNoc ? t.noc_id === item.id : t.pop_id === item.id);

  const availableOlts = allOlts.filter((o: any) => isNoc ? !o.noc_id : !o.pop_id);
  const availableTjs = allTjs.filter((t: any) => isNoc ? !t.noc_id : !t.pop_id);

  const assignOlt = async (oltId: number) => {
    try {
      await api.put(`/noc-pop/assign-device/${oltId}`, isNoc ? { noc_id: item.id } : { pop_id: item.id });
      setShowAddOlt(false);
      onRefresh();
    } catch (e) { alert(String(e)); }
  };

  const unassignOlt = async (oltId: number) => {
    if (!confirm("Remove this OLT from this " + (isNoc ? "NOC" : "POP") + "?")) return;
    try {
      await api.del(`/noc-pop/assign-device/${oltId}`);
      onRefresh();
    } catch (e) { alert(String(e)); }
  };

  const assignTj = async (tjId: number) => {
    try {
      await api.put(`/noc-pop/assign-tj/${tjId}`, isNoc ? { noc_id: item.id } : { pop_id: item.id });
      setShowAddTj(false);
      onRefresh();
    } catch (e) { alert(String(e)); }
  };

  const unassignTj = async (tjId: number) => {
    if (!confirm("Remove this TJ box from this " + (isNoc ? "NOC" : "POP") + "?")) return;
    try {
      await api.del(`/noc-pop/assign-tj/${tjId}`);
      onRefresh();
    } catch (e) { alert(String(e)); }
  };

  const saveEdit = async () => {
    try {
      const endpoint = isNoc ? `/noc-pop/nocs/${item.id}` : `/noc-pop/pops/${item.id}`;
      await api.put(endpoint, editForm);
      setShowEdit(false);
      onRefresh();
    } catch (e) { alert(String(e)); }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isNoc ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"}`}>
              {isNoc ? "NOC" : "POP"}
            </span>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{item.name}</h2>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{item.address || "—"}</p>
          {(item.contact_name || item.contact_phone) && (
            <p className="text-xs text-slate-400 mt-0.5">{item.contact_name}{item.contact_phone ? ` · ${item.contact_phone}` : ""}</p>
          )}
          {item.notes && <p className="text-xs text-slate-400 mt-1">{item.notes}</p>}
        </div>
        <div className="flex items-center gap-1">
          {writeOk && <button className="btn-secondary text-[10px] py-1 px-2" onClick={() => setShowEdit(true)}>Edit</button>}
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      {/* Summary badges */}
      <div className="flex gap-2 mb-3">
        <span className="text-[10px] px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-semibold">{hostedOlts.length} OLT{hostedOlts.length !== 1 ? "s" : ""}</span>
        <span className="text-[10px] px-2 py-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 font-semibold">{hostedTjs.length} TJ Box{hostedTjs.length !== 1 ? "es" : ""}</span>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 mb-3">
        <button className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${tab === "olts" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`} onClick={() => setTab("olts")}>OLTs ({hostedOlts.length})</button>
        <button className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${tab === "tjs" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`} onClick={() => setTab("tjs")}>TJ Boxes ({hostedTjs.length})</button>
        <button className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${tab === "photos" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`} onClick={() => setTab("photos")}>Photos</button>
      </div>

      {/* OLTs tab */}
      {tab === "olts" && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hosted OLTs ({hostedOlts.length})</h3>
            {writeOk && (
              <button className="btn-primary text-[10px] py-0.5 px-2" onClick={() => setShowAddOlt(true)}>+ Add OLT</button>
            )}
          </div>
          {hostedOlts.length > 0 ? (
            <div className="space-y-2">
              {hostedOlts.map((olt: any) => (
                <div key={olt.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 group relative">
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${olt.status === "reachable" ? "bg-emerald-500" : "bg-red-500"}`} />
                    <span className="font-semibold text-sm">{olt.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{olt.ip}</span>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 uppercase">{olt.pon_type}</span>
                  </div>
                  {writeOk && (
                    <div className="hidden group-hover:flex absolute top-2 right-2">
                      <button className="text-[9px] text-red-500 hover:underline" onClick={() => unassignOlt(olt.id)}>Remove</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-400">No OLTs hosted here yet.</div>
          )}
        </div>
      )}

      {/* TJ Boxes tab */}
      {tab === "tjs" && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hosted TJ Boxes ({hostedTjs.length})</h3>
            {writeOk && (
              <button className="btn-primary text-[10px] py-0.5 px-2" onClick={() => setShowAddTj(true)}>+ Add TJ Box</button>
            )}
          </div>
          {hostedTjs.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {hostedTjs.map((tj: any) => (
                <div key={tj.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 group relative">
                  <div className="font-semibold text-sm">{tj.unique_id}</div>
                  <div className="text-xs text-slate-500">{tj.name || tj.box_type} · {tj.tj_port} ports</div>
                  {writeOk && (
                    <div className="hidden group-hover:flex absolute top-2 right-2">
                      <button className="text-[9px] text-red-500 hover:underline" onClick={() => unassignTj(tj.id)}>Remove</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-400">No TJ boxes hosted here yet.</div>
          )}
        </div>
      )}

      {/* Photos tab */}
      {tab === "photos" && (
        <div className="mb-4">
          <PhotoGallery
            entityType={entityPrefix}
            entityId={String(item.id)}
            photoTypes={photoTypes}
            photoLabels={photoLabels}
          />
        </div>
      )}

      {/* Add OLT modal */}
      {showAddOlt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddOlt(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md p-5 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-3">Add OLT to {item.name}</h3>
            {availableOlts.length > 0 ? (
              <div className="space-y-2">
                {availableOlts.map((olt: any) => (
                  <div key={olt.id} className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 p-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                    <div>
                      <div className="font-semibold text-sm">{olt.name}</div>
                      <div className="text-xs text-slate-500">{olt.ip} · {olt.pon_type}</div>
                    </div>
                    <button className="btn-primary text-[10px] py-1 px-2" onClick={() => assignOlt(olt.id)}>Add</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400">All OLTs are already assigned.</div>
            )}
            <div className="flex justify-end pt-3">
              <button className="btn-secondary text-xs" onClick={() => setShowAddOlt(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Add TJ Box modal */}
      {showAddTj && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowAddTj(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md p-5 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-3">Add TJ Box to {item.name}</h3>
            {availableTjs.length > 0 ? (
              <div className="space-y-2">
                {availableTjs.map((tj: any) => (
                  <div key={tj.id} className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-slate-700 p-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                    <div>
                      <div className="font-semibold text-sm">{tj.unique_id} — {tj.name || tj.box_type}</div>
                      <div className="text-xs text-slate-500">{tj.tj_port} ports · {tj.address || "—"}</div>
                    </div>
                    <button className="btn-primary text-[10px] py-1 px-2" onClick={() => assignTj(tj.id)}>Add</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400">All TJ boxes are already assigned.</div>
            )}
            <div className="flex justify-end pt-3">
              <button className="btn-secondary text-xs" onClick={() => setShowAddTj(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {showEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowEdit(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold mb-3">Edit {isNoc ? "NOC" : "POP"}</h3>
            <div className="space-y-3">
              <div><label className="label">Name</label><input className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
              <div><label className="label">Address</label><input className="input" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} /></div>
              <div><label className="label">Contact Name</label><input className="input" value={editForm.contact_name} onChange={(e) => setEditForm({ ...editForm, contact_name: e.target.value })} /></div>
              <div><label className="label">Contact Phone</label><input className="input" value={editForm.contact_phone} onChange={(e) => setEditForm({ ...editForm, contact_phone: e.target.value })} /></div>
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setShowEdit(false)}>Cancel</button>
                <button className="btn-primary" onClick={saveEdit}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-slate-400">
        GPS: {(item.gps_lat || (item as any).lat)?.toFixed(6)}, {(item.gps_lng || (item as any).lng)?.toFixed(6)}
      </div>
    </div>
  );
}
