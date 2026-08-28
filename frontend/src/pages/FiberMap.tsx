import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import ActionResultBanner from "../components/ActionResultBanner";
import { api, downloadFile } from "../api/client";
import { Cable, TjBox, Splitter, FiberLoop, CableCut } from "../api/types";

interface TempSegment {
  start_lat: number; start_lng: number; end_lat: number; end_lng: number; order_index: number;
}
import { canWrite } from "../api/types";
import { useUserRole } from "../lib/role";

const CORE_COLORS: Record<number, string> = {
  1: "#3b82f6", 2: "#f97316", 4: "#22c55e", 6: "#92400e",
  8: "#ef4444", 12: "#8b5cf6",
};

const TJ_CAPACITY_COLORS: Record<number, string> = {
  4: "#6366f1", 8: "#0ea5e9", 12: "#22c55e", 16: "#f59e0b", 24: "#ef4444", 32: "#8b5cf6", 48: "#ec4899", 96: "#14b8a6",
};

const SPLITTER_RATIO_COLORS: Record<number, string> = {
  2: "#22c55e", 4: "#3b82f6", 8: "#f59e0b", 16: "#ef4444", 32: "#8b5cf6", 64: "#ec4899",
};

const TJ_ICONS: Record<string, string> = {
  home_tj: "#22c55e", regular_tj: "#6366f1", enclosure: "#f59e0b", dome: "#ef4444",
};

function tjIcon(color: string) {
  return L.divIcon({
    className: "",
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="' + color + '" stroke="white" stroke-width="2"/><text x="12" y="16" textAnchor="middle" fontSize="10" fill="white" fontWeight="bold">TJ</text></svg>',
    iconSize: [24, 24], iconAnchor: [12, 12],
  });
}

function splitterIcon(color: string) {
  return L.divIcon({
    className: "",
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><polygon points="10,2 18,18 2,18" fill="' + color + '" stroke="white" stroke-width="2"/></svg>',
    iconSize: [20, 20], iconAnchor: [10, 10],
  });
}

function loopIcon() {
  return L.divIcon({
    className: "",
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="#06b6d4" stroke="white" stroke-width="2"/><text x="12" y="16" textAnchor="middle" fontSize="9" fill="white" fontWeight="bold">LP</text></svg>',
    iconSize: [24, 24], iconAnchor: [12, 12],
  });
}

