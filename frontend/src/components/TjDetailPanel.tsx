/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { Cable, TjBox, Splitter, TJ_PHOTO_TYPES, TJ_PHOTO_LABELS } from "../api/types";
import PhotoGallery from "./PhotoGallery";

const CORE_COLORS_ARR = ["#3b82f6","#f97316","#22c55e","#92400e","#9ca3af","#ffffff","#ef4444","#000000","#eab308","#8b5cf6","#ec4899","#06b6d4"];
const CORE_COLOR_NAMES = ["Blue","Orange","Green","Brown","Slate","White","Red","Black","Yellow","Violet","Rose","Aqua"];

export function CoreColorDot({ coreIndex, size = 8 }: { coreIndex: number; size?: number }) {
  const color = CORE_COLORS_ARR[(coreIndex - 1) % CORE_COLORS_ARR.length];
  const needsBorder = color === "#ffffff" || color === "#000000";
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        border: needsBorder ? "1.5px solid #94a3b8" : "1.5px solid transparent",
        flexShrink: 0,
      }}
    />
  );
}

export function CoreSelect({ coreCount, value, onChange, occupiedCores, spareCores }: {
  coreCount: number; value: number; onChange: (v: number) => void;
  occupiedCores?: number[]; spareCores?: number[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  const selectedName = CORE_COLOR_NAMES[(value - 1) % CORE_COLOR_NAMES.length];
  return (
    <div ref={ref} className="relative">
      <button type="button" className="input text-xs w-full flex items-center gap-2 text-left" onClick={() => setOpen(!open)}>
        <CoreColorDot coreIndex={value} size={14} />
        <span>Core {value} — {selectedName}</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-[200px] overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
          {Array.from({ length: coreCount }, (_, i) => {
            const coreNum = i + 1;
            const isOccupied = occupiedCores?.includes(coreNum) && !spareCores?.includes(coreNum);
            const colorName = CORE_COLOR_NAMES[i % CORE_COLOR_NAMES.length];
            return (
              <button
                key={coreNum}
                type="button"
                disabled={isOccupied}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition ${coreNum === value ? "bg-blue-50 dark:bg-blue-900/30" : "hover:bg-slate-50 dark:hover:bg-slate-700/50"} ${isOccupied ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
                onClick={() => { if (!isOccupied) { onChange(coreNum); setOpen(false); } }}
              >
                <CoreColorDot coreIndex={coreNum} size={14} />
                <span className="font-mono font-semibold">Core {coreNum}</span>
                <span className="text-slate-500">— {colorName}</span>
                {isOccupied && <span className="ml-auto text-[9px] text-red-400">occupied</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TjDetailPanel({ tj, cables, splitters, splices, onClose, onSpliceChange, writeOk, onAddSplitter, onEditSplitter, onDelete }: { tj: TjBox; cables: Cable[]; splitters: Splitter[]; splices: any[]; onClose: () => void; onSpliceChange: () => void; writeOk: boolean; onAddSplitter?: () => void; onEditSplitter?: (sp: Splitter) => void; onDelete?: () => void }) {
  const hostedSplitters = useMemo(() => splitters.filter((s) => s.tj_box_id === tj.id), [splitters, tj.id]);
  const connectedCables = useMemo(() => cables.filter((c) => {
    if (!c.segments?.length) return false;
    return c.segments.some((s) =>
      Math.abs(s.start_lat - tj.lat) < 0.001 && Math.abs(s.start_lng - tj.lng) < 0.001 ||
      Math.abs(s.end_lat - tj.lat) < 0.001 && Math.abs(s.end_lng - tj.lng) < 0.001
    );
  }), [cables, tj.lat, tj.lng]);
  const tjSplices = useMemo(() => splices.filter((sp) => sp.tj_id === tj.id), [splices, tj.id]);
  const [showSpliceForm, setShowSpliceForm] = useState(false);
  const [editSplice, setEditSplice] = useState<any>(null);
  const [spliceForm, setSpliceForm] = useState<{ cable_a_id: number | null; core_a: number; cable_b_id: number | null; core_b: number; splitter_a_id: number | null; splitter_b_id: number | null; port_a: number; port_b: number; tray_id: number; status: string; notes: string }>({ cable_a_id: null, core_a: 1, cable_b_id: null, core_b: 1, splitter_a_id: null, splitter_b_id: null, port_a: 0, port_b: 0, tray_id: 1, status: "active", notes: "" });
  const [unusedCores, setUnusedCores] = useState<any[]>([]);
  const [splicePage, setSplicePage] = useState(0);
  const [spliceSearch, setSpliceSearch] = useState("");
  const [cableSearchA, setCableSearchA] = useState("");
  const [cableSearchB, setCableSearchB] = useState("");
  const [tjTab, setTjTab] = useState<"cable" | "splice" | "photos">("cable");
  const [showTjEdit, setShowTjEdit] = useState(false);
  const [tjEditForm, setTjEditForm] = useState({ name: "", address: "", notes: "" });
  const SPLICE_PAGE_SIZE = 50;

  const filteredSplices = useMemo(() => {
    if (!spliceSearch) return tjSplices;
    const q = spliceSearch.toLowerCase();
    return tjSplices.filter((sp) =>
      sp.cable_a_code?.toLowerCase().includes(q) ||
      sp.cable_b_code?.toLowerCase().includes(q) ||
      String(sp.core_a).includes(q) ||
      String(sp.core_b).includes(q) ||
      sp.status?.toLowerCase().includes(q)
    );
  }, [tjSplices, spliceSearch]);
  const pagedSplices = filteredSplices.slice(splicePage * SPLICE_PAGE_SIZE, (splicePage + 1) * SPLICE_PAGE_SIZE);
  const splicePages = Math.ceil(filteredSplices.length / SPLICE_PAGE_SIZE);

  const filteredCablesA = useMemo(() => {
    if (!cableSearchA) return connectedCables;
    const q = cableSearchA.toLowerCase();
    return connectedCables.filter((c) => c.code.toLowerCase().includes(q));
  }, [connectedCables, cableSearchA]);
  const filteredCablesB = useMemo(() => {
    if (!cableSearchB) return connectedCables;
    const q = cableSearchB.toLowerCase();
    return connectedCables.filter((c) => c.code.toLowerCase().includes(q));
  }, [connectedCables, cableSearchB]);

  const loadUnused = async () => {
    try {
      const data = await api.get<any[]>(`/fiber/splices/unused-cores?tj_id=${tj.id}`);
      setUnusedCores(data);
    } catch {}
  };

  const openSpliceForm = (splice?: any) => {
    loadUnused();
    if (splice) {
      setEditSplice(splice);
      setSpliceForm({
        cable_a_id: splice.cable_a_id || null, core_a: splice.core_a || 1,
        cable_b_id: splice.cable_b_id || null, core_b: splice.core_b || 1,
        splitter_a_id: splice.splitter_a_id || null, splitter_b_id: splice.splitter_b_id || null,
        port_a: splice.port_a || 0, port_b: splice.port_b || 0,
        tray_id: splice.tray_id || 1, status: splice.status || "active", notes: splice.notes || "",
      });
    } else {
      setEditSplice(null);
      setSpliceForm({
        cable_a_id: connectedCables[0]?.id || null, core_a: 1,
        cable_b_id: connectedCables[1]?.id || connectedCables[0]?.id || null, core_b: 1,
        splitter_a_id: null, splitter_b_id: null, port_a: 0, port_b: 0,
        tray_id: 1, status: "active", notes: "",
      });
    }
    setShowSpliceForm(true);
  };

  const saveSplice = async () => {
    try {
      const payload = {
        ...spliceForm,
        cable_a_id: spliceForm.cable_a_id || null,
        cable_b_id: spliceForm.cable_b_id || null,
        splitter_a_id: spliceForm.splitter_a_id || null,
        splitter_b_id: spliceForm.splitter_b_id || null,
      };
      if (editSplice) {
        await api.put(`/fiber/splices/${editSplice.id}`, payload);
      } else {
        await api.post("/fiber/splices", { ...payload, tj_id: tj.id });
      }
      setShowSpliceForm(false);
      onSpliceChange();
    } catch (e: any) {
      alert(e?.response?.data?.detail || String(e));
    }
  };

  const deleteSplice = async (id: number) => {
    if (!confirm("Delete this splice?")) return;
    try {
      await api.del(`/fiber/splices/${id}`);
      onSpliceChange();
    } catch (e) { alert(String(e)); }
  };

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{tj.unique_id} — {tj.name}</h2>
          <p className="text-sm text-slate-500">{tj.tj_port} ports · {tj.box_type} · {(tj.box_type === "enclosure" || tj.box_type === "dome") ? `${tj.capacity} capacity · ${tj.tray_count} trays` : ""} · {tj.address || "—"}</p>
          {tj.notes && <p className="text-xs text-slate-400 mt-1">{tj.notes}</p>}
        </div>
        <div className="flex items-center gap-1">
          {writeOk && <button className="btn-secondary text-[10px] py-1 px-2" onClick={() => { setTjEditForm({ name: tj.name || "", address: tj.address || "", notes: tj.notes || "" }); setShowTjEdit(true); }}>Edit</button>}
          {writeOk && onDelete && <button className="btn-danger text-[10px] py-1 px-2" onClick={onDelete}>Delete</button>}
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      {/* Internal diagram */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60 mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Splice Tray ({tjSplices.length} splices)</h3>
        {tjSplices.length > 0 ? (
          <div className="space-y-1">
            {(() => {
              const byTray: Record<number, typeof tjSplices> = {};
              for (const sp of tjSplices) {
                const tray = sp.tray_id || 1;
                if (!byTray[tray]) byTray[tray] = [];
                byTray[tray].push(sp);
              }
              return Object.entries(byTray).sort(([a], [b]) => Number(a) - Number(b)).map(([trayId, traySplices]) => (
                <div key={trayId} className="mb-2">
                  <div className="text-[9px] font-semibold text-slate-400 mb-1">Tray {trayId}</div>
                  {traySplices.map((sp) => {
                    const coreColorA = CORE_COLORS_ARR[((sp.core_a || 1) - 1) % CORE_COLORS_ARR.length];
                    const coreColorB = CORE_COLORS_ARR[((sp.core_b || 1) - 1) % CORE_COLORS_ARR.length];
                    const leftLabel = sp.cable_a_id ? `${sp.cable_a_code}:${sp.core_a}` : `${sp.splitter_a_name}:${sp.port_a === 0 ? "IN" : "OUT" + sp.port_a}`;
                    const rightLabel = sp.cable_b_id ? `${sp.cable_b_code}:${sp.core_b}` : `${sp.splitter_b_name}:${sp.port_b === 0 ? "IN" : "OUT" + sp.port_b}`;
                    const leftColor = sp.cable_a_id ? coreColorA : "#f59e0b";
                    const rightColor = sp.cable_b_id ? coreColorB : "#f59e0b";
                    return (
                      <div key={sp.id} className="flex items-center gap-1 group" title={`${leftLabel} ↔ ${rightLabel}`}>
                        <div className="flex items-center gap-1 min-w-[100px]">
                          {sp.cable_a_id ? <CoreColorDot coreIndex={sp.core_a} size={10} /> : <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />}
                          <span className="text-[9px] font-mono text-slate-600 truncate">{leftLabel}</span>
                        </div>
                        <div className="relative flex items-center">
                          <div className="w-6 h-2 rounded-full border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800" />
                          <div className="absolute left-0.5 right-0.5 h-0.5 rounded-full top-1/2 -translate-y-1/2" style={{ background: `linear-gradient(90deg, ${leftColor}, ${rightColor})` }} />
                        </div>
                        <div className="flex items-center gap-1 min-w-[100px] justify-end">
                          <span className="text-[9px] font-mono text-slate-600 truncate">{rightLabel}</span>
                          {sp.cable_b_id ? <CoreColorDot coreIndex={sp.core_b} size={10} /> : <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />}
                        </div>
                        <button className="opacity-0 group-hover:opacity-100 ml-1 text-red-400 hover:text-red-600 transition" onClick={() => deleteSplice(sp.id)}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        ) : (
          <div className="text-xs text-slate-400">No splices — all cores are free</div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 mb-3">
        <button className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${tjTab === "cable" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`} onClick={() => setTjTab("cable")}>Links ({connectedCables.length})</button>
        <button className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${tjTab === "splice" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`} onClick={() => setTjTab("splice")}>Splices ({tjSplices.length})</button>
        <button className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${tjTab === "photos" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`} onClick={() => setTjTab("photos")}>Photos</button>
      </div>

      {/* Cable tab */}
      {tjTab === "cable" && (
        <div className="mb-4">
          {connectedCables.length > 0 && (
            <div className="space-y-2 mb-4">
              {connectedCables.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="badge text-[10px]" style={{ background: CORE_COLORS_ARR[c.core_count] || "#6b7280", color: "white" }}>{c.core_count}C</span>
                    <span className="font-mono font-bold text-sm">{c.code}</span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs text-slate-500">{c.manufacturer || "Unknown"}</span>
                    {c.manufacturing_year ? <span className="text-xs text-slate-400">· {c.manufacturing_year}</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from({ length: c.core_count }, (_, i) => (
                      <div key={i} className="flex items-center gap-0.5 rounded border border-slate-200 dark:border-slate-700 px-1 py-0.5">
                        <CoreColorDot coreIndex={i + 1} size={8} />
                        <span className="text-[9px] font-mono text-slate-500">{i + 1}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hosted Splitters ({hostedSplitters.length})</h3>
              {writeOk && onAddSplitter && (
                <button className="btn-primary text-[10px] py-0.5 px-2" onClick={onAddSplitter}>+ Add Splitter</button>
              )}
            </div>
            {hostedSplitters.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {hostedSplitters.map((sp) => (
                  <div key={sp.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 group relative">
                    <div className="font-semibold text-sm">{sp.unique_id} — 1:{sp.split_ratio}</div>
                    <div className="text-xs text-slate-500">Input core: {sp.input_core}</div>
                    <div className="text-xs text-slate-500">Output: {sp.output_cores ? `${sp.output_cores.split(',').length} ports (${sp.output_cores})` : `${sp.split_ratio} ports`}</div>
                    {sp.name && <div className="text-xs text-slate-400 mt-1">{sp.name}</div>}
                    {writeOk && onEditSplitter && (
                      <div className="hidden group-hover:flex absolute top-2 right-2 gap-1">
                        <button className="text-[9px] text-blue-500 hover:underline" onClick={() => onEditSplitter(sp)}>Edit</button>
                        <button className="text-[9px] text-red-500 hover:underline" onClick={async () => {
                          if (!confirm(`Remove splitter ${sp.unique_id}? The allocated core(s) will be released.`)) return;
                          try { await api.del(`/fiber/splitters/${sp.id}`); onSpliceChange(); } catch (e) { alert(String(e)); }
                        }}>Remove</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400">No splitters hosted in this TJ.</div>
            )}
          </div>

          {connectedCables.length === 0 && hostedSplitters.length === 0 && (
          <div className="text-xs text-slate-400">No links connected</div>
          )}
        </div>
      )}

      {/* Splice tab */}
      {tjTab === "splice" && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Splices ({tjSplices.length})</h3>
            <button className="btn-primary text-[10px] py-0.5 px-2" onClick={() => openSpliceForm()}>+ Splice</button>
          </div>
          {tjSplices.length > 5 && (
            <input className="input text-[10px] py-1 mb-2 w-full" placeholder="Search splices by cable, core, status..." value={spliceSearch} onChange={(e) => { setSpliceSearch(e.target.value); setSplicePage(0); }} />
          )}
          {tjSplices.length > 0 ? (
            <>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {pagedSplices.map((sp) => {
                  const ca = connectedCables.find((c) => c.id === sp.cable_a_id);
                  const cb = connectedCables.find((c) => c.id === sp.cable_b_id);
                  const sa = hostedSplitters.find((s) => s.id === sp.splitter_a_id);
                  const sb = hostedSplitters.find((s) => s.id === sp.splitter_b_id);
                  const leftLabel = sp.cable_a_id ? sp.cable_a_code : `${sa?.name || sa?.unique_id || "?"}: ${sp.port_a === 0 ? "IN" : "OUT" + sp.port_a}`;
                  const rightLabel = sp.cable_b_id ? sp.cable_b_code : `${sb?.name || sb?.unique_id || "?"}: ${sp.port_b === 0 ? "IN" : "OUT" + sp.port_b}`;
                  const leftCore = sp.cable_a_id ? sp.core_a : sp.port_a;
                  const rightCore = sp.cable_b_id ? sp.core_b : sp.port_b;
                  return (
                    <div key={sp.id} className="rounded-md border border-slate-200 bg-white px-2 py-2 text-[11px] dark:border-slate-700 dark:bg-slate-900 group">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sp.status === "active" ? "bg-emerald-500" : sp.status === "spare" ? "bg-amber-500" : "bg-red-500"}`} />
                        <div className="flex items-center gap-1">
                          {sp.cable_a_id ? <CoreColorDot coreIndex={sp.core_a} size={8} /> : <span className="w-2 h-2 rounded-full bg-amber-400" />}
                          <span className="font-mono font-bold">{leftLabel}</span>
                          {ca?.manufacturer && <span className="text-[9px] text-slate-400">{ca.manufacturer}</span>}
                        </div>
                        <span className="text-slate-400">↔</span>
                        <div className="flex items-center gap-1">
                          {sp.cable_b_id ? <CoreColorDot coreIndex={sp.core_b} size={8} /> : <span className="w-2 h-2 rounded-full bg-amber-400" />}
                          <span className="font-mono font-bold">{rightLabel}</span>
                          {cb?.manufacturer && <span className="text-[9px] text-slate-400">{cb.manufacturer}</span>}
                        </div>
                        <span className={`ml-auto text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                          sp.status === "active" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : sp.status === "spare" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                          : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 line-through"
                        }`}>{sp.status}</span>
                        <div className="hidden group-hover:flex gap-1">
                          <button className="text-[9px] text-blue-500 hover:underline" onClick={() => openSpliceForm(sp)}>Edit</button>
                          <button className="text-[9px] text-red-500 hover:underline" onClick={() => deleteSplice(sp.id)}>Del</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {splicePages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-2">
                  <button className="btn-secondary text-[10px] py-0.5 px-2" disabled={splicePage === 0} onClick={() => setSplicePage(splicePage - 1)}>Prev</button>
                  <span className="text-[10px] text-slate-400">{splicePage + 1}/{splicePages}</span>
                  <button className="btn-secondary text-[10px] py-0.5 px-2" disabled={splicePage >= splicePages - 1} onClick={() => setSplicePage(splicePage + 1)}>Next</button>
                </div>
              )}
            </>
          ) : (
            <div className="text-xs text-slate-400">No splices yet. Click "+ Splice" to add one.</div>
          )}
        </div>
      )}

      {/* Photos tab */}
      {tjTab === "photos" && (
        <div className="mb-4">
          <PhotoGallery
            entityType="tj"
            entityId={tj.unique_id}
            photoTypes={TJ_PHOTO_TYPES}
            photoLabels={TJ_PHOTO_LABELS}
          />
        </div>
      )}

      {/* Splice form modal */}
      {showSpliceForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-lg p-5 max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-bold mb-3">{editSplice ? "Edit Splice" : "New Splice"}</h3>
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs font-semibold text-slate-500 mb-2">Endpoint A</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-[10px]">Type</label>
                    <select className="input text-xs" value={spliceForm.splitter_a_id ? "splitter" : "cable"} onChange={(e) => {
                      if (e.target.value === "splitter") {
                        setSpliceForm({ ...spliceForm, cable_a_id: null, splitter_a_id: hostedSplitters[0]?.id || null, port_a: 0 });
                      } else {
                        setSpliceForm({ ...spliceForm, splitter_a_id: null, cable_a_id: connectedCables[0]?.id || null, core_a: 1 });
                      }
                    }}>
                      <option value="cable">Cable</option>
                      <option value="splitter">Splitter</option>
                    </select>
                  </div>
                  {spliceForm.splitter_a_id ? (
                    <>
                      <div>
                        <label className="label text-[10px]">Splitter</label>
                        <select className="input text-xs" value={spliceForm.splitter_a_id || ""} onChange={(e) => setSpliceForm({ ...spliceForm, splitter_a_id: Number(e.target.value) })}>
                          {hostedSplitters.map((s) => <option key={s.id} value={s.id}>{s.name || s.unique_id} ({s.split_ratio}way)</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label text-[10px]">Port</label>
                        <select className="input text-xs" value={spliceForm.port_a} onChange={(e) => setSpliceForm({ ...spliceForm, port_a: Number(e.target.value) })}>
                          <option value={0}>Input</option>
                          {Array.from({ length: hostedSplitters.find((s) => s.id === spliceForm.splitter_a_id)?.split_ratio || 2 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>Output {i + 1}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="label text-[10px]">Link</label>
                        <input className="input text-[10px] py-1 mb-1" placeholder="Search..." value={cableSearchA} onChange={(e) => setCableSearchA(e.target.value)} />
                        <select className="input text-xs" size={Math.min(filteredCablesA.length, 4)} value={spliceForm.cable_a_id || ""} onChange={(e) => setSpliceForm({ ...spliceForm, cable_a_id: Number(e.target.value), core_a: 1 })}>
                          {filteredCablesA.map((c) => <option key={c.id} value={c.id}>{c.code} ({c.core_count}C)</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label text-[10px]">Core</label>
                        <CoreSelect
                          coreCount={connectedCables.find((c) => c.id === spliceForm.cable_a_id)?.core_count || 12}
                          value={spliceForm.core_a}
                          onChange={(v) => setSpliceForm({ ...spliceForm, core_a: v })}
                          occupiedCores={unusedCores.find((u) => u.cable_id === spliceForm.cable_a_id)?.occupied_cores}
                          spareCores={unusedCores.find((u) => u.cable_id === spliceForm.cable_a_id)?.spare_cores}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="text-center text-xs text-slate-400">↔ Splice ↔</div>

              <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                <div className="text-xs font-semibold text-slate-500 mb-2">Endpoint B</div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label text-[10px]">Type</label>
                    <select className="input text-xs" value={spliceForm.splitter_b_id ? "splitter" : "cable"} onChange={(e) => {
                      if (e.target.value === "splitter") {
                        setSpliceForm({ ...spliceForm, cable_b_id: null, splitter_b_id: hostedSplitters[0]?.id || null, port_b: 0 });
                      } else {
                        setSpliceForm({ ...spliceForm, splitter_b_id: null, cable_b_id: connectedCables[0]?.id || null, core_b: 1 });
                      }
                    }}>
                      <option value="cable">Cable</option>
                      <option value="splitter">Splitter</option>
                    </select>
                  </div>
                  {spliceForm.splitter_b_id ? (
                    <>
                      <div>
                        <label className="label text-[10px]">Splitter</label>
                        <select className="input text-xs" value={spliceForm.splitter_b_id || ""} onChange={(e) => setSpliceForm({ ...spliceForm, splitter_b_id: Number(e.target.value) })}>
                          {hostedSplitters.map((s) => <option key={s.id} value={s.id}>{s.name || s.unique_id} ({s.split_ratio}way)</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label text-[10px]">Port</label>
                        <select className="input text-xs" value={spliceForm.port_b} onChange={(e) => setSpliceForm({ ...spliceForm, port_b: Number(e.target.value) })}>
                          <option value={0}>Input</option>
                          {Array.from({ length: hostedSplitters.find((s) => s.id === spliceForm.splitter_b_id)?.split_ratio || 2 }, (_, i) => (
                            <option key={i + 1} value={i + 1}>Output {i + 1}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="label text-[10px]">Link</label>
                        <input className="input text-[10px] py-1 mb-1" placeholder="Search..." value={cableSearchB} onChange={(e) => setCableSearchB(e.target.value)} />
                        <select className="input text-xs" size={Math.min(filteredCablesB.length, 4)} value={spliceForm.cable_b_id || ""} onChange={(e) => setSpliceForm({ ...spliceForm, cable_b_id: Number(e.target.value), core_b: 1 })}>
                          {filteredCablesB.map((c) => <option key={c.id} value={c.id}>{c.code} ({c.core_count}C)</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label text-[10px]">Core</label>
                        <CoreSelect
                          coreCount={connectedCables.find((c) => c.id === spliceForm.cable_b_id)?.core_count || 12}
                          value={spliceForm.core_b}
                          onChange={(v) => setSpliceForm({ ...spliceForm, core_b: v })}
                          occupiedCores={unusedCores.find((u) => u.cable_id === spliceForm.cable_b_id)?.occupied_cores}
                          spareCores={unusedCores.find((u) => u.cable_id === spliceForm.cable_b_id)?.spare_cores}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label text-[10px]">Tray ID</label>
                  <input type="number" className="input text-xs" min={1} value={spliceForm.tray_id} onChange={(e) => setSpliceForm({ ...spliceForm, tray_id: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="label text-[10px]">Status</label>
                  <select className="input text-xs" value={spliceForm.status} onChange={(e) => setSpliceForm({ ...spliceForm, status: e.target.value })}>
                    <option value="active">Active</option>
                    <option value="spare">Spare</option>
                    <option value="broken">Broken</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="label text-[10px]">Notes</label>
                <input className="input text-xs" value={spliceForm.notes} onChange={(e) => setSpliceForm({ ...spliceForm, notes: e.target.value })} />
              </div>
              {unusedCores.length > 0 && (
                <div className="rounded-md bg-slate-50 dark:bg-slate-800 p-2 text-[10px] max-h-[100px] overflow-y-auto">
                  <div className="font-semibold mb-1">Core Availability:</div>
                  {unusedCores.map((uc) => (
                    <div key={uc.cable_id} className="text-slate-500">
                      {uc.cable_code}: <span className="text-emerald-600">{uc.spare_cores.length} spare</span>{uc.occupied_cores?.length ? <span className="text-red-500 ml-1">{uc.occupied_cores.length} occupied</span> : ""}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setShowSpliceForm(false)}>Cancel</button>
                <button className="btn-primary" onClick={saveSplice}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TJ Edit modal */}
      {showTjEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-sm p-5">
            <h3 className="text-sm font-bold mb-3">Edit {tj.unique_id}</h3>
            <div className="space-y-3">
              <div><label className="label">Name</label><input className="input" value={tjEditForm.name} onChange={(e) => setTjEditForm({ ...tjEditForm, name: e.target.value })} /></div>
              <div><label className="label">Address</label><input className="input" value={tjEditForm.address} onChange={(e) => setTjEditForm({ ...tjEditForm, address: e.target.value })} /></div>
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={tjEditForm.notes} onChange={(e) => setTjEditForm({ ...tjEditForm, notes: e.target.value })} /></div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setShowTjEdit(false)}>Cancel</button>
                <button className="btn-primary" onClick={async () => {
                  try {
                    await api.put(`/fiber/tj-boxes/${tj.id}`, tjEditForm);
                    setShowTjEdit(false);
                    onSpliceChange();
                  } catch (e) { alert(String(e)); }
                }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 text-xs text-slate-400">
        GPS: {tj.lat.toFixed(6)}, {tj.lng.toFixed(6)}
      </div>
    </div>
  );
}