function cutIcon() {
  return L.divIcon({
    className: "",
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><line x1="5" y1="17" x2="17" y2="5" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round"/><circle cx="5" cy="17" r="3" fill="#ef4444" stroke="white" stroke-width="1.5"/><circle cx="17" cy="5" r="3" fill="#ef4444" stroke="white" stroke-width="1.5"/></svg>',
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

function repairedIcon() {
  return L.divIcon({
    className: "",
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><line x1="5" y1="17" x2="17" y2="5" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"/><circle cx="5" cy="17" r="3" fill="#22c55e" stroke="white" stroke-width="1.5"/><circle cx="17" cy="5" r="3" fill="#22c55e" stroke="white" stroke-width="1.5"/></svg>',
    iconSize: [22, 22], iconAnchor: [11, 11],
  });
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function cableLengthM(cable: Cable): number {
  if (!cable.segments?.length) return 0;
  let total = 0;
  for (const s of cable.segments) total += haversine(s.start_lat, s.start_lng, s.end_lat, s.end_lng);
  return total;
}

const SPLITTER_LOSS_DB: Record<number, number> = { 2: 3.5, 4: 7.0, 8: 10.5, 16: 14.0, 32: 17.5, 64: 20.5 };
function splitterLoss(ratio: number): number { return SPLITTER_LOSS_DB[ratio] ?? 10 * Math.log10(ratio) + 0.5; }

const CITY_LAT = 22.699957217056024;
const CITY_LNG = 90.35805423412117;
const CITY_CENTER = { lat: CITY_LAT, lng: CITY_LNG };

export default function FiberMap() {
  const { role } = useUserRole();
  const writeOk = canWrite(role);

  const [cables, setCables] = useState<Cable[]>([]);
  const [tjBoxes, setTjBoxes] = useState<TjBox[]>([]);
  const [splitters, setSplitters] = useState<Splitter[]>([]);
  const [loops, setLoops] = useState<FiberLoop[]>([]);
  const [cuts, setCuts] = useState<CableCut[]>([]);
  const [splices, setSplices] = useState<any[]>([]);
  const [nocPopData, setNocPopData] = useState<{ nocs: any[]; pops: any[] }>({ nocs: [], pops: [] });
  const [error, setError] = useState("");

  const [filterType, setFilterType] = useState<string>("all");
  const [filterText, setFilterText] = useState("");
  const [filterCore, setFilterCore] = useState<string>("all");
  const [filterPort, setFilterPort] = useState<string>("all");
  const [filterRatio, setFilterRatio] = useState<string>("all");
  const [showForm, setShowForm] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [cableForm, setCableForm] = useState<Partial<Cable>>({});
  const [tjForm, setTjForm] = useState<Partial<TjBox>>({});
  const [splitterForm, setSplitterForm] = useState<Partial<Splitter>>({});

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editKind, setEditKind] = useState<string>("");

  const [routeMode, setRouteMode] = useState(false);
  const [routeType, setRouteType] = useState<"driving" | "walking">("driving");
  const [routeModeType, setRouteModeType] = useState<"straight" | "road">("road");
  const [routing, setRouting] = useState(false);

  const [importing, setImporting] = useState(false);
  const [selectedTj, setSelectedTj] = useState<TjBox | null>(null);
  const [selectedCable, setSelectedCable] = useState<Cable | null>(null);
  const [editingCableId, setEditingCableId] = useState<number | null>(null);
  const [routeSrcTj, setRouteSrcTj] = useState<TjBox | null>(null);
  const [routeDstTj, setRouteDstTj] = useState<TjBox | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [loopForm, setLoopForm] = useState<Partial<FiberLoop>>({});
  const [cutForm, setCutForm] = useState<Partial<CableCut>>({});
  const [dragMode, setDragMode] = useState(false);
  const [expandCables, setExpandCables] = useState(false);
  const [expandTj, setExpandTj] = useState(false);
  const [expandSp, setExpandSp] = useState(false);
  const [expandCuts, setExpandCuts] = useState(false);
  const [searchCables, setSearchCables] = useState("");
  const [searchTj, setSearchTj] = useState("");
  const [searchSp, setSearchSp] = useState("");
  const [searchCuts, setSearchCuts] = useState("");

  const [feasCheckOpen, setFeasCheckOpen] = useState(false);
  const [feasLat, setFeasLat] = useState("");
  const [feasLng, setFeasLng] = useState("");
  const [feasResults, setFeasResults] = useState<{ tj: TjBox; distance: number; destinations: string[] }[]>([]);
  const [feasChecked, setFeasChecked] = useState(false);

  const mapRef = useRef<L.Map | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, t, s, l, ct, sp, np] = await Promise.all([
        api.get<Cable[]>("/fiber/cables"),
        api.get<TjBox[]>("/fiber/tj-boxes"),
        api.get<Splitter[]>("/fiber/splitters"),
        api.get<FiberLoop[]>("/fiber/loops"),
        api.get<CableCut[]>("/fiber/cuts"),
        api.get<any[]>("/fiber/splices"),
        api.get<{ nocs: any[]; pops: any[] }>("/fiber/noc-pop-map"),
      ]);
      setCables(c);
      setTjBoxes(t);
      setSplitters(s);
      setLoops(l);
      setCuts(ct);
      setSplices(sp);
      setNocPopData(np);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredCables = useMemo(() => {
    if (filterType !== "all" && filterType !== "cable") return [];
    return cables.filter((c) => {
      if (filterText && !c.code.toLowerCase().includes(filterText.toLowerCase()) && !c.manufacturer.toLowerCase().includes(filterText.toLowerCase())) return false;
      if (filterCore !== "all" && c.core_count !== Number(filterCore)) return false;
      return true;
    });
  }, [cables, filterType, filterText, filterCore]);

  const filteredTj = useMemo(() => {
    if (filterType !== "all" && filterType !== "tj") return [];
    return tjBoxes.filter((t) => {
      if (filterText && !t.name.toLowerCase().includes(filterText.toLowerCase()) && !t.address.toLowerCase().includes(filterText.toLowerCase())) return false;
      if (filterPort !== "all" && t.tj_port !== Number(filterPort)) return false;
      return true;
    });
  }, [tjBoxes, filterType, filterText, filterPort]);

  const filteredSplitters = useMemo(() => {
    if (filterType !== "all" && filterType !== "splitter") return [];
    return splitters.filter((s) => {
      if (filterText && !s.name.toLowerCase().includes(filterText.toLowerCase())) return false;
      if (filterRatio !== "all" && s.split_ratio !== Number(filterRatio)) return false;
      return true;
    });
  }, [splitters, filterType, filterText, filterRatio]);

  const saveCable = async () => {
    if (!cableForm.code?.trim()) { setError("Cable Code is required"); return; }
    if (!cableForm.manufacturer?.trim()) { setError("Manufacturer is required"); return; }
    if (!cableForm.manufacturing_year) { setError("Year is required"); return; }
    try {
      if (editingId && editKind === "cable") {
        await api.put(`/fiber/cables/${editingId}`, cableForm);
      } else {
        await api.post("/fiber/cables", cableForm);
      }
      setShowForm(null); setEditingId(null); setCableForm({});
      await load();
    } catch (e) { setError(String(e)); }
  };

  const saveTj = async () => {
    try {
      if (editingId && editKind === "tj") {
        await api.put(`/fiber/tj-boxes/${editingId}`, tjForm);
      } else {
        await api.post("/fiber/tj-boxes", tjForm);
      }
      setShowForm(null); setEditingId(null); setTjForm({});
      await load();
    } catch (e) { setError(String(e)); }
  };

  const saveSplitter = async () => {
    if (!splitterForm.tj_box_id) { setError("No parent TJ associated. Open this form from a TJ."); return; }
    try {
      if (editingId && editKind === "splitter") {
        await api.put(`/fiber/splitters/${editingId}`, splitterForm);
      } else {
        await api.post("/fiber/splitters", splitterForm);
      }
      setShowForm(null); setEditingId(null); setSplitterForm({});
      await load();
    } catch (e) { setError(String(e)); }
  };

  const deleteItem = async (kind: string, id: number) => {
    let msg = "Delete?";
    if (kind === "tj") {
      const tj = tjBoxes.find((t) => t.id === id);
      const hosted = splitters.filter((s) => s.tj_box_id === id);
      msg = `Delete ${tj?.unique_id} ${tj?.name || ""}?` + (hosted.length ? `\nAlso deletes ${hosted.length} splitter(s): ${hosted.map((s) => s.unique_id).join(", ")}` : "");
    } else if (kind === "splitter") {
      const sp = splitters.find((s) => s.id === id);
      msg = `Delete ${sp?.unique_id}?`;
    }
    if (!confirm(msg)) return;
    try {
      const path = kind === "cable" ? "cables" : kind === "tj" ? "tj-boxes" : "splitters";
      await api.del(`/fiber/${path}/${id}`);
      await load();
    } catch (e) { setError(String(e)); }
  };

  const startEdit = (kind: string, item: Cable | TjBox | Splitter) => {
    setEditingId(item.id); setEditKind(kind); setShowForm(kind);
    if (kind === "cable") setCableForm(item as Cable);
    else if (kind === "tj") setTjForm(item as TjBox);
    else setSplitterForm(item as Splitter);
  };

  const handleCableSegmentUpdate = async (cableId: number, segments: { id?: number; start_lat: number; start_lng: number; end_lat: number; end_lng: number; order_index: number }[]) => {
    try {
      await api.put(`/fiber/cables/${cableId}`, { segments });
      await load();
    } catch (e) { setError(String(e)); }
  };

  const handleTjMove = async (tjId: number, lat: number, lng: number) => {
    try {
      // Find the old TJ position for cable segment updates
      const oldTj = tjBoxes.find((t) => t.id === tjId);
      if (oldTj) {
        // Move attached cable segments
        for (const cable of cables) {
          if (!cable.segments?.length) continue;
          let changed = false;
          const newSegs = cable.segments.map((seg) => {
            const s = { ...seg };
            if (Math.abs(s.start_lat - oldTj.lat) < 0.001 && Math.abs(s.start_lng - oldTj.lng) < 0.001) {
              s.start_lat = lat; s.start_lng = lng; changed = true;
            }
            if (Math.abs(s.end_lat - oldTj.lat) < 0.001 && Math.abs(s.end_lng - oldTj.lng) < 0.001) {
              s.end_lat = lat; s.end_lng = lng; changed = true;
            }
            return s;
          });
          if (changed) await api.put(`/fiber/cables/${cable.id}`, { segments: newSegs });
        }
        // Move hosted splitters
        for (const sp of splitters.filter((s) => s.tj_box_id === tjId)) {
          await api.put(`/fiber/splitters/${sp.id}`, { lat, lng });
        }
      }
      await api.put(`/fiber/tj-boxes/${tjId}`, { lat, lng });
      await load();
    } catch (e) { setError(String(e)); }
  };

  const handleSplitterMove = async (spId: number, lat: number, lng: number) => {
    try {
      await api.put(`/fiber/splitters/${spId}`, { lat, lng });
      await load();
    } catch (e) { setError(String(e)); }
  };

  const saveLoop = async () => {
    try {
      if (loopForm.id) { await api.put(`/fiber/loops/${loopForm.id}`, loopForm); }
      else { await api.post("/fiber/loops", loopForm); }
      setShowForm(null); setLoopForm({});
      await load();
    } catch (e) { setError(String(e)); }
  };

  const deleteLoop = async (id: number) => { if (!confirm("Delete loop?")) return; try { await api.del(`/fiber/loops/${id}`); await load(); } catch (e) { setError(String(e)); } };

  const saveCut = async () => {
    try {
      if (cutForm.id) { await api.put(`/fiber/cuts/${cutForm.id}`, cutForm); }
      else { await api.post("/fiber/cuts", cutForm); }
      setShowForm(null); setCutForm({});
      await load();
    } catch (e) { setError(String(e)); }
  };

  const markRepaired = async (cutId: number) => {
    try {
      await api.put(`/fiber/cuts/${cutId}`, { status: "repaired", repair_date: new Date().toISOString() });
      await load();
    } catch (e) { setError(String(e)); }
  };

  const deleteCut = async (id: number) => { if (!confirm("Delete cut record?")) return; try { await api.del(`/fiber/cuts/${id}`); await load(); } catch (e) { setError(String(e)); } };

  const handleExport = async () => {
    try { await downloadFile("/fiber/export", "fiber_network.xlsx"); }
    catch (e) { setError(String(e)); }
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const token = localStorage.getItem("token");
      const res = await fetch("/api/fiber/import", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error("Import failed");
      await load();
    } catch (e) { setError(String(e)); }
    finally { setImporting(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const handleRightClickAdd = (kind: string, lat: number, lng: number) => {
    if (kind === "tj") { setTjForm({ name: "", box_type: "regular_tj", tj_port: 4, capacity: 4, tray_count: 1, lat, lng }); setShowForm("tj"); }
    else if (kind === "splitter") { setSplitterForm({ name: "", split_ratio: 2, lat, lng }); setShowForm("splitter"); }
    else if (kind === "cable") { setCableForm({ code: "", cable_type: "round", core_count: 12, segments: [] }); setShowForm("cable"); }
    else if (kind === "loop") { setLoopForm({ lat, lng, loop_length_m: 30 }); setShowForm("loop"); }
    else if (kind === "cut") { setCutForm({ lat, lng }); setShowForm("cut"); }
  };

  const handleRouteFetch = async () => {
    if (!routeSrcTj || !routeDstTj) return;
    setRouting(true);
    const start: [number, number] = [routeSrcTj.lat, routeSrcTj.lng];
    const end: [number, number] = [routeDstTj.lat, routeDstTj.lng];
    try {
      let segments: TempSegment[] = [];
      if (routeModeType === "straight") {
        segments = [{ start_lat: start[0], start_lng: start[1], end_lat: end[0], end_lng: end[1], order_index: 0 }];
      } else {
        const profile = routeType;
        const url = `https://router.project-osrm.org/route/v1/${profile}/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.code !== "Ok" || !data.routes?.length) { setError("No route found"); setRouting(false); return; }
        const coords: [number, number][] = data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]]);
        for (let i = 0; i < coords.length - 1; i++) {
          segments.push({ start_lat: coords[i][0], start_lng: coords[i][1], end_lat: coords[i + 1][0], end_lng: coords[i + 1][1], order_index: i });
        }
        const step = Math.max(1, Math.floor(segments.length / 50));
        segments = segments.filter((_, i) => i % step === 0 || i === segments.length - 1);
      }
      setCableForm({ ...cableForm, code: routeSrcTj.unique_id + ">" + routeDstTj.unique_id, cable_type: "round", core_count: 12, segments: segments as any[] });
      setShowForm("cable");
      setRouteMode(false); setRouteSrcTj(null); setRouteDstTj(null);
    } catch (e) { setError("Routing failed: " + String(e)); }
    finally { setRouting(false); }
  };

  const handleDrawCreated = (e: { layer: L.Polyline }) => {
    const layer = e.layer;
    const latlngs = layer.getLatLngs() as L.LatLng[];
    const segments: TempSegment[] = latlngs.map((ll, i) => {
      const next = latlngs[i + 1];
      return next ? { start_lat: ll.lat, start_lng: ll.lng, end_lat: next.lat, end_lng: next.lng, order_index: i } : null;
    }).filter(Boolean) as TempSegment[];
    if (segments.length) {
      setCableForm({ ...cableForm, cable_type: "round", core_count: 12, segments: segments as any[] });
      setShowForm("cable");
    }
    mapRef.current?.removeLayer(layer);
  };

  const runFeasibilityCheck = () => {
    const lat = parseFloat(feasLat);
    const lng = parseFloat(feasLng);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError("Invalid coordinates. Lat must be -90..90, Lng must be -180..180.");
      return;
    }
    const results = tjBoxes.map((tj) => {
      const distance = haversine(lat, lng, tj.lat, tj.lng);
      const connectedCables = cables.filter((c) =>
        c.segments?.some((s) =>
          (Math.abs(s.start_lat - tj.lat) < 0.001 && Math.abs(s.start_lng - tj.lng) < 0.001) ||
          (Math.abs(s.end_lat - tj.lat) < 0.001 && Math.abs(s.end_lng - tj.lng) < 0.001)
        )
      );
      const destinations = [...new Set(connectedCables.map((c) => {
        if (c.src_tj_name && c.dst_tj_name) {
          return c.src_tj_id === tj.id ? c.dst_tj_name : c.src_tj_name;
        }
        return c.code;
      }))];
      return { tj, distance, destinations };
    });
    results.sort((a, b) => a.distance - b.distance);
    setFeasResults(results.slice(0, 3));
    setFeasChecked(true);
  };

  return (
    <div className={isFullscreen ? "fixed inset-0 z-[9998] bg-white dark:bg-slate-900 flex flex-col" : "flex flex-col relative"} style={{ zIndex: 1, height: isFullscreen ? "100vh" : "calc(100vh - 4rem)" }}>
      {/* Top bar: all controls in one row */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shrink-0">
        {!isFullscreen && <h1 className="text-lg font-bold text-slate-900 dark:text-white whitespace-nowrap mr-1">Fiber Map</h1>}
        <select className="input w-28 text-xs py-1" value={filterType} onChange={(e) => { setFilterType(e.target.value); setFilterCore("all"); setFilterPort("all"); setFilterRatio("all"); }}>
          <option value="all">All</option><option value="cable">Cables</option><option value="tj">TJ Boxes</option><option value="splitter">Splitters</option>
        </select>
        {(filterType === "all" || filterType === "cable") && (
          <select className="input w-24 text-xs py-1" value={filterCore} onChange={(e) => setFilterCore(e.target.value)}>
            <option value="all">All cores</option>
            {Object.keys(CORE_COLORS).map((k) => <option key={k} value={k}>{k} core</option>)}
          </select>
        )}
        {(filterType === "all" || filterType === "tj") && (
          <select className="input w-24 text-xs py-1" value={filterPort} onChange={(e) => setFilterPort(e.target.value)}>
            <option value="all">All ports</option>
            {Object.keys(TJ_CAPACITY_COLORS).map((k) => <option key={k} value={k}>{k} port</option>)}
          </select>
        )}
        {(filterType === "all" || filterType === "splitter") && (
          <select className="input w-24 text-xs py-1" value={filterRatio} onChange={(e) => setFilterRatio(e.target.value)}>
            <option value="all">All ratios</option>
            {Object.keys(SPLITTER_RATIO_COLORS).map((k) => <option key={k} value={k}>1:{k}</option>)}
          </select>
        )}
        <input className="input flex-1 min-w-[120px] text-xs py-1" placeholder="Search..." value={filterText} onChange={(e) => setFilterText(e.target.value)} />
        <span className="text-[10px] text-slate-400 whitespace-nowrap">{filteredCables.length}c {filteredTj.length}tj {filteredSplitters.length}sp</span>
        <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files?.[0]) handleImport(e.target.files[0]); }} />
        <button className="btn-secondary text-xs py-1 px-2" onClick={handleExport}>Export</button>
        <button className="btn-secondary text-xs py-1 px-2" onClick={() => fileRef.current?.click()} disabled={importing}>{importing ? "..." : "Import"}</button>
        {writeOk && (
          <>
            <button className="btn-secondary text-xs py-1 px-2" onClick={() => { setShowForm("cable"); setEditingId(null); setCableForm({ cable_type: "round", core_count: 12, route_type: "driving", src_tj_id: null, dst_tj_id: null }); }}>+ Cable</button>
            <button className="btn-secondary text-xs py-1 px-2" onClick={() => { setShowForm("tj"); setEditingId(null); setTjForm({ box_type: "regular_tj", tj_port: 4, capacity: 4, tray_count: 1 }); }}>+ TJ</button>
            <button className="btn-secondary text-xs py-1 px-2" onClick={() => { setFeasCheckOpen(true); setFeasChecked(false); setFeasResults([]); setFeasLat(""); setFeasLng(""); }}>
              Feasibility Check
            </button>
          </>
        )}
      </div>

      {error && <ActionResultBanner ok={false} message={error} onDismiss={() => setError("")} className="shrink-0" />}

      {/* Map + Sidebar layout */}
      <div className="flex-1 flex min-h-0" style={{ zIndex: 2 }}>
        {/* Map fills remaining space */}
        <div className="flex-1 relative min-h-0">
          <FiberMapView
            cables={filteredCables}
            tjBoxes={filteredTj}
            splitters={filteredSplitters}
            loops={loops}
            cuts={cuts}
            nocPopData={nocPopData}
            center={CITY_CENTER}
            mapRef={mapRef}
            routeMode={routeMode}
            routeSrcTj={routeSrcTj}
            routeDstTj={routeDstTj}
            isFullscreen={isFullscreen}
            dragMode={dragMode}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            onTjClick={(tj) => {
              if (routeMode) {
                if (!routeSrcTj) setRouteSrcTj(tj);
                else if (!routeDstTj) setRouteDstTj(tj);
              } else {
                setSelectedTj(tj);
              }
            }}
            onDrawCreated={handleDrawCreated}
            onRightClickAdd={handleRightClickAdd}
            onCableSegmentUpdate={handleCableSegmentUpdate}
            onTjMove={handleTjMove}
            onSplitterMove={handleSplitterMove}
            onCableClick={(cable) => setSelectedCable(cable)}
            onLoopClick={(loop) => { setLoopForm(loop); setShowForm("loop"); }}
            onCutClick={(cut) => { setCutForm(cut); setShowForm("cut"); }}
            editingCableId={editingCableId}
            onEditingCableDone={() => setEditingCableId(null)}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-[320px] shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-y-auto flex flex-col">
          {/* Drag mode toggle */}
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
            <button onClick={() => setDragMode(!dragMode)} className={`text-xs font-medium px-3 py-1.5 rounded-md transition ${dragMode ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"}`}>
              {dragMode ? "Dragging ON" : "Drag Mode"}
            </button>
            <span className="text-[10px] text-slate-400">{dragMode ? "Move items by dragging" : "Read-only"}</span>
          </div>

          {/* Cables section */}
          <div className="border-b border-slate-200 dark:border-slate-700">
            <button onClick={() => setExpandCables(!expandCables)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Cables ({filteredCables.length})</span>
              <svg className={`w-4 h-4 text-slate-400 transition-transform ${expandCables ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {expandCables && (
              <div className="px-3 pb-2">
                <input className="input text-xs w-full mb-2 py-1" placeholder="Search cables..." value={searchCables} onChange={(e) => setSearchCables(e.target.value)} />
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {filteredCables.filter((c) => !searchCables || c.code.toLowerCase().includes(searchCables.toLowerCase()) || c.link_name.toLowerCase().includes(searchCables.toLowerCase())).map((c) => {
                    const lenM = cableLengthM(c);
                    return (
                      <div key={c.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => setSelectedCable(c)}>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-semibold">{c.code}</span>
                          <span className="badge text-[10px]" style={{ background: CORE_COLORS[c.core_count] || "#6b7280", color: "white" }}>{c.core_count}C</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{c.link_name || "—"} · {(lenM / 1000).toFixed(2)} km</div>
                        {writeOk && <div className="flex gap-1 mt-1"><button className="btn-ghost text-[10px] py-0" onClick={(e) => { e.stopPropagation(); startEdit("cable", c); }}>Edit</button><button className="btn-ghost text-[10px] py-0 text-red-600" onClick={(e) => { e.stopPropagation(); deleteItem("cable", c.id); }}>Del</button></div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* TJ Boxes section */}
          <div className="border-b border-slate-200 dark:border-slate-700">
            <button onClick={() => setExpandTj(!expandTj)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">TJ Boxes ({filteredTj.length})</span>
              <svg className={`w-4 h-4 text-slate-400 transition-transform ${expandTj ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {expandTj && (
              <div className="px-3 pb-2">
                <input className="input text-xs w-full mb-2 py-1" placeholder="Search TJs..." value={searchTj} onChange={(e) => setSearchTj(e.target.value)} />
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {filteredTj.filter((t) => !searchTj || t.name.toLowerCase().includes(searchTj.toLowerCase()) || t.unique_id.toLowerCase().includes(searchTj.toLowerCase())).map((t) => (
                    <div key={t.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => setSelectedTj(t)}>
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs">{t.unique_id}</span>
                        <span className="badge text-[10px]" style={{ background: TJ_ICONS[t.box_type] || "#6b7280", color: "white" }}>{t.box_type}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{t.name} · {t.tj_port}p · {t.capacity}cap</div>
                      {writeOk && <div className="flex gap-1 mt-1"><button className="btn-ghost text-[10px] py-0" onClick={(e) => { e.stopPropagation(); startEdit("tj", t); }}>Edit</button><button className="btn-ghost text-[10px] py-0 text-red-600" onClick={(e) => { e.stopPropagation(); deleteItem("tj", t.id); }}>Del</button></div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Splitters section */}
          <div className="border-b border-slate-200 dark:border-slate-700">
            <button onClick={() => setExpandSp(!expandSp)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-left">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Splitters ({filteredSplitters.length})</span>
              <svg className={`w-4 h-4 text-slate-400 transition-transform ${expandSp ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {expandSp && (
              <div className="px-3 pb-2">
                <input className="input text-xs w-full mb-2 py-1" placeholder="Search splitters..." value={searchSp} onChange={(e) => setSearchSp(e.target.value)} />
                <div className="space-y-1 max-h-[300px] overflow-y-auto">
                  {filteredSplitters.filter((s) => !searchSp || (s.name || "").toLowerCase().includes(searchSp.toLowerCase()) || s.unique_id.toLowerCase().includes(searchSp.toLowerCase())).map((s) => {
                    const loss = splitterLoss(s.split_ratio);
                    return (
                      <div key={s.id} className="rounded-md border border-slate-200 dark:border-slate-700 p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer" onClick={() => startEdit("splitter", s)}>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-xs font-semibold">{s.unique_id}</span>
                          <span className="badge text-[10px]" style={{ background: SPLITTER_RATIO_COLORS[s.split_ratio] || "#f59e0b", color: "white" }}>1:{s.split_ratio}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{s.name || "—"} · {loss.toFixed(1)} dB · {s.tj_box_name || "no TJ"}</div>
                        {writeOk && <div className="flex gap-1 mt-1"><button className="btn-ghost text-[10px] py-0" onClick={(e) => { e.stopPropagation(); startEdit("splitter", s); }}>Edit</button><button className="btn-ghost text-[10px] py-0 text-red-600" onClick={(e) => { e.stopPropagation(); deleteItem("splitter", s.id); }}>Del</button></div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Active Cuts section */}
          {cuts.filter((c) => c.status === "cut").length > 0 && (
            <div className="border-b border-slate-200 dark:border-slate-700">
              <button onClick={() => setExpandCuts(!expandCuts)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-red-50 dark:hover:bg-red-900/10 text-left">
                <span className="text-xs font-semibold text-red-600 dark:text-red-400">Active Cuts ({cuts.filter((c) => c.status === "cut").length})</span>
                <svg className={`w-4 h-4 text-red-400 transition-transform ${expandCuts ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </button>
              {expandCuts && (
                <div className="px-3 pb-2">
                  <input className="input text-xs w-full mb-2 py-1" placeholder="Search cuts..." value={searchCuts} onChange={(e) => setSearchCuts(e.target.value)} />
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {cuts.filter((c) => c.status === "cut").filter((c) => {
                      if (!searchCuts) return true;
                      const cable = cables.find((ca) => ca.id === c.cable_id);
                      return (cable?.code || "").toLowerCase().includes(searchCuts.toLowerCase()) || (c.notes || "").toLowerCase().includes(searchCuts.toLowerCase());
                    }).map((c) => {
                      const cable = cables.find((ca) => ca.id === c.cable_id);
                      return (
                        <div key={c.id} className="rounded-md border border-red-200 dark:border-red-800 p-2 hover:bg-red-50 dark:hover:bg-red-900/10 cursor-pointer" onClick={() => { setCutForm(c); setShowForm("cut"); }}>
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-semibold text-red-600">{cable?.code || "?"}</span>
                            <span className="text-[10px] text-red-400">CUT</span>
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{c.splice_tj_name ? "Splice: " + c.splice_tj_name : "No splice TJ"} · {c.notes || "—"}</div>
                          {writeOk && <div className="flex gap-1 mt-1"><button className="btn-ghost text-[10px] py-0 text-green-600" onClick={(e) => { e.stopPropagation(); markRepaired(c.id); }}>Repair</button></div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {selectedTj && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSelectedTj(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <TjDetailPanel tj={selectedTj} cables={cables} splitters={splitters} splices={splices} onClose={() => setSelectedTj(null)} onSpliceChange={load} writeOk={writeOk}
              onAddSplitter={() => { setSplitterForm({ split_ratio: 2, tj_box_id: selectedTj.id, lat: selectedTj.lat, lng: selectedTj.lng }); setEditingId(null); setShowForm("splitter"); }}
              onEditSplitter={(sp) => { setEditingId(sp.id); setEditKind("splitter"); setSplitterForm(sp as any); setShowForm("splitter"); }}
            />
          </div>
        </div>
      )}

      {selectedCable && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSelectedCable(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{selectedCable.code}</h2>
                <p className="text-sm text-slate-500">{selectedCable.link_id} · {selectedCable.core_count} cores · {selectedCable.cable_type}</p>
              </div>
              <button onClick={() => setSelectedCable(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            <div className="space-y-3 text-sm">
              {(() => {
                const lenM = cableLengthM(selectedCable);
                const loopSum = loops.filter((l) => l.cable_id === selectedCable.id);
                const totalLoopM = loopSum.reduce((a, l) => a + l.loop_length_m, 0);
                const dstTj = selectedCable.dst_tj_id ? tjBoxes.find((t) => t.id === selectedCable.dst_tj_id) : null;
                const straightM = dstTj && selectedCable.segments.length ? haversine(selectedCable.segments[0].start_lat, selectedCable.segments[0].start_lng, dstTj.lat, dstTj.lng) : 0;
                const totalM = lenM + totalLoopM;
                return (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">Straight Distance</div><div className="text-lg font-bold">{straightM > 0 ? (straightM / 1000).toFixed(2) + " km" : "—"}</div></div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">Cable Length</div><div className="text-lg font-bold">{(lenM / 1000).toFixed(2)} km</div></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg bg-cyan-50 dark:bg-cyan-900/20 p-3"><div className="text-xs text-cyan-600">Loop Slack</div><div className="text-lg font-bold text-cyan-700">{totalLoopM > 0 ? totalLoopM + "m (" + loopSum.length + " loops)" : "None"}</div></div>
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3"><div className="text-xs text-amber-600">Total Length</div><div className="text-lg font-bold text-amber-700">{(totalM / 1000).toFixed(2)} km</div></div>
                    </div>
                    {selectedCable.src_tj_name && <div className="text-xs text-slate-500">SRC: {selectedCable.src_tj_name}</div>}
                    {selectedCable.dst_tj_name && <div className="text-xs text-slate-500">DST: {selectedCable.dst_tj_name}</div>}
                    {selectedCable.manufacturer && <div className="text-xs text-slate-500">Manufacturer: {selectedCable.manufacturer}</div>}
                    {selectedCable.notes && <div className="text-xs text-slate-400">Notes: {selectedCable.notes}</div>}
                  </>
                );
              })()}
            </div>
            {writeOk && (
              <div className="mt-4 flex gap-2">
                <button className="btn-primary text-xs" onClick={() => { setSelectedCable(null); setEditingCableId(selectedCable.id); }}>Edit Path</button>
                <button className="btn-secondary text-xs" onClick={() => { setSelectedCable(null); startEdit("cable", selectedCable); }}>Edit Info</button>
              </div>
            )}
          </div>
        </div>
      )}

      {showForm === "cable" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowForm(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{editingId ? "Edit" : "Add"} Cable</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Link ID</label><input className="input bg-slate-100 dark:bg-slate-800" value={cableForm.link_id || ""} readOnly placeholder="Auto-generated" /></div>
                <div><label className="label">Link Name</label><input className="input" value={cableForm.link_name || ""} onChange={(e) => setCableForm({ ...cableForm, link_name: e.target.value })} placeholder="e.g. Barishal Main Trunk" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Source TJ</label><select className="input" value={cableForm.src_tj_id || ""} onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setCableForm({ ...cableForm, src_tj_id: id });
                }}>
                  <option value="">Select Source</option>
                  {tjBoxes.map((t) => <option key={t.id} value={t.id}>{t.unique_id} - {t.name}</option>)}
                </select></div>
                <div><label className="label">Destination TJ</label><select className="input" value={cableForm.dst_tj_id || ""} onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setCableForm({ ...cableForm, dst_tj_id: id });
                }}>
                  <option value="">Select Destination</option>
                  {tjBoxes.map((t) => <option key={t.id} value={t.id}>{t.unique_id} - {t.name}</option>)}
                </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Manufacturer *</label><input className="input" value={cableForm.manufacturer || ""} onChange={(e) => setCableForm({ ...cableForm, manufacturer: e.target.value })} required /></div>
                <div><label className="label">Cable Code *</label><input className="input" value={cableForm.code || ""} onChange={(e) => setCableForm({ ...cableForm, code: e.target.value })} placeholder="e.g. FOC-001" required /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Type</label><select className="input" value={cableForm.cable_type || "round"} onChange={(e) => setCableForm({ ...cableForm, cable_type: e.target.value })}>
                  <option value="round">Round Fiber</option><option value="figure8">Figure 8 Messenger</option>
                </select></div>
                <div><label className="label">Core Count</label><select className="input" value={cableForm.core_count || 12} onChange={(e) => setCableForm({ ...cableForm, core_count: Number(e.target.value) })}>
                  {[2, 4, 8, 12, 24, 36, 48, 144].map((n) => <option key={n} value={n}>{n} cores</option>)}
                </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Route Type</label><select className="input" value={cableForm.route_type || "driving"} onChange={(e) => setCableForm({ ...cableForm, route_type: e.target.value })}>
                  <option value="driving">Driving Route</option><option value="foot">Walking Route</option>
                </select></div>
                <div><label className="label">Year *</label><input type="number" className="input" value={cableForm.manufacturing_year || ""} onChange={(e) => setCableForm({ ...cableForm, manufacturing_year: Number(e.target.value) })} required /></div>
              </div>
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={cableForm.notes || ""} onChange={(e) => setCableForm({ ...cableForm, notes: e.target.value })} /></div>
              <div className="text-xs text-slate-500">Segments: {cableForm.segments?.length || 0} points ({routeModeType === "straight" ? "straight line" : "road route"})</div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setShowForm(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveCable}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm === "tj" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowForm(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{editingId ? "Edit" : "Add"} TJ / Enclosure</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">TJ ID</label><input className="input bg-slate-100 dark:bg-slate-800" value={tjForm.unique_id || ""} readOnly placeholder="Auto-generated" /></div>
                <div><label className="label">TJ Name</label><input className="input" value={tjForm.name || ""} onChange={(e) => setTjForm({ ...tjForm, name: e.target.value })} required /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">TJ Type</label><select className="input" value={tjForm.box_type || "regular_tj"} onChange={(e) => {
                  const box_type = e.target.value;
                  const isLarge = box_type === "enclosure" || box_type === "dome";
                  setTjForm({ ...tjForm, box_type, tray_count: isLarge ? 1 : undefined, capacity: isLarge ? 12 : undefined });
                }}>
                  <option value="home_tj">Home TJ</option><option value="regular_tj">Regular TJ</option><option value="enclosure">Enclosure</option><option value="dome">Dome / Bamboo</option>
                </select></div>
                <div><label className="label">TJ Port</label><select className="input" value={tjForm.tj_port || 4} onChange={(e) => setTjForm({ ...tjForm, tj_port: Number(e.target.value) })}>
                  {[2, 4, 6, 8, 10, 12].map((n) => <option key={n} value={n}>{n} ports</option>)}
                </select></div>
              </div>
              {(tjForm.box_type === "enclosure" || tjForm.box_type === "dome") && (
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="label">Tray Count</label><select className="input" value={tjForm.tray_count || 1} onChange={(e) => setTjForm({ ...tjForm, tray_count: Number(e.target.value) })}>
                    {[1, 2, 4, 8, 12].map((n) => <option key={n} value={n}>{n} trays</option>)}
                  </select></div>
                  <div><label className="label">Splice Capacity</label><select className="input" value={tjForm.capacity || 4} onChange={(e) => setTjForm({ ...tjForm, capacity: Number(e.target.value) })}>
                    {[2, 4, 8, 10, 12, 24, 48, 96, 144].map((n) => <option key={n} value={n}>{n} cores</option>)}
                  </select></div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Latitude</label><input type="number" step="any" className="input" value={tjForm.lat || ""} onChange={(e) => setTjForm({ ...tjForm, lat: Number(e.target.value) })} required /></div>
                <div><label className="label">Longitude</label><input type="number" step="any" className="input" value={tjForm.lng || ""} onChange={(e) => setTjForm({ ...tjForm, lng: Number(e.target.value) })} required /></div>
              </div>
              <div><label className="label">Address</label><input className="input" value={tjForm.address || ""} onChange={(e) => setTjForm({ ...tjForm, address: e.target.value })} /></div>
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={tjForm.notes || ""} onChange={(e) => setTjForm({ ...tjForm, notes: e.target.value })} /></div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setShowForm(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveTj}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm === "splitter" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowForm(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{editingId ? "Edit" : "Add"} Splitter</h2>
            <div className="space-y-3">
              {(() => {
                const parentTj = tjBoxes.find((t) => t.id === splitterForm.tj_box_id);
                return parentTj ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Parent TJ</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{parentTj.unique_id}</div>
                    {parentTj.name && <div className="text-xs text-slate-500 dark:text-slate-400">{parentTj.name}</div>}
                    <div className="mt-1 text-[10px] text-slate-400">GPS: {parentTj.lat?.toFixed(6)}, {parentTj.lng?.toFixed(6)}</div>
                  </div>
                ) : (
                  <div className="text-xs text-red-500">No parent TJ selected. Close and re-open from a TJ.</div>
                );
              })()}
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Name</label><input className="input" value={splitterForm.name || ""} onChange={(e) => setSplitterForm({ ...splitterForm, name: e.target.value })} /></div>
                <div><label className="label">Split Ratio</label><select className="input" value={splitterForm.split_ratio || 2} onChange={(e) => setSplitterForm({ ...splitterForm, split_ratio: Number(e.target.value) })}>
                  {[2, 4, 8, 16, 32, 64].map((n) => <option key={n} value={n}>1:{n}</option>)}
                </select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Input Core</label><input type="number" className="input" value={splitterForm.input_core || 0} onChange={(e) => setSplitterForm({ ...splitterForm, input_core: Number(e.target.value) })} /></div>
                <div><label className="label">Output Cores</label><input className="input" placeholder="e.g. 1,2,3,4" value={splitterForm.output_cores || ""} onChange={(e) => setSplitterForm({ ...splitterForm, output_cores: e.target.value })} /></div>
              </div>
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={splitterForm.notes || ""} onChange={(e) => setSplitterForm({ ...splitterForm, notes: e.target.value })} /></div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setShowForm(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveSplitter} disabled={!splitterForm.tj_box_id}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm === "loop" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowForm(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{loopForm.id ? "Edit" : "Add"} Fiber Loop</h2>
            <div className="space-y-3">
              <div><label className="label">Cable</label><select className="input" value={loopForm.cable_id || ""} onChange={(e) => setLoopForm({ ...loopForm, cable_id: Number(e.target.value) })}>
                <option value="">Select Cable</option>
                {cables.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.core_count}C</option>)}
              </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Latitude</label><input type="number" step="any" className="input" value={loopForm.lat || ""} onChange={(e) => setLoopForm({ ...loopForm, lat: Number(e.target.value) })} required /></div>
                <div><label className="label">Longitude</label><input type="number" step="any" className="input" value={loopForm.lng || ""} onChange={(e) => setLoopForm({ ...loopForm, lng: Number(e.target.value) })} required /></div>
              </div>
              <div><label className="label">Loop Length (m)</label><input type="number" className="input" value={loopForm.loop_length_m || ""} onChange={(e) => setLoopForm({ ...loopForm, loop_length_m: Number(e.target.value) })} placeholder="Extra cable length in meters" /></div>
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={loopForm.notes || ""} onChange={(e) => setLoopForm({ ...loopForm, notes: e.target.value })} /></div>
              <div className="flex justify-end gap-2 pt-2">
                {loopForm.id && <button className="btn-danger" onClick={() => { deleteLoop(loopForm.id!); setShowForm(null); }}>Delete</button>}
                <button className="btn-secondary" onClick={() => setShowForm(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveLoop}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm === "cut" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowForm(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{cutForm.id ? "Edit" : "Report"} Cable Cut</h2>
            <div className="space-y-3">
              <div><label className="label">Cable</label><select className="input" value={cutForm.cable_id || ""} onChange={(e) => setCutForm({ ...cutForm, cable_id: Number(e.target.value) })}>
                <option value="">Select Cable</option>
                {cables.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.core_count}C</option>)}
              </select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Latitude</label><input type="number" step="any" className="input" value={cutForm.lat || ""} onChange={(e) => setCutForm({ ...cutForm, lat: Number(e.target.value) })} required /></div>
                <div><label className="label">Longitude</label><input type="number" step="any" className="input" value={cutForm.lng || ""} onChange={(e) => setCutForm({ ...cutForm, lng: Number(e.target.value) })} required /></div>
              </div>
              {cutForm.id && (
                <div><label className="label">Splice TJ Box</label><select className="input" value={cutForm.splice_tj_id || ""} onChange={(e) => setCutForm({ ...cutForm, splice_tj_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">None</option>
                  {tjBoxes.map((t) => <option key={t.id} value={t.id}>{t.unique_id} — {t.name}</option>)}
                </select></div>
              )}
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={cutForm.notes || ""} onChange={(e) => setCutForm({ ...cutForm, notes: e.target.value })} /></div>
              <div className="flex justify-end gap-2 pt-2">
                {cutForm.id && cutForm.status !== "repaired" && <button className="btn-primary bg-green-600 hover:bg-green-700" onClick={() => { markRepaired(cutForm.id!); setShowForm(null); }}>Mark Repaired</button>}
                {cutForm.id && <button className="btn-danger" onClick={() => { deleteCut(cutForm.id!); setShowForm(null); }}>Delete</button>}
                <button className="btn-secondary" onClick={() => setShowForm(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveCut}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Feasibility Check Modal */}
      {feasCheckOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => { setFeasCheckOpen(false); setFeasChecked(false); setFeasResults([]); }}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Feasibility Check</h2>
              <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={() => { setFeasCheckOpen(false); setFeasChecked(false); setFeasResults([]); }}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">Enter coordinates to find the 3 nearest TJ boxes and their connected cable destinations.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Latitude</label>
                  <input type="number" step="any" className="input" placeholder="e.g. 1.3521" value={feasLat} onChange={(e) => setFeasLat(e.target.value)} />
                </div>
                <div>
                  <label className="label">Longitude</label>
                  <input type="number" step="any" className="input" placeholder="e.g. 103.8198" value={feasLng} onChange={(e) => setFeasLng(e.target.value)} />
                </div>
              </div>
              <button className="btn-primary" onClick={runFeasibilityCheck}>Check Feasibility</button>
              {feasChecked && (
                <div className="mt-4">
                  {feasResults.length === 0 ? (
                    <p className="text-sm text-slate-500">No TJ boxes found in the database.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700">
                          <th className="text-left py-2 text-slate-600 dark:text-slate-400">TJ</th>
                          <th className="text-right py-2 text-slate-600 dark:text-slate-400">Distance</th>
                          <th className="text-left py-2 text-slate-600 dark:text-slate-400">Cable Destinations</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feasResults.map((r, i) => (
                          <tr key={r.tj.id} className="border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors" onClick={() => {
                            if (mapRef.current) {
                              mapRef.current.flyTo([r.tj.lat, r.tj.lng], 16, { duration: 1.2 });
                              setSelectedTj(r.tj);
                            }
                          }}>
                            <td className="py-2">
                              <span className="font-semibold text-slate-900 dark:text-white">{r.tj.unique_id}</span>
                              {r.tj.name && <span className="ml-1 text-slate-500 dark:text-slate-400">{r.tj.name}</span>}
                              {i === 0 && <span className="ml-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">NEAREST</span>}
                            </td>
                            <td className="py-2 text-right font-mono text-slate-700 dark:text-slate-300">{r.distance.toFixed(2)} km</td>
                            <td className="py-2 text-slate-600 dark:text-slate-400">
                              {r.destinations.length > 0 ? r.destinations.join(", ") : <span className="italic text-slate-400">No cables</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CORE_COLORS_ARR = ["#3b82f6","#f97316","#22c55e","#92400e","#9ca3af","#ffffff","#ef4444","#000000","#eab308","#8b5cf6","#ec4899","#06b6d4"];
const CORE_COLOR_NAMES = ["Blue","Orange","Green","Brown","Slate","White","Red","Black","Yellow","Violet","Rose","Aqua"];

function CoreColorDot({ coreIndex, size = 8 }: { coreIndex: number; size?: number }) {
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

function CoreSelect({ coreCount, value, onChange, occupiedCores, spareCores }: {
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

function TjDetailPanel({ tj, cables, splitters, splices, onClose, onSpliceChange, writeOk, onAddSplitter, onEditSplitter }: { tj: TjBox; cables: Cable[]; splitters: Splitter[]; splices: any[]; onClose: () => void; onSpliceChange: () => void; writeOk: boolean; onAddSplitter?: () => void; onEditSplitter?: (sp: Splitter) => void }) {
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
  const [spliceForm, setSpliceForm] = useState({ cable_a_id: 0, core_a: 1, cable_b_id: 0, core_b: 1, status: "active", notes: "" });
  const [unusedCores, setUnusedCores] = useState<any[]>([]);
  const [splicePage, setSplicePage] = useState(0);
  const [spliceSearch, setSpliceSearch] = useState("");
  const [cableSearchA, setCableSearchA] = useState("");
  const [cableSearchB, setCableSearchB] = useState("");
  const [tjTab, setTjTab] = useState<"cable" | "splice">("cable");
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
      setSpliceForm({ cable_a_id: splice.cable_a_id, core_a: splice.core_a, cable_b_id: splice.cable_b_id, core_b: splice.core_b, status: splice.status, notes: splice.notes || "" });
    } else {
      setEditSplice(null);
      setSpliceForm({ cable_a_id: connectedCables[0]?.id || 0, core_a: 1, cable_b_id: connectedCables[1]?.id || connectedCables[0]?.id || 0, core_b: 1, status: "active", notes: "" });
    }
    setShowSpliceForm(true);
  };

  const saveSplice = async () => {
    try {
      if (editSplice) {
        await api.put(`/fiber/splices/${editSplice.id}`, spliceForm);
      } else {
        await api.post("/fiber/splices", { ...spliceForm, tj_id: tj.id });
      }
      setShowSpliceForm(false);
      onSpliceChange();
    } catch (e) { alert(String(e)); }
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
          <button className="btn-secondary text-[10px] py-1 px-2" onClick={() => { setTjEditForm({ name: tj.name || "", address: tj.address || "", notes: tj.notes || "" }); setShowTjEdit(true); }}>Edit</button>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      {/* Internal diagram */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60 mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">Splice Tray Diagram</h3>
        {connectedCables.length > 0 ? (
          <div className="space-y-2">
            {/* Generate splice pairs from connected cables */}
            {(() => {
              const pairs: { left: { cable: typeof connectedCables[0]; core: number; color: string }; right: { cable: typeof connectedCables[0]; core: number; color: string } | null }[] = [];
              for (let i = 0; i < connectedCables.length; i++) {
                const c1 = connectedCables[i];
                const c2 = connectedCables[i + 1] || null;
                const coreCount = Math.min(c1.core_count, c2 ? c2.core_count : c1.core_count, 8);
                for (let j = 0; j < coreCount; j++) {
                  const coreColor = CORE_COLORS_ARR[j % CORE_COLORS_ARR.length];
                  pairs.push({
                    left: { cable: c1, core: j + 1, color: coreColor },
                    right: c2 ? { cable: c2, core: j + 1, color: coreColor } : null,
                  });
                }
                if (c2) i++; // skip next cable as it's paired
              }
              return pairs.slice(0, tj.capacity).map((pair, idx) => (
                <div key={idx} className="flex items-center gap-1 group">
                  {/* Left core */}
                  <div className="flex items-center gap-1 min-w-[90px]">
                    <CoreColorDot coreIndex={pair.left.core} size={12} />
                    <span className="text-[9px] font-mono text-slate-500 truncate">{pair.left.cable.code}</span>
                    <span className="text-[9px] font-mono font-semibold" style={{ color: pair.left.color }}>:{pair.left.core}</span>
                  </div>
                  {/* Splice sleeve */}
                  <div className="relative flex items-center" title={`${pair.left.cable.code} core ${pair.left.core} (${pair.left.cable.core_count}C ${pair.left.cable.manufacturer || "?"}) ↔ ${pair.right ? pair.right.cable.code + " core " + pair.right.core + " (" + pair.right.cable.core_count + "C " + (pair.right.cable.manufacturer || "?") + ")" : "empty"}`}>
                    <div className="w-8 h-2.5 rounded-full border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800 group-hover:border-indigo-400 group-hover:bg-indigo-50 dark:group-hover:bg-indigo-950/40 transition-colors" />
                    <div className="absolute left-0.5 right-0.5 h-0.5 rounded-full top-1/2 -translate-y-1/2" style={{ background: pair.right ? `linear-gradient(90deg, ${pair.left.color}, ${pair.right.color})` : pair.left.color + "44" }} />
                  </div>
                  {/* Right core */}
                  <div className="flex items-center gap-1 min-w-[90px] justify-end">
                    {pair.right ? (
                      <>
                        <span className="text-[9px] font-mono font-semibold" style={{ color: pair.right.color }}>:{pair.right.core}</span>
                        <span className="text-[9px] font-mono text-slate-500 truncate">{pair.right.cable.code}</span>
                        <CoreColorDot coreIndex={pair.right.core} size={12} />
                      </>
                    ) : (
                      <span className="text-[9px] text-slate-300 dark:text-slate-600">—</span>
                    )}
                  </div>
                  {/* Core number */}
                  <span className="text-[8px] text-slate-300 dark:text-slate-600 ml-1">{idx + 1}</span>
                </div>
              ));
            })()}
            {tj.capacity > 8 && <div className="text-[9px] text-slate-400 mt-1">... {tj.capacity} cores total</div>}
          </div>
        ) : (
          <div className="text-xs text-slate-400">No cables connected</div>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 mb-3">
        <button className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${tjTab === "cable" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`} onClick={() => setTjTab("cable")}>Cables ({connectedCables.length})</button>
        <button className={`px-3 py-1.5 text-xs font-medium border-b-2 transition ${tjTab === "splice" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`} onClick={() => setTjTab("splice")}>Splices ({tjSplices.length})</button>
      </div>

      {/* Cable tab */}
      {tjTab === "cable" && (
        <div className="mb-4">
          {/* Connected cables */}
          {connectedCables.length > 0 && (
            <div className="space-y-2 mb-4">
              {connectedCables.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="badge text-[10px]" style={{ background: CORE_COLORS[c.core_count] || "#6b7280", color: "white" }}>{c.core_count}C</span>
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

          {/* Hosted splitters */}
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
            <div className="text-xs text-slate-400">No cables connected</div>
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
                  return (
                    <div key={sp.id} className="rounded-md border border-slate-200 bg-white px-2 py-2 text-[11px] dark:border-slate-700 dark:bg-slate-900 group">
                      <div className="flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${sp.status === "active" ? "bg-emerald-500" : sp.status === "spare" ? "bg-amber-500" : "bg-red-500"}`} />
                        {/* Cable A side */}
                        <div className="flex items-center gap-1">
                          <span className="font-mono font-bold" style={{ color: CORE_COLORS[ca?.core_count || 0] || "#6b7280" }}>{sp.cable_a_code}</span>
                          <span className="text-[9px] text-slate-400">{ca?.manufacturer || ""} {ca?.manufacturing_year || ""}</span>
                        </div>
                        <span className="text-slate-300">:</span>
                        {/* Core A with color */}
                        <div className="flex items-center gap-0.5 rounded border border-slate-200 dark:border-slate-700 px-1 py-0.5">
                          <CoreColorDot coreIndex={sp.core_a} size={8} />
                          <span className="text-[9px] font-mono font-semibold">{sp.core_a}</span>
                        </div>
                        <span className="text-slate-400">↔</span>
                        {/* Cable B side */}
                        <div className="flex items-center gap-1">
                          <span className="font-mono font-bold" style={{ color: CORE_COLORS[cb?.core_count || 0] || "#6b7280" }}>{sp.cable_b_code}</span>
                          <span className="text-[9px] text-slate-400">{cb?.manufacturer || ""} {cb?.manufacturing_year || ""}</span>
                        </div>
                        <span className="text-slate-300">:</span>
                        {/* Core B with color */}
                        <div className="flex items-center gap-0.5 rounded border border-slate-200 dark:border-slate-700 px-1 py-0.5">
                          <CoreColorDot coreIndex={sp.core_b} size={8} />
                          <span className="text-[9px] font-mono font-semibold">{sp.core_b}</span>
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

      {/* Splice form modal */}
      {showSpliceForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md p-5 max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-bold mb-3">{editSplice ? "Edit Splice" : "New Splice"}</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Cable A</label>
                  <input className="input text-[10px] py-1 mb-1" placeholder="Search cable..." value={cableSearchA} onChange={(e) => setCableSearchA(e.target.value)} />
                  <select className="input text-xs" size={Math.min(filteredCablesA.length, 5)} value={spliceForm.cable_a_id} onChange={(e) => {
                    const newCableId = Number(e.target.value);
                    const uc = unusedCores.find((u) => u.cable_id === newCableId);
                    const firstSpare = uc?.spare_cores?.[0] || 1;
                    setSpliceForm({ ...spliceForm, cable_a_id: newCableId, core_a: firstSpare });
                  }}>
                    {filteredCablesA.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.manufacturer || "?"} · {c.manufacturing_year || "?"} ({c.core_count}C)</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Core A</label>
                  <CoreSelect
                    coreCount={connectedCables.find((c) => c.id === spliceForm.cable_a_id)?.core_count || 12}
                    value={spliceForm.core_a}
                    onChange={(v) => setSpliceForm({ ...spliceForm, core_a: v })}
                    occupiedCores={unusedCores.find((u) => u.cable_id === spliceForm.cable_a_id)?.occupied_cores}
                    spareCores={unusedCores.find((u) => u.cable_id === spliceForm.cable_a_id)?.spare_cores}
                  />
                </div>
              </div>
              <div className="text-center text-xs text-slate-400">↔ Splice ↔</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Cable B</label>
                  <input className="input text-[10px] py-1 mb-1" placeholder="Search cable..." value={cableSearchB} onChange={(e) => setCableSearchB(e.target.value)} />
                  <select className="input text-xs" size={Math.min(filteredCablesB.length, 5)} value={spliceForm.cable_b_id} onChange={(e) => {
                    const newCableId = Number(e.target.value);
                    const uc = unusedCores.find((u) => u.cable_id === newCableId);
                    const firstSpare = uc?.spare_cores?.[0] || 1;
                    setSpliceForm({ ...spliceForm, cable_b_id: newCableId, core_b: firstSpare });
                  }}>
                    {filteredCablesB.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.manufacturer || "?"} · {c.manufacturing_year || "?"} ({c.core_count}C)</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Core B</label>
                  <CoreSelect
                    coreCount={connectedCables.find((c) => c.id === spliceForm.cable_b_id)?.core_count || 12}
                    value={spliceForm.core_b}
                    onChange={(v) => setSpliceForm({ ...spliceForm, core_b: v })}
                    occupiedCores={unusedCores.find((u) => u.cable_id === spliceForm.cable_b_id)?.occupied_cores}
                    spareCores={unusedCores.find((u) => u.cable_id === spliceForm.cable_b_id)?.spare_cores}
                  />
                </div>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input text-xs" value={spliceForm.status} onChange={(e) => setSpliceForm({ ...spliceForm, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="spare">Spare</option>
                  <option value="broken">Broken</option>
                </select>
              </div>
              <div>
                <label className="label">Notes</label>
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

function FiberMapView({ cables, tjBoxes, splitters, loops, cuts, nocPopData, center, mapRef, routeMode, routeSrcTj, routeDstTj, isFullscreen, dragMode, onToggleFullscreen, onTjClick, onDrawCreated, onRightClickAdd, onCableSegmentUpdate, onTjMove, onSplitterMove, onCableClick, onLoopClick, onCutClick, editingCableId, onEditingCableDone }: {
  cables: Cable[]; tjBoxes: TjBox[]; splitters: Splitter[]; loops: FiberLoop[]; cuts: CableCut[];
  nocPopData: { nocs: any[]; pops: any[] };
  center: { lat: number; lng: number };
  mapRef: React.MutableRefObject<L.Map | null>;
  routeMode: boolean;
  routeSrcTj: TjBox | null;
  routeDstTj: TjBox | null;
  isFullscreen: boolean;
  dragMode: boolean;
  onToggleFullscreen: () => void;
  onTjClick: (tj: TjBox) => void;
  onDrawCreated: (e: any) => void;
  onRightClickAdd: (kind: string, lat: number, lng: number) => void;
  onCableSegmentUpdate: (cableId: number, segments: { id?: number; start_lat: number; start_lng: number; end_lat: number; end_lng: number; order_index: number }[]) => void;
  onTjMove: (tjId: number, lat: number, lng: number) => void;
  onSplitterMove: (spId: number, lat: number, lng: number) => void;
  onCableClick: (cable: Cable) => void;
  onLoopClick: (loop: FiberLoop) => void;
  onCutClick: (cut: CableCut) => void;
  editingCableId: number | null;
  onEditingCableDone: () => void;
}) {
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const drawControlRef = useRef<L.Control.Draw | null>(null);
  const drawFeatureGroupRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const routeMarkersRef = useRef<L.Marker[]>([]);
  const nocPopLayerRef = useRef<L.LayerGroup | null>(null);
  const cableLayersRef = useRef<Map<number, L.Polyline>>(new Map());
  const onRightClickRef = useRef(onRightClickAdd);
  onRightClickRef.current = onRightClickAdd;

  useEffect(() => {
    if (!mapEl || mapRef.current) return;
    const map = L.map(mapEl, { zoomControl: true }).setView([center.lat, center.lng], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap", maxZoom: 19,
    }).addTo(map);

    const drawControl = new L.Control.Draw({
      draw: {
        polyline: { shapeOptions: { color: "#ef4444", weight: 2 } },
        polygon: false, circle: false, rectangle: false, marker: false, circlemarker: false,
      },
      edit: { featureGroup: drawFeatureGroupRef.current },
    });
    map.addControl(drawControl);
    drawControlRef.current = drawControl;
    map.on(L.Draw.Event.CREATED, (e) => { onDrawCreated(e); });

    map.on("contextmenu", (e: L.LeafletMouseEvent) => {
      const old = map.getContainer().querySelector(".ctx-menu");
      if (old) old.remove();
      const pt = map.latLngToContainerPoint(e.latlng);
      const menu = document.createElement("div");
      menu.className = "ctx-menu";
      menu.style.cssText = "position:absolute;z-index:9999;background:#1e293b;border-radius:8px;padding:4px 0;box-shadow:0 4px 16px rgba(0,0,0,.4);min-width:180px;left:" + pt.x + "px;top:" + pt.y + "px;";
      const cLat = e.latlng.lat.toFixed(6);
      const cLng = e.latlng.lng.toFixed(6);
      menu.innerHTML = '<div style="padding:6px 12px;color:#94a3b8;font-size:11px;font-weight:600">' + cLat + ", " + cLng + "</div>"
        + '<div class="ctx-i" data-kind="tj" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>Add TJ Box</div>'
        + '<div class="ctx-i" data-kind="cable" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M4 12h16M12 4v16"/></svg>Add Cable</div>'
        + '<div class="ctx-i" data-kind="loop" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><circle cx="12" cy="12" r="8" stroke-dasharray="4,2"/></svg>Add Loop</div>'
        + '<div class="ctx-i" data-kind="cut" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><line x1="6" y1="18" x2="18" y2="6"/></svg>Report Cut</div>';
      map.getContainer().appendChild(menu);
      L.DomEvent.disableClickPropagation(menu);
      menu.querySelectorAll(".ctx-i").forEach((el) => {
        el.addEventListener("click", () => {
          const kind = el.getAttribute("data-kind");
          if (kind) onRightClickRef.current(kind, e.latlng.lat, e.latlng.lng);
          menu.remove();
        });
      });
      map.once("click", () => menu.remove());
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [mapEl, center]);

  const onTjClickRef = useRef(onTjClick);
  onTjClickRef.current = onTjClick;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    routeMarkersRef.current.forEach((m) => map.removeLayer(m));
    routeMarkersRef.current = [];
    if (routeSrcTj) {
      const m = L.marker([routeSrcTj.lat, routeSrcTj.lng], { icon: tjIcon("#22c55e") }).bindTooltip("SRC: " + routeSrcTj.unique_id, { permanent: true, className: "" }).addTo(map);
      routeMarkersRef.current.push(m);
    }
    if (routeDstTj) {
      const m = L.marker([routeDstTj.lat, routeDstTj.lng], { icon: tjIcon("#3b82f6") }).bindTooltip("DST: " + routeDstTj.unique_id, { permanent: true, className: "" }).addTo(map);
      routeMarkersRef.current.push(m);
    }
  }, [routeSrcTj, routeDstTj]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    cableLayersRef.current.clear();
    drawFeatureGroupRef.current.clearLayers();
    map.eachLayer((layer: L.Layer) => {
      if (!(layer instanceof L.TileLayer) && !(layer instanceof L.Control.Draw)) map.removeLayer(layer);
    });
    if (nocPopLayerRef.current) {
      nocPopLayerRef.current.addTo(map);
    }

    const onCableRef = onCableSegmentUpdate;
    const onTjRef = onTjMove;
    const onSpRef = onSplitterMove;
    const onCableClickFn = onCableClick;
    const onLoopClickFn = onLoopClick;
    const onCutClickFn = onCutClick;

    for (const cable of cables) {
      if (!cable.segments?.length) continue;
      const color = CORE_COLORS[cable.core_count] || "#6b7280";
      const points: [number, number][] = [];
      for (const s of cable.segments) points.push([s.start_lat, s.start_lng]);
      const last = cable.segments[cable.segments.length - 1];
      points.push([last.end_lat, last.end_lng]);

      if (points.length >= 2) {
        const lenM = cableLengthM(cable);
        const lenKm = (lenM / 1000).toFixed(2);
        const loopSum = loops.filter((l) => l.cable_id === cable.id).reduce((a, l) => a + l.loop_length_m, 0);
        const totalM = lenM + loopSum;
        const dstTj = cable.dst_tj_id ? tjBoxes.find((t) => t.id === cable.dst_tj_id) : null;
        const straightM = dstTj && cable.segments.length ? haversine(cable.segments[0].start_lat, cable.segments[0].start_lng, dstTj.lat, dstTj.lng) : 0;
        const tipParts = ["<b>" + cable.code + "</b>", cable.core_count + " cores"];
        if (straightM > 0) tipParts.push("Straight: " + (straightM / 1000).toFixed(2) + " km");
        tipParts.push("Cable: " + lenKm + " km");
        if (loopSum > 0) tipParts.push("Loop: " + (loopSum / 1000).toFixed(2) + " km");
        tipParts.push("Total: " + (totalM / 1000).toFixed(2) + " km");
        tipParts.push("<i>click for details</i>");

        const pl = L.polyline(points, { color, weight: 2, opacity: 0.85 })
          .bindTooltip(tipParts.join("<br>"), { sticky: true });
        pl.addTo(map);
        drawFeatureGroupRef.current.addLayer(pl);
        cableLayersRef.current.set(cable.id, pl);

        pl.on("dblclick", (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          if ((pl as any).editing?.enabled()) return;
          pl.setStyle({ weight: 3, dashArray: "6,4" });
          if (typeof (pl as any).enableEdit === "function") {
            (pl as any).enableEdit();
          }
          const verts = pl.getLatLngs() as L.LatLng[];
          const origSegs = cable.segments.map((s) => ({ ...s }));
          const onEditStop = () => {
            pl.setStyle({ weight: 3, dashArray: undefined });
            if (typeof (pl as any).disableEdit === "function") {
              (pl as any).disableEdit();
            }
            const newVerts = pl.getLatLngs() as L.LatLng[];
            const segs = newVerts.slice(0, -1).map((ll, i) => ({
              id: origSegs[i]?.id,
              start_lat: ll.lat, start_lng: ll.lng,
              end_lat: newVerts[i + 1].lat, end_lng: newVerts[i + 1].lng,
              order_index: i,
            }));
            onCableRef(cable.id, segs);
          };
          (pl as any).on("edit:stop", onEditStop);
        });
        pl.on("click", (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          onCableClickFn(cable);
        });
      }

      for (let si = 0; si < cable.segments.length; si++) {
        const seg = cable.segments[si];
        const endMarker = L.circleMarker([seg.end_lat, seg.end_lng], { radius: 4, color, fillColor: color, fillOpacity: 1 });
        endMarker.on("click", (e) => { L.DomEvent.stopPropagation(e); });
        endMarker.addTo(map);
        if (si === 0) {
          const startMarker = L.circleMarker([seg.start_lat, seg.start_lng], { radius: 4, color, fillColor: color, fillOpacity: 1 });
          startMarker.on("click", (e) => { L.DomEvent.stopPropagation(e); });
          startMarker.addTo(map);
        }
        // Midpoint marker — draggable to adjust cable path
        const midLat = (seg.start_lat + seg.end_lat) / 2;
        const midLng = (seg.start_lng + seg.end_lng) / 2;
        const midMarker = L.circleMarker([midLat, midLng], { radius: 5, color: "#fbbf24", fillColor: "#fbbf24", fillOpacity: 0.9, weight: 2, draggable: dragMode })
          .bindTooltip(dragMode ? "Drag to adjust cable" : "Enable drag mode", { direction: "top" });
        if (dragMode) {
          midMarker.on("click", (e) => {
            L.DomEvent.stopPropagation(e.originalEvent);
          });
          midMarker.on("dragend", (e) => {
            const pos = e.target.getLatLng();
            const newSegs = cable.segments.map((s, i) => ({ ...s }));
            // Split this segment into two at the new midpoint
            const newSeg1 = { start_lat: seg.start_lat, start_lng: seg.start_lng, end_lat: pos.lat, end_lng: pos.lng, order_index: si };
            const newSeg2 = { start_lat: pos.lat, start_lng: pos.lng, end_lat: seg.end_lat, end_lng: seg.end_lng, order_index: si + 1 };
            newSegs.splice(si, 1, newSeg1, newSeg2);
            // Reindex
            newSegs.forEach((s, i) => s.order_index = i);
            onCableSegmentUpdate(cable.id, newSegs);
          });
        }
        // Click to straighten (when not in drag mode)
        if (!dragMode) {
          midMarker.on("click", (e) => {
            L.DomEvent.stopPropagation(e.originalEvent);
            const srcTj = tjBoxes.find((t) => Math.abs(t.lat - seg.start_lat) < 0.001 && Math.abs(t.lng - seg.start_lng) < 0.001);
            const dstTj = tjBoxes.find((t) => Math.abs(t.lat - seg.end_lat) < 0.001 && Math.abs(t.lng - seg.end_lng) < 0.001);
            if (!srcTj || !dstTj) { alert("Segment endpoints not at a TJ — cannot auto-straighten."); return; }
            onCableSegmentUpdate(cable.id, [{ start_lat: srcTj.lat, start_lng: srcTj.lng, end_lat: dstTj.lat, end_lng: dstTj.lng, order_index: 0 }]);
          });
        }
        midMarker.addTo(map);
      }
    }

    for (const tj of tjBoxes) {
      const hostedSps = splitters.filter((s) => s.tj_box_id === tj.id);
      const hasSplitters = hostedSps.length > 0;
      const tjColor = TJ_CAPACITY_COLORS[tj.tj_port] || "#6366f1";
      const maxRatio = hasSplitters ? Math.max(...hostedSps.map((s) => s.split_ratio)) : 0;
      const spColor = SPLITTER_RATIO_COLORS[maxRatio] || "#f59e0b";
      const markerIcon = hasSplitters ? splitterIcon(spColor) : tjIcon(tjColor);

      let tip = "<b>" + tj.unique_id + "</b> · " + tj.name
        + "<br>" + tj.box_type + " · " + tj.tj_port + " ports"
        + ((tj.box_type === "enclosure" || tj.box_type === "dome") ? " · " + tj.capacity + " cap · " + tj.tray_count + " trays" : "")
        + (tj.address ? "<br>" + tj.address : "");
      if (hasSplitters) {
        tip += "<br><hr style='margin:4px 0;border-color:#475569'>";
        for (const sp of hostedSps) {
          const loss = splitterLoss(sp.split_ratio);
          const outCount = sp.output_cores ? sp.output_cores.split(',').length : sp.split_ratio;
          tip += "<span style='color:#f59e0b'>▲</span> <b>" + sp.unique_id + "</b> 1:" + sp.split_ratio;
          tip += " · In: core " + (sp.input_core || "—");
          tip += " · Out: " + outCount + " ports";
          tip += " (" + loss.toFixed(1) + " dB)";
          if (sp.name) tip += " · " + sp.name;
          tip += "<br>";
        }
      }
      tip += dragMode ? "<br><i>drag to move</i>" : "<br><i>click for details</i>";

      const marker = L.marker([tj.lat, tj.lng], { icon: markerIcon, draggable: dragMode })
        .bindTooltip(tip, { sticky: true });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onTjClickRef.current(tj);
      });
      if (dragMode) {
        marker.on("dragend", (e) => {
          const pos = e.target.getLatLng();
          onTjRef(tj.id, pos.lat, pos.lng);
        });
      }
      marker.addTo(map);
    }

    for (const sp of splitters) {
      const spColor = SPLITTER_RATIO_COLORS[sp.split_ratio] || "#f59e0b";
      const tjInfo = sp.tj_box_id ? tjBoxes.find((t) => t.id === sp.tj_box_id) : null;
      const loss = splitterLoss(sp.split_ratio);
      const outCount = sp.output_cores ? sp.output_cores.split(',').length : sp.split_ratio;
      const marker = L.marker([sp.lat, sp.lng], { icon: splitterIcon(spColor), draggable: dragMode })
        .bindTooltip(
          "<b>" + sp.unique_id + "</b> · Splitter 1:" + sp.split_ratio
          + (sp.name ? "<br>" + sp.name : "")
          + (tjInfo ? "<br>In: <b>" + tjInfo.unique_id + "</b> " + tjInfo.name : "")
          + (sp.input_core ? "<br>Input core: " + sp.input_core : "")
          + "<br>Output: " + outCount + " ports"
          + "<br>Loss: <b>" + loss.toFixed(1) + " dB</b>"
          + (dragMode ? "<br><i>drag to move</i>" : ""),
          { sticky: true }
        );
      if (dragMode) {
        marker.on("dragend", (e) => {
          const pos = e.target.getLatLng();
          onSpRef(sp.id, pos.lat, pos.lng);
        });
      }
      if (tjInfo) {
        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          onTjClickRef.current(tjInfo);
        });
      }
      marker.addTo(map);
    }

    for (const loop of loops) {
      const marker = L.marker([loop.lat, loop.lng], { icon: loopIcon() })
        .bindTooltip(
          "<b>Fiber Loop</b>" + (loop.loop_length_m ? "<br>" + loop.loop_length_m + "m slack" : "")
          + (loop.notes ? "<br>" + loop.notes : "")
          + "<br><i>click for details</i>",
          { sticky: true }
        );
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onLoopClickFn(loop);
      });
      marker.addTo(map);
    }

    for (const cut of cuts) {
      const cutIconInst = cut.status === "repaired" ? repairedIcon() : cutIcon();
      const marker = L.marker([cut.lat, cut.lng], { icon: cutIconInst })
        .bindTooltip(
          "<b>" + (cut.status === "repaired" ? "Repaired" : "CABLE CUT") + "</b>"
          + (cut.splice_tj_name ? "<br>Splice at: " + cut.splice_tj_name : "")
          + (cut.notes ? "<br>" + cut.notes : "")
          + "<br><i>click for details</i>",
          { sticky: true }
        );
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onCutClickFn(cut);
      });
      marker.addTo(map);
    }
  }, [cables, tjBoxes, splitters, loops, cuts, dragMode]);

  // Enable edit mode on a cable polyline when editingCableId is set
  useEffect(() => {
    if (editingCableId == null) return;
    const map = mapRef.current;
    if (!map) return;
    const pl = cableLayersRef.current.get(editingCableId);
    if (!pl) { onEditingCableDone(); return; }

    const cable = cables.find((c) => c.id === editingCableId);
    if (!cable) { onEditingCableDone(); return; }

    if (typeof (pl as any).enableEdit !== "function") {
      drawFeatureGroupRef.current.addLayer(pl);
    }

    pl.setStyle({ weight: 3, dashArray: "6,4" });
    if (typeof (pl as any).enableEdit === "function") {
      (pl as any).enableEdit();
    }
    const origSegs = cable.segments.map((s) => ({ ...s }));

    const onEditStop = () => {
      pl.setStyle({ weight: 3, dashArray: undefined });
      if (typeof (pl as any).disableEdit === "function") {
        (pl as any).disableEdit();
      }
      const newVerts = pl.getLatLngs() as L.LatLng[];
      const segs = newVerts.slice(0, -1).map((ll, i) => ({
        id: origSegs[i]?.id,
        start_lat: ll.lat, start_lng: ll.lng,
        end_lat: newVerts[i + 1].lat, end_lng: newVerts[i + 1].lng,
        order_index: i,
      }));
      onCableSegmentUpdate(editingCableId!, segs);
      onEditingCableDone();
    };
    (pl as any).on("edit:stop", onEditStop);

    return () => {
      if (typeof (pl as any).disableEdit === "function" && (pl as any).editing?.enabled()) {
        (pl as any).disableEdit();
        pl.setStyle({ weight: 2, dashArray: undefined });
      }
    };
  }, [editingCableId, cables, onCableSegmentUpdate, onEditingCableDone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !nocPopData) return;

    if (nocPopLayerRef.current) {
      map.removeLayer(nocPopLayerRef.current);
    }
    const layer = L.layerGroup();
    nocPopLayerRef.current = layer;

    for (const noc of (nocPopData.nocs || [])) {
      if (!noc.lat || !noc.lng) continue;
      const icon = L.divIcon({
        className: "",
        html: `<div style="position:relative;width:27px;height:27px">
          <svg viewBox="0 0 36 36" width="27" height="27" fill="none">
            <polygon points="18,1 22,14 14,14" fill="#ea580c" stroke="#fed7aa" stroke-width="1"/>
            <rect x="16" y="14" width="4" height="16" fill="#c2410c"/>
            <circle cx="18" cy="5" r="3" fill="#fb923c" stroke="#fff" stroke-width="0.8"/>
            <circle cx="18" cy="5" r="1.2" fill="#22c55e"/>
            <line x1="10" y1="10" x2="18" y2="5" stroke="#f97316" stroke-width="1" stroke-dasharray="2,1"/>
            <line x1="26" y1="10" x2="18" y2="5" stroke="#f97316" stroke-width="1" stroke-dasharray="2,1"/>
            <line x1="6" y1="14" x2="18" y2="5" stroke="#f97316" stroke-width="0.8" stroke-dasharray="2,1"/>
            <line x1="30" y1="14" x2="18" y2="5" stroke="#f97316" stroke-width="0.8" stroke-dasharray="2,1"/>
            <rect x="10" y="30" width="16" height="4" rx="1" fill="#ea580c" stroke="#fed7aa" stroke-width="0.8"/>
            <rect x="14" y="14" width="8" height="6" rx="1" fill="#f97316"/>
            <rect x="15" y="15.5" width="2.5" height="1" rx="0.5" fill="#fdba74"/>
            <rect x="15" y="17.5" width="2.5" height="1" rx="0.5" fill="#fdba74"/>
            <rect x="18.5" y="15.5" width="2.5" height="1" rx="0.5" fill="#fdba74"/>
            <rect x="18.5" y="17.5" width="2.5" height="1" rx="0.5" fill="#fdba74"/>
          </svg>
        </div>`,
        iconSize: [27, 27],
        iconAnchor: [13, 13],
      });
      const deviceList = (noc.devices || []).map((d: any) => `<div style="font-size:11px">${d.name} <span style="color:${d.status === "reachable" ? "#22c55e" : "#ef4444"}">${d.status}</span></div>`).join("");
      L.marker([noc.lat, noc.lng], { icon })
        .bindTooltip(`<b>${noc.name}</b><br>${noc.address || ""}<br>${noc.device_count || 0} device(s)<br>${deviceList}`, { sticky: true })
        .addTo(layer);
    }

    for (const pop of (nocPopData.pops || [])) {
      if (!pop.lat || !pop.lng) continue;
      const icon = L.divIcon({
        className: "",
        html: `<div style="position:relative;width:27px;height:27px">
          <svg viewBox="0 0 36 36" width="27" height="27" fill="none">
            <circle cx="18" cy="18" r="16" fill="#7c3aed" stroke="#ddd6fe" stroke-width="1.5"/>
            <circle cx="18" cy="18" r="10" fill="#6d28d9" stroke="#a78bfa" stroke-width="1"/>
            <circle cx="18" cy="18" r="4" fill="#c4b5fd" stroke="#fff" stroke-width="1"/>
            <line x1="18" y1="2" x2="18" y2="8" stroke="#a78bfa" stroke-width="2" stroke-linecap="round"/>
            <line x1="18" y1="28" x2="18" y2="34" stroke="#a78bfa" stroke-width="2" stroke-linecap="round"/>
            <line x1="2" y1="18" x2="8" y2="18" stroke="#a78bfa" stroke-width="2" stroke-linecap="round"/>
            <line x1="28" y1="18" x2="34" y2="18" stroke="#a78bfa" stroke-width="2" stroke-linecap="round"/>
            <line x1="6.7" y1="6.7" x2="11" y2="11" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="25" y1="25" x2="29.3" y2="29.3" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="29.3" y1="6.7" x2="25" y2="11" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round"/>
            <line x1="11" y1="25" x2="6.7" y2="29.3" stroke="#a78bfa" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </div>`,
        iconSize: [27, 27],
        iconAnchor: [13, 13],
      });
      const deviceList = (pop.devices || []).map((d: any) => `<div style="font-size:11px">${d.name} <span style="color:${d.status === "reachable" ? "#22c55e" : "#ef4444"}">${d.status}</span></div>`).join("");
      L.marker([pop.lat, pop.lng], { icon })
        .bindTooltip(`<b>${pop.name}</b><br>${pop.address || ""}<br>${pop.device_count || 0} device(s)<br>${deviceList}`, { sticky: true })
        .addTo(layer);
    }

    layer.addTo(map);
  }, [nocPopData]);

  return (
    <div className="relative h-full">
      <div ref={setMapEl} className="w-full h-full" style={{ minHeight: isFullscreen ? "100%" : "400px" }} />
      <button
        onClick={onToggleFullscreen}
        className="absolute bottom-4 right-4 z-[999] flex items-center gap-1.5 rounded-lg bg-slate-800/80 px-3 py-2 text-xs font-medium text-white shadow-lg backdrop-blur-sm transition hover:bg-slate-700"
        title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
      >
        {isFullscreen ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 3H5a2 2 0 00-2 2v3m20 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>
        )}
        {isFullscreen ? "Exit" : "Fullscreen"}
      </button>
    </div>
  );
}
