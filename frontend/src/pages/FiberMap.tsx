import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";
import ActionResultBanner from "../components/ActionResultBanner";
import PhotoGallery from "../components/PhotoGallery";
import { api } from "../api/client";
import { Cable, TjBox, Splitter, FiberLoop, CableCut, Splice, TJ_PHOTO_TYPES, TJ_PHOTO_LABELS, MapPoint, MapPointResponse, CutRecoveryResult, canWrite } from "../api/types";
import SubscriberLink from "../components/SubscriberLink";
import StatusBadge from "../components/StatusBadge";
import { fmtTimeShort } from "../lib/time";

interface TempSegment {
  start_lat: number; start_lng: number; end_lat: number; end_lng: number; order_index: number;
}
import { useUserRole } from "../lib/role";

const STATUS_COLOR: Record<string, string> = {
  pppoe: "#22c55e", up: "#22c55e", power_off: "#f97316", wire_down: "#ef4444",
  inactive: "#f97316", offline: "#f97316", unknown: "#6b7280", lost: "#a855f7",
  llid_admin_down: "#3b82f6",
};

const CORE_COLORS: Record<number, string> = {
  1: "#3b82f6", 2: "#f97316", 4: "#22c55e", 6: "#92400e",
  8: "#ef4444", 12: "#8b5cf6",
};

const TJ_CAPACITY_COLORS: Record<number, string> = {
  2: "#a855f7", 4: "#6366f1", 8: "#0ea5e9", 10: "#14b8a6", 12: "#22c55e",
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

const CITY_LAT = 22.700673;
const CITY_LNG = 90.354323;
const CITY_CENTER = { lat: CITY_LAT, lng: CITY_LNG };

function TjSearchSelect({ label, tjBoxes, value, onChange, excludeId }: {
  label: string; tjBoxes: TjBox[]; value: number | null; onChange: (id: number | null) => void; excludeId?: number | null;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = tjBoxes.find((t) => t.id === value);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  const q = query.toLowerCase();
  const filtered = tjBoxes
    .filter((t) => t.id !== excludeId)
    .filter((t) => !q || t.unique_id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || (t.address || "").toLowerCase().includes(q))
    .slice(0, 20);
  return (
    <div ref={ref} className="relative">
      <label className="label">{label}</label>
      {selected && !open ? (
        <div className="input flex items-center justify-between">
          <span className="text-xs">{selected.unique_id} — {selected.name}</span>
          <button type="button" className="text-slate-400 hover:text-slate-600 ml-1" onClick={() => { onChange(null); setQuery(""); }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
        </div>
      ) : (
        <input className="input text-xs" placeholder="Search TJ ID / Name / Address..." value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      )}
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full max-h-[200px] overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg">
          {filtered.map((t) => (
            <button key={t.id} type="button" className="w-full text-left px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-700 border-b border-slate-100 dark:border-slate-700 last:border-0" onClick={() => { onChange(t.id); setQuery(""); setOpen(false); }}>
              <span className="font-semibold">{t.unique_id}</span> — {t.name}
              {t.address && <span className="text-slate-400 ml-1">({t.address})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FiberMap() {
  const { role } = useUserRole();
  const writeOk = canWrite(role);

  const [cables, setCables] = useState<Cable[]>([]);
  const [tjBoxes, setTjBoxes] = useState<TjBox[]>([]);
  const [splitters, setSplitters] = useState<Splitter[]>([]);
  const [loops, setLoops] = useState<FiberLoop[]>([]);
  const [cuts, setCuts] = useState<CableCut[]>([]);
  const [splices, setSplices] = useState<Splice[]>([]);
  const [nocPopData, setNocPopData] = useState<{ nocs: any[]; pops: any[] }>({ nocs: [], pops: [] });
  const [error, setError] = useState("");

  const [filterType, setFilterType] = useState<string>("all");
  const [filterText, setFilterText] = useState("");
  const [filterCore, setFilterCore] = useState<string>("all");
  const [filterPort, setFilterPort] = useState<string>("all");
  const [filterRatio, setFilterRatio] = useState<string>("all");
  const [showForm, setShowForm] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [baseMap, setBaseMap] = useState<"street" | "satellite" | "terrain" | "hybrid">("street");
  const [netLayers, setNetLayers] = useState({ olt: true, pop: true, tjBox: true, splitter: true, customer: true, fiberCable: true, cableRoute: true });

  const [cableForm, setCableForm] = useState<Partial<Cable>>({});
  const [tjForm, setTjForm] = useState<Partial<TjBox>>({});
  const [splitterForm, setSplitterForm] = useState<Partial<Splitter>>({});

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editKind, setEditKind] = useState<string>("");

  type HighlightedType = "cable" | "tj" | "splitter" | "user";
  type HighlightedObject = { type: HighlightedType; id: number | string } | null;
  const [highlightedObject, setHighlightedObject] = useState<HighlightedObject>(null);

  type PlanPhase = "idle" | "select-src" | "select-dst" | "fetching" | "select-route" | "draw" | "confirm" | "custom-draw";
  const [planner, setPlanner] = useState<{ phase: PlanPhase; srcTj: TjBox | null; dstTj: TjBox | null; waypoints: L.LatLng[] }>({ phase: "idle", srcTj: null, dstTj: null, waypoints: [] });
  const [routeAlts, setRouteAlts] = useState<{ coords: [number, number][]; distance: number; duration: number }[]>([]);
  const [customWaypoints, setCustomWaypoints] = useState<L.LatLng[]>([]);
  const [routing, setRouting] = useState(false);

  const calcWaypointDistKm = useCallback((wp: L.LatLng[]): number => { let d = 0; for (let i = 0; i < wp.length - 1; i++) d += haversine(wp[i].lat, wp[i].lng, wp[i + 1].lat, wp[i + 1].lng); return d / 1000; }, []);
  const fetchOsrmAlts = useCallback(async (src: TjBox, dst: TjBox) => {
    setRouting(true); setPlanner((p) => ({ ...p, phase: "fetching" as PlanPhase }));
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${src.lng},${src.lat};${dst.lng},${dst.lat}?overview=full&geometries=geojson&alternatives=3`;
      const res = await fetch(url); const data = await res.json();
      if (data.code !== "Ok" || !data.routes?.length) { setError("No route found between these TJs."); setPlanner((p) => ({ ...p, phase: "select-dst" as PlanPhase })); return; }
      const alts = data.routes.map((r: any) => ({ coords: r.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]), distance: r.distance, duration: r.duration }));
      setRouteAlts(alts);
      setPlanner((p) => ({ ...p, phase: "select-route" as PlanPhase }));
    } catch (e) { setError("Routing failed: " + String(e)); setPlanner((p) => ({ ...p, phase: "select-dst" as PlanPhase })); }
    finally { setRouting(false); }
  }, []);
  const selectRoute = useCallback((idx: number) => {
    const alt = routeAlts[idx]; if (!alt) return;
    const waypoints = alt.coords.map((c) => L.latLng(c[0], c[1]));
    setPlanner((p) => ({ ...p, phase: "draw" as PlanPhase, waypoints }));
    setRouteAlts([]);
  }, [routeAlts]);
  const addWaypoint = useCallback((lat: number, lng: number) => {
    setPlanner((p) => { if (p.phase !== "draw" || p.waypoints.length < 2) return p;
      const pt = L.latLng(lat, lng); let best = 0, bestD = Infinity;
      for (let i = 0; i < p.waypoints.length - 1; i++) { const d = pt.distanceTo(L.latLng((p.waypoints[i].lat + p.waypoints[i + 1].lat) / 2, (p.waypoints[i].lng + p.waypoints[i + 1].lng) / 2)); if (d < bestD) { bestD = d; best = i; } }
      const wp = [...p.waypoints]; wp.splice(best + 1, 0, pt); return { ...p, waypoints: wp };
    });
  }, []);
  const removeWaypoint = useCallback((idx: number) => {
    setPlanner((p) => { if (p.phase !== "draw" || p.waypoints.length <= 2) return p; const wp = [...p.waypoints]; wp.splice(idx, 1); return { ...p, waypoints: wp }; });
  }, []);
  const updateWaypoint = useCallback((idx: number, lat: number, lng: number) => {
    setPlanner((p) => { if (p.phase !== "draw" || idx < 0 || idx >= p.waypoints.length) return p; const wp = [...p.waypoints]; wp[idx] = L.latLng(lat, lng); return { ...p, waypoints: wp }; });
  }, []);
  const confirmRoute = useCallback(() => {
    setPlanner((p) => { if (!p.srcTj || !p.dstTj || p.waypoints.length < 2) return p;
      const segments: TempSegment[] = p.waypoints.map((ll, i) => { const next = p.waypoints[i + 1]; return next ? { start_lat: ll.lat, start_lng: ll.lng, end_lat: next.lat, end_lng: next.lng, order_index: i } : null; }).filter(Boolean) as TempSegment[];
      const code = (p.srcTj as TjBox).unique_id + ">" + (p.dstTj as TjBox).unique_id;
      setCableForm({
        code, cable_type: "round", core_count: 12, route_type: "driving",
        src_tj_id: (p.srcTj as TjBox).id, dst_tj_id: (p.dstTj as TjBox).id,
        manufacturer: "PLANNED", manufacturing_year: new Date().getFullYear(),
        segments: segments as any[],
      });
      setShowForm("cable");
      return { phase: "idle" as PlanPhase, srcTj: null, dstTj: null, waypoints: [] };
    });
  }, []);
  const cancelPlan = useCallback(() => {
    setPlanner((p) => {
      if (p.phase === "custom-draw") return { ...p, phase: "select-route" as PlanPhase };
      return { phase: "idle", srcTj: null, dstTj: null, waypoints: [] };
    });
    if (planner.phase !== "custom-draw") setRouteAlts([]);
    setCustomWaypoints([]);
  }, [planner.phase]);

  const startCustomDraw = useCallback(() => {
    setPlanner((p) => ({ ...p, phase: "custom-draw" as PlanPhase }));
  }, []);
  const addCustomWaypoint = useCallback((lat: number, lng: number) => {
    setCustomWaypoints((wp) => {
      if (wp.length === 0) return [L.latLng(lat, lng)];
      const pt = L.latLng(lat, lng); let best = 0, bestD = Infinity;
      for (let i = 0; i < wp.length - 1; i++) { const d = pt.distanceTo(L.latLng((wp[i].lat + wp[i + 1].lat) / 2, (wp[i].lng + wp[i + 1].lng) / 2)); if (d < bestD) { bestD = d; best = i; } }
      const newWp = [...wp]; newWp.splice(best + 1, 0, pt); return newWp;
    });
  }, []);
  const removeCustomWaypoint = useCallback((idx: number) => {
    setCustomWaypoints((wp) => { if (wp.length <= 1) return wp; const n = [...wp]; n.splice(idx, 1); return n; });
  }, []);
  const updateCustomWaypoint = useCallback((idx: number, lat: number, lng: number) => {
    setCustomWaypoints((wp) => { if (idx < 0 || idx >= wp.length) return wp; const n = [...wp]; n[idx] = L.latLng(lat, lng); return n; });
  }, []);
  const undoCustomWaypoint = useCallback(() => {
    setCustomWaypoints((wp) => wp.length > 0 ? wp.slice(0, -1) : wp);
  }, []);
  const clearCustomWaypoints = useCallback(() => { setCustomWaypoints([]); }, []);
  const confirmCustomRoute = useCallback(() => {
    setPlanner((p) => {
      if (!p.srcTj || !p.dstTj || customWaypoints.length < 1) return p;
      const allWp = [L.latLng(p.srcTj.lat, p.srcTj.lng), ...customWaypoints, L.latLng(p.dstTj.lat, p.dstTj.lng)];
      return { ...p, phase: "draw" as PlanPhase, waypoints: allWp };
    });
    setCustomWaypoints([]);
  }, [customWaypoints]);

  const startDrawCable = useCallback((tj: TjBox) => {
    setDrawCable({ active: true, sourceTj: tj, routePoints: [L.latLng(tj.lat, tj.lng)], mousePos: null });
  }, []);
  const setDrawMousePos = useCallback((lat: number, lng: number) => {
    setDrawCable((d) => {
      if (!d.active) return d;
      return { ...d, mousePos: L.latLng(lat, lng) };
    });
  }, []);
  const confirmDrawWaypoint = useCallback(() => {
    setDrawCable((d) => {
      if (!d.active || !d.mousePos) return d;
      return { ...d, routePoints: [...d.routePoints, d.mousePos], mousePos: null };
    });
  }, []);
  const undoDrawWaypoint = useCallback(() => {
    setDrawCable((d) => {
      if (!d.active || d.routePoints.length <= 1) return d;
      const pts = [...d.routePoints];
      pts.pop();
      return { ...d, routePoints: pts };
    });
  }, []);
  const finishDrawCable = useCallback((dstTj: TjBox) => {
    setDrawCable((d) => {
      if (!d.active || !d.sourceTj) return d;
      const allPoints = [...d.routePoints, L.latLng(dstTj.lat, dstTj.lng)];
      const segments: TempSegment[] = allPoints.map((ll, i) => { const next = allPoints[i + 1]; return next ? { start_lat: ll.lat, start_lng: ll.lng, end_lat: next.lat, end_lng: next.lng, order_index: i } : null; }).filter(Boolean) as TempSegment[];
      const code = d.sourceTj.unique_id + ">" + dstTj.unique_id;
      setCableForm({
        code, cable_type: "round", core_count: 12, route_type: "driving",
        src_tj_id: d.sourceTj.id, dst_tj_id: dstTj.id,
        manufacturer: "PLANNED", manufacturing_year: new Date().getFullYear(),
        segments: segments as any[],
      });
      setShowForm("cable");
      return { active: false, sourceTj: null, routePoints: [], mousePos: null };
    });
  }, []);
  const cancelDrawCable = useCallback(() => {
    setDrawCable({ active: false, sourceTj: null, routePoints: [], mousePos: null });
  }, []);

  const [dragTj, setDragTj] = useState<{ active: boolean; tj: TjBox | null; marker: L.Marker | null }>({ active: false, tj: null, marker: null });

  const startDragTj = useCallback((tj: TjBox, marker: L.Marker) => {
    setDragTj({ active: true, tj, marker });
    marker.dragging?.enable();
  }, []);

  const saveDragTj = useCallback(async () => {
    if (!dragTj.tj || !dragTj.marker) return;
    const pos = dragTj.marker.getLatLng();
    try {
      await api.put(`/fiber/tj-boxes/${dragTj.tj.id}/move`, { lat: pos.lat, lng: pos.lng });
      dragTj.marker.dragging?.disable();
      setDragTj({ active: false, tj: null, marker: null });
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to move TJ");
    }
  }, [dragTj]);

  const cancelDragTj = useCallback(() => {
    if (dragTj.marker && dragTj.tj) {
      dragTj.marker.setLatLng([dragTj.tj.lat, dragTj.tj.lng]);
      dragTj.marker.dragging?.disable();
    }
    setDragTj({ active: false, tj: null, marker: null });
  }, [dragTj]);

  const [selectedTj, setSelectedTj] = useState<TjBox | null>(null);
  const [selectedCable, setSelectedCable] = useState<Cable | null>(null);
  const [cableEdit, setCableEdit] = useState<{
    cableId: number;
    waypoints: L.LatLng[];
    originalWaypoints: L.LatLng[];
    cable: Cable;
  } | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<number | null>(null);
  const [drawCable, setDrawCable] = useState<{ active: boolean; sourceTj: TjBox | null; routePoints: L.LatLng[]; mousePos: L.LatLng | null }>({ active: false, sourceTj: null, routePoints: [], mousePos: null });
  const [loopForm, setLoopForm] = useState<Partial<FiberLoop>>({});
  const [cutForm, setCutForm] = useState<Partial<CableCut>>({});
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<"links" | "tj" | "splitters" | "users">("links");
  const [searchCables, setSearchCables] = useState("");
  const [searchTj, setSearchTj] = useState("");
  const [searchSp, setSearchSp] = useState("");
  const [searchCuts, setSearchCuts] = useState("");

  // User Map state
  const [mapPoints, setMapPoints] = useState<MapPoint[]>([]);
  const [filterUserStatus, setFilterUserStatus] = useState("all");
  const [filterUserText, setFilterUserText] = useState("");
  const [selectedUser, setSelectedUser] = useState<MapPoint | null>(null);
  const [userSidebarSearch, setUserSidebarSearch] = useState("");
  const [gpsForm, setGpsForm] = useState<{ lat: number; lng: number } | null>(null);

  // Cut Recovery state
  const [recoveryCut, setRecoveryCut] = useState<CableCut | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<CutRecoveryResult | null>(null);
  const [recovering, setRecovering] = useState(false);

  const [feasCheckOpen, setFeasCheckOpen] = useState(false);
  const [feasLat, setFeasLat] = useState("");
  const [feasLng, setFeasLng] = useState("");
  const [feasResults, setFeasResults] = useState<{ tj: TjBox; distanceM: number; destinations: string[] }[]>([]);
  const [feasChecked, setFeasChecked] = useState(false);

  const mapRef = useRef<L.Map | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, t, s, l, ct, sp, np, mp] = await Promise.all([
        api.get<Cable[]>("/fiber/cables"),
        api.get<TjBox[]>("/fiber/tj-boxes"),
        api.get<Splitter[]>("/fiber/splitters"),
        api.get<FiberLoop[]>("/fiber/loops"),
        api.get<CableCut[]>("/fiber/cuts"),
        api.get<any[]>("/fiber/splices"),
        api.get<{ nocs: any[]; pops: any[] }>("/fiber/noc-pop-map"),
        api.get<MapPointResponse>("/map/points"),
      ]);
      setCables(c);
      setTjBoxes(t);
      setSplitters(s);
      setLoops(l);
      setCuts(ct);
      setSplices(sp);
      setNocPopData(np);
      setMapPoints(mp.points || []);
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

  // User Map computed values
  const filteredUsers = useMemo(() => {
    let pts = mapPoints;
    if (filterUserStatus !== "all") {
      pts = pts.filter((p) => {
        if (filterUserStatus === "online") return p.status === "pppoe" || p.status === "up";
        if (filterUserStatus === "offline") return p.status === "power_off" || p.status === "inactive" || p.status === "offline";
        if (filterUserStatus === "wire_down") return p.status === "wire_down";
        if (filterUserStatus === "unknown") return p.status === "unknown";
        if (filterUserStatus === "lost") return p.status === "lost";
        if (filterUserStatus === "llid_admin_down") return p.status === "llid_admin_down";
        return true;
      });
    }
    if (filterUserText) {
      const q = filterUserText.toLowerCase();
      pts = pts.filter((p) =>
        (p.name || "").toLowerCase().includes(q)
        || (p.subscriber || "").toLowerCase().includes(q)
        || (p.serial || "").toLowerCase().includes(q)
      );
    }
    return pts;
  }, [mapPoints, filterUserStatus, filterUserText]);

  const highlightObject = useCallback((type: HighlightedType, id: number | string) => {
    setHighlightedObject({ type, id });
    if (type === "cable") {
      const c = cables.find((x) => x.id === id);
      if (c && c.segments.length > 0) {
        const mid = c.segments[Math.floor(c.segments.length / 2)];
        mapRef.current?.setView([mid.start_lat, mid.start_lng], 16, { animate: true });
      }
    } else if (type === "tj") {
      const t = tjBoxes.find((x) => x.id === id);
      if (t) mapRef.current?.setView([t.lat, t.lng], 16, { animate: true });
    } else if (type === "splitter") {
      const s = splitters.find((x) => x.id === id);
      if (s) mapRef.current?.setView([s.lat, s.lng], 17, { animate: true });
    } else if (type === "user") {
      const p = filteredUsers.find((x) => `${x.olt_id}-${x.onu_id}` === id);
      if (p && p.gps_lat && p.gps_lng) mapRef.current?.setView([p.gps_lat, p.gps_lng], 17, { animate: true });
    }
  }, [cables, tjBoxes, splitters, filteredUsers, mapRef]);

  const sidebarUsers = useMemo(() => {
    if (!userSidebarSearch) return filteredUsers;
    const q = userSidebarSearch.toLowerCase();
    return filteredUsers.filter((p) =>
      (p.name || "").toLowerCase().includes(q)
      || (p.subscriber || "").toLowerCase().includes(q)
      || (p.serial || "").toLowerCase().includes(q)
      || (p.pon_port || "").toLowerCase().includes(q)
      || (p.address || "").toLowerCase().includes(q)
    );
  }, [filteredUsers, userSidebarSearch]);

  const userStatusSummary = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of mapPoints) c[p.status] = (c[p.status] || 0) + 1;
    return c;
  }, [mapPoints]);

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

  const startCableEdit = useCallback((cable: Cable) => {
    if (!cable.segments?.length) return;
    const wps: L.LatLng[] = cable.segments.map((s) => L.latLng(s.start_lat, s.start_lng));
    const last = cable.segments[cable.segments.length - 1];
    wps.push(L.latLng(last.end_lat, last.end_lng));
    setSelectedCable(null);
    setSelectedWaypoint(null);
    setCableEdit({
      cableId: cable.id,
      waypoints: wps,
      originalWaypoints: wps.map((wp) => L.latLng(wp.lat, wp.lng)),
      cable,
    });
  }, []);

  const saveCableEdit = useCallback(async () => {
    if (!cableEdit) return;
    if (cableEdit.waypoints.length < 2) { setError("Need at least 2 points to form a cable path."); return; }
    const segments = cableEdit.waypoints.map((wp, i) => {
      const next = cableEdit.waypoints[i + 1];
      return next ? { start_lat: wp.lat, start_lng: wp.lng, end_lat: next.lat, end_lng: next.lng, order_index: i } : null;
    }).filter(Boolean);
    try {
      await api.put(`/fiber/cables/${cableEdit.cableId}`, { segments });
      setCableEdit(null);
      setSelectedWaypoint(null);
      await load();
    } catch (e) { setError(String(e)); }
  }, [cableEdit, load]);

  const cancelCableEdit = useCallback(() => { setCableEdit(null); setSelectedWaypoint(null); }, []);

  const addEditWaypoint = useCallback((lat: number, lng: number) => {
    setSelectedWaypoint(null);
    setCableEdit((prev) => {
      if (!prev || prev.waypoints.length < 2) return prev;
      const pt = L.latLng(lat, lng);
      let best = 0, bestD = Infinity;
      for (let i = 0; i < prev.waypoints.length - 1; i++) {
        const mid = L.latLng((prev.waypoints[i].lat + prev.waypoints[i + 1].lat) / 2, (prev.waypoints[i].lng + prev.waypoints[i + 1].lng) / 2);
        const d = pt.distanceTo(mid);
        if (d < bestD) { bestD = d; best = i; }
      }
      const wp = [...prev.waypoints];
      wp.splice(best + 1, 0, pt);
      return { ...prev, waypoints: wp };
    });
  }, []);

  const removeEditWaypoint = useCallback((idx: number) => {
    setSelectedWaypoint(null);
    setCableEdit((prev) => {
      if (!prev || prev.waypoints.length <= 2) return prev;
      const wp = [...prev.waypoints];
      wp.splice(idx, 1);
      return { ...prev, waypoints: wp };
    });
  }, []);

  const updateEditWaypoint = useCallback((idx: number, lat: number, lng: number) => {
    setCableEdit((prev) => {
      if (!prev || idx < 0 || idx >= prev.waypoints.length) return prev;
      const wp = [...prev.waypoints];
      wp[idx] = L.latLng(lat, lng);
      return { ...prev, waypoints: wp };
    });
  }, []);

  const selectEditWaypoint = useCallback((idx: number | null) => {
    setSelectedWaypoint(idx);
  }, []);

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
      const result = await api.post<CutRecoveryResult>(`/fiber/cuts/${cutId}/recover`, {});
      setRecoveryResult(result);
      await load();
    } catch (e) { setError(String(e)); }
  };

  const startRecovery = (cut: CableCut) => {
    setRecoveryCut(cut);
    setRecoveryResult(null);
  };

  const confirmRecovery = async () => {
    if (!recoveryCut) return;
    setRecovering(true);
    try {
      const result = await api.post<CutRecoveryResult>(`/fiber/cuts/${recoveryCut.id}/recover`, {});
      setRecoveryResult(result);
      setRecoveryCut(null);
      await load();
    } catch (e) { setError(String(e)); }
    finally { setRecovering(false); }
  };

  const deleteCut = async (id: number) => { if (!confirm("Delete cut record?")) return; try { await api.del(`/fiber/cuts/${id}`); await load(); } catch (e) { setError(String(e)); } };

  const handleRightClickAdd = (kind: string, lat: number, lng: number) => {
    if (kind === "feas") { setFeasLat(String(lat)); setFeasLng(String(lng)); setFeasCheckOpen(true); setFeasChecked(false); setFeasResults([]); }
    else if (kind === "tj") { setTjForm({ name: "", box_type: "regular_tj", tj_port: 4, capacity: 4, tray_count: 1, lat, lng }); setShowForm("tj"); }
    else if (kind === "splitter") { setSplitterForm({ name: "", split_ratio: 2, lat, lng }); setShowForm("splitter"); }
    else if (kind === "cable") { setCableForm({ code: "", cable_type: "round", core_count: 12, segments: [] }); setShowForm("cable"); }
    else if (kind === "loop") { setLoopForm({ lat, lng, loop_length_m: 30 }); setShowForm("loop"); }
    else if (kind === "cut") { setCutForm({ lat, lng }); setShowForm("cut"); }
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
      const distanceM = haversine(lat, lng, tj.lat, tj.lng);
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
      return { tj, distanceM, destinations };
    });
    results.sort((a, b) => a.distanceM - b.distanceM);
    setFeasResults(results.slice(0, 3));
    setFeasChecked(true);
  };

  return (
    <div className={isFullscreen ? "fixed inset-0 z-[9998] bg-white dark:bg-slate-900 flex flex-col" : "flex flex-col relative"} style={{ zIndex: 1, height: isFullscreen ? "100vh" : "calc(100vh - 4rem)" }}>
      {/* Network Map Ribbon — above the map */}
      {!isFullscreen && (
        <div className="shrink-0 flex flex-wrap items-center gap-1.5 rounded-b-xl border border-slate-200 border-t-0 bg-white/95 px-3 py-2 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 z-[1000]">
          <h1 className="text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap mr-1">Network Map</h1>
          <select className="input w-24 text-xs py-1" value={filterType} onChange={(e) => { setFilterType(e.target.value); setFilterCore("all"); setFilterPort("all"); setFilterRatio("all"); }}>
            <option value="customer">Customer</option><option value="all">All</option><option value="cable">Links</option><option value="tj">TJ Boxes</option><option value="splitter">Splitters</option>
          </select>
          <select className="input w-24 text-xs py-1" value={filterUserStatus} onChange={(e) => setFilterUserStatus(e.target.value)}>
            <option value="all">All User Status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="wire_down">Wire Down</option>
            <option value="unknown">Unknown</option>
            <option value="lost">Lost</option>
            <option value="llid_admin_down">LLID Admin Down</option>
          </select>
          {(filterType === "all" || filterType === "cable") && (
            <select className="input w-20 text-xs py-1" value={filterCore} onChange={(e) => setFilterCore(e.target.value)}>
              <option value="all">All cores</option>
              {Object.keys(CORE_COLORS).map((k) => <option key={k} value={k}>{k} core</option>)}
            </select>
          )}
          {(filterType === "all" || filterType === "tj") && (
            <select className="input w-20 text-xs py-1" value={filterPort} onChange={(e) => setFilterPort(e.target.value)}>
              <option value="all">All ports</option>
              {Object.keys(TJ_CAPACITY_COLORS).map((k) => <option key={k} value={k}>{k} port</option>)}
            </select>
          )}
          {(filterType === "all" || filterType === "splitter") && (
            <select className="input w-20 text-xs py-1" value={filterRatio} onChange={(e) => setFilterRatio(e.target.value)}>
              <option value="all">All ratios</option>
              {Object.keys(SPLITTER_RATIO_COLORS).map((k) => <option key={k} value={k}>1:{k}</option>)}
            </select>
          )}
          <input className="input w-32 text-xs py-1" placeholder="Search..." value={filterText} onChange={(e) => setFilterText(e.target.value)} />
          <div className="h-5 w-px bg-slate-200 dark:bg-slate-700" />
          {writeOk && (
            <>
              <button className="text-xs py-1 px-2 rounded-md transition font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50" onClick={() => { setShowForm("cable"); setEditingId(null); setCableForm({ cable_type: "round", core_count: 12, route_type: "driving", src_tj_id: null, dst_tj_id: null }); }}>+ Link</button>
              <button className="text-xs py-1 px-2 rounded-md transition font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50" onClick={() => { setShowForm("tj"); setEditingId(null); setTjForm({ box_type: "regular_tj", tj_port: 4, capacity: 4, tray_count: 1 }); }}>+ TJ</button>
              <button className="text-xs py-1 px-2 rounded-md transition font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50" onClick={() => { setFeasCheckOpen(true); setFeasChecked(false); setFeasResults([]); setFeasLat(""); setFeasLng(""); }}>Feasibility</button>
              <button className={`text-xs py-1 px-2 rounded-md transition font-medium ${planner.phase !== "idle" ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"}`} onClick={() => setPlanner({ phase: "select-src", srcTj: null, dstTj: null, waypoints: [] })}>
                {planner.phase !== "idle" ? "Planning..." : "Plan Link"}
              </button>
            </>
          )}
        </div>
      )}

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
            planner={planner}
            routeAlts={routeAlts}
            routing={routing}
            isFullscreen={isFullscreen}
            baseMap={baseMap}
            netLayers={netLayers}
            onSetBaseMap={setBaseMap}
            onSetNetLayers={setNetLayers}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            onTjClick={(tj) => {
              if (drawCable.active) {
                if (drawCable.sourceTj && tj.id === drawCable.sourceTj.id) return;
                finishDrawCable(tj);
              } else if (planner.phase === "select-src") {
                setPlanner({ ...planner, srcTj: tj, phase: "select-dst" });
              } else if (planner.phase === "select-dst") {
                setPlanner({ ...planner, dstTj: tj });
                fetchOsrmAlts(planner.srcTj!, tj);
              } else if (planner.phase !== "draw" && planner.phase !== "fetching") {
                setSelectedTj(tj);
                highlightObject("tj", tj.id);
              }
            }}
            onDrawCreated={handleDrawCreated}
            onRightClickAdd={handleRightClickAdd}
            onCableSegmentUpdate={handleCableSegmentUpdate}
            onCableClick={(cable) => { setSelectedCable(cable); highlightObject("cable", cable.id); }}
            onLoopClick={(loop) => { setLoopForm(loop); setShowForm("loop"); }}
            onCutClick={(cut) => { setCutForm(cut); setShowForm("cut"); }}
            editingCableId={cableEdit?.cableId ?? null}
            cableEditWaypoints={cableEdit?.waypoints ?? null}
            onStartCableEdit={startCableEdit}
            onSaveCableEdit={saveCableEdit}
            onCancelCableEdit={cancelCableEdit}
            onAddEditWaypoint={addEditWaypoint}
            onRemoveEditWaypoint={removeEditWaypoint}
            onUpdateEditWaypoint={updateEditWaypoint}
            selectedWaypoint={selectedWaypoint}
            onSelectEditWaypoint={selectEditWaypoint}
            onMapClick={(lat, lng) => {
              setSelectedWaypoint(null);
              setHighlightedObject(null);
              if (drawCable.active) {
                confirmDrawWaypoint();
              } else if (cableEdit) addEditWaypoint(lat, lng);
              else if (planner.phase === "custom-draw") addCustomWaypoint(lat, lng);
              else if (planner.phase === "draw") addWaypoint(lat, lng);
            }}
            onSelectRoute={selectRoute}
            onAddWaypoint={addWaypoint}
            onRemoveWaypoint={removeWaypoint}
            onUpdateWaypoint={updateWaypoint}
            onStartPlan={() => setPlanner({ phase: "select-src", srcTj: null, dstTj: null, waypoints: [] })}
            onConfirmRoute={confirmRoute}
            onCancelPlan={cancelPlan}
            customWaypoints={customWaypoints}
            onStartCustomDraw={startCustomDraw}
            onRemoveCustomWaypoint={removeCustomWaypoint}
            onUpdateCustomWaypoint={updateCustomWaypoint}
            onUndoCustomWaypoint={undoCustomWaypoint}
            onClearCustomWaypoints={clearCustomWaypoints}
            onConfirmCustomRoute={confirmCustomRoute}
            calcDistKm={calcWaypointDistKm}
            drawCable={drawCable}
            onStartDrawCable={startDrawCable}
            onSetDrawMousePos={setDrawMousePos}
            onConfirmDrawWaypoint={confirmDrawWaypoint}
            onUndoDrawWaypoint={undoDrawWaypoint}
            onCancelDrawCable={cancelDrawCable}
            onStartDragTj={startDragTj}
            dragTj={dragTj}
            onSaveDragTj={saveDragTj}
            onCancelDragTj={cancelDragTj}
            userPoints={filteredUsers}
            selectedUser={selectedUser}
            onUserSelect={(p) => { setSelectedUser(p); if (p) highlightObject("user", `${p.olt_id}-${p.onu_id}`); }}
            showUserLayer={netLayers.customer}
            highlightedObject={highlightedObject}
          />
        </div>

        {/* Right sidebar */}
        {rightPanelOpen && (
        <div className="w-[320px] shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col">
          {/* Tab bar */}
          <div className="flex border-b border-slate-200 dark:border-slate-700 shrink-0">
            {([
              { key: "links" as const, label: "Links", count: filteredCables.length },
              { key: "tj" as const, label: "TJ Boxes", count: filteredTj.length },
              { key: "splitters" as const, label: "Splitters", count: filteredSplitters.length },
              { key: "users" as const, label: "Users", count: filteredUsers.length },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-2 py-2 text-[11px] font-medium transition-colors ${
                  activeTab === tab.key
                    ? "border-b-2 border-brand-600 text-brand-600 dark:border-brand-400 dark:text-brand-400"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-3">
            {activeTab === "links" && (
              <div>
                <input className="input text-xs w-full mb-2 py-1" placeholder="Search links..." value={searchCables} onChange={(e) => setSearchCables(e.target.value)} />
                <div className="space-y-1">
                  {filteredCables.filter((c) => !searchCables || c.code.toLowerCase().includes(searchCables.toLowerCase()) || c.link_name.toLowerCase().includes(searchCables.toLowerCase())).map((c) => {
                    const lenM = cableLengthM(c);
                    return (
                      <div key={c.id} className={`rounded-md border p-2 cursor-pointer transition ${highlightedObject?.type === "cable" && highlightedObject?.id === c.id ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30" : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"}`} onClick={() => { setSelectedCable(c); highlightObject("cable", c.id); }}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-900 dark:text-white truncate">{c.link_id || "?"} | {c.link_name || c.code}</span>
                          <span className="badge text-[10px] ml-1 shrink-0" style={{ background: CORE_COLORS[c.core_count] || "#6b7280", color: "white" }}>{c.core_count}C</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{c.manufacturer || "?"} | {c.code} · {(lenM / 1000).toFixed(2)} km · +10%: {Math.round(lenM * 1.10).toLocaleString()} m</div>
                        {writeOk && <div className="flex gap-1 mt-1"><button className="btn-ghost text-[10px] py-0" onClick={(e) => { e.stopPropagation(); startEdit("cable", c); }}>Edit</button><button className="btn-ghost text-[10px] py-0 text-red-600" onClick={(e) => { e.stopPropagation(); deleteItem("cable", c.id); }}>Del</button></div>}
                      </div>
                    );
                  })}
                </div>

                {cuts.filter((c) => c.status === "cut").length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                    <div className="text-[10px] font-semibold text-red-600 dark:text-red-400 mb-1">Active Cuts ({cuts.filter((c) => c.status === "cut").length})</div>
                    <input className="input text-xs w-full mb-2 py-1" placeholder="Search cuts..." value={searchCuts} onChange={(e) => setSearchCuts(e.target.value)} />
                    <div className="space-y-1">
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
                            {writeOk && <div className="flex gap-1 mt-1"><button className="btn-ghost text-[10px] py-0 text-green-600" onClick={(e) => { e.stopPropagation(); startRecovery(c); }}>Recover</button></div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === "tj" && (
              <div>
                <input className="input text-xs w-full mb-2 py-1" placeholder="Search TJs..." value={searchTj} onChange={(e) => setSearchTj(e.target.value)} />
                <div className="space-y-1">
                  {filteredTj.filter((t) => !searchTj || t.name.toLowerCase().includes(searchTj.toLowerCase()) || t.unique_id.toLowerCase().includes(searchTj.toLowerCase())).map((t) => (
                    <div key={t.id} className={`rounded-md border p-2 cursor-pointer transition ${highlightedObject?.type === "tj" && highlightedObject?.id === t.id ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30" : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"}`} onClick={() => { setSelectedTj(t); highlightObject("tj", t.id); }}>
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

            {activeTab === "splitters" && (
              <div>
                <input className="input text-xs w-full mb-2 py-1" placeholder="Search splitters..." value={searchSp} onChange={(e) => setSearchSp(e.target.value)} />
                <div className="space-y-1">
                  {filteredSplitters.filter((s) => !searchSp || (s.name || "").toLowerCase().includes(searchSp.toLowerCase()) || s.unique_id.toLowerCase().includes(searchSp.toLowerCase())).map((s) => {
                    const loss = splitterLoss(s.split_ratio);
                    return (
                      <div key={s.id} className={`rounded-md border p-2 cursor-pointer transition ${highlightedObject?.type === "splitter" && highlightedObject?.id === s.id ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30" : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"}`} onClick={() => { startEdit("splitter", s); highlightObject("splitter", s.id); }}>
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

            {activeTab === "users" && (
              <div className="flex flex-col h-full">
                {/* Status summary */}
                <div className="flex gap-2 px-1 py-1.5 text-[10px] font-medium border-b border-slate-200 dark:border-slate-700 shrink-0">
                  <span className="flex items-center gap-1 cursor-pointer" onClick={() => setFilterUserStatus("all")}>
                    <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />All {mapPoints.length}
                  </span>
                  <span className="flex items-center gap-1 cursor-pointer" onClick={() => setFilterUserStatus("online")}>
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" />{userStatusSummary["pppoe"] || 0}
                  </span>
                  <span className="flex items-center gap-1 cursor-pointer" onClick={() => setFilterUserStatus("offline")}>
                    <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />{userStatusSummary["power_off"] || 0}
                  </span>
                  <span className="flex items-center gap-1 cursor-pointer" onClick={() => setFilterUserStatus("wire_down")}>
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500" />{userStatusSummary["wire_down"] || 0}
                  </span>
                  <span className="flex items-center gap-1 cursor-pointer" onClick={() => setFilterUserStatus("unknown")}>
                    <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />{userStatusSummary["unknown"] || 0}
                  </span>
                  <span className="flex items-center gap-1 cursor-pointer" onClick={() => setFilterUserStatus("lost")}>
                    <span className="inline-block w-2 h-2 rounded-full bg-purple-500" />{userStatusSummary["lost"] || 0}
                  </span>
                </div>
                {/* Search */}
                <div className="px-2 pt-2 shrink-0">
                  <input className="input text-xs w-full py-1" placeholder="Search users..." value={userSidebarSearch} onChange={(e) => setUserSidebarSearch(e.target.value)} />
                </div>
                {/* User list */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {sidebarUsers.map((p) => (
                    <div key={`${p.olt_id}-${p.onu_id}`} className={`rounded-md border p-2 cursor-pointer transition ${highlightedObject?.type === "user" && highlightedObject?.id === `${p.olt_id}-${p.onu_id}` ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30" : selectedUser?.onu_id === p.onu_id && selectedUser?.olt_id === p.olt_id ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30" : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50"}`} onClick={() => { setSelectedUser(p); highlightObject("user", `${p.olt_id}-${p.onu_id}`); }}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium truncate max-w-[140px]">{p.name || "—"}</span>
                        <StatusBadge status={p.status} />
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5 truncate">{p.subscriber || "—"} · {p.serial || "—"}</div>
                      <div className="text-[10px] text-slate-400 truncate">{p.pon_port || "—"}</div>
                    </div>
                  ))}
                  {sidebarUsers.length === 0 && <div className="text-xs text-slate-400 text-center py-4">No users found</div>}
                </div>
                {/* Selected user detail */}
                {selectedUser && (
                  <div className="border-t border-slate-200 dark:border-slate-700 p-2 space-y-2 shrink-0">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">{selectedUser.name || "—"}</h4>
                      <StatusBadge status={selectedUser.status} />
                    </div>
                    <SubscriberLink subscriber={selectedUser.subscriber || ""} />
                    <div className="text-[10px] text-slate-500 space-y-0.5">
                      <div><span className="font-medium">Serial:</span> {selectedUser.serial || "—"}</div>
                      <div><span className="font-medium">PON:</span> {selectedUser.pon_port || "—"}</div>
                      <div><span className="font-medium">Address:</span> {selectedUser.address || "—"}</div>
                      <div><span className="font-medium">RX Power:</span> {selectedUser.rx_power != null ? `${selectedUser.rx_power} dBm` : "—"}</div>
                      <div><span className="font-medium">Last Seen:</span> {fmtTimeShort(selectedUser.last_seen)}</div>
                    </div>
                    <div className="flex gap-1">
                      <button className="btn-secondary text-[10px] py-0.5 px-1.5 flex-1" onClick={() => setGpsForm({ lat: selectedUser.gps_lat, lng: selectedUser.gps_lng })}>Edit GPS</button>
                      <button className="btn-secondary text-[10px] py-0.5 px-1.5 flex-1" onClick={() => { /* TODO: edit address */ }}>Edit Address</button>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
        )}

        {/* Collapse/expand right panel toggle */}
        <button
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          className="self-center z-[1001] flex h-10 w-5 -ml-px shrink-0 items-center justify-center rounded-l-md border border-r-0 border-slate-300 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
          title={rightPanelOpen ? "Collapse panel" : "Expand panel"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${rightPanelOpen ? "" : "rotate-180"}`}>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {error && <ActionResultBanner ok={false} message={error} onDismiss={() => setError("")} className="shrink-0" />}

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
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
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
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">Straight Distance</div><div className="text-lg font-bold">{straightM > 0 ? (straightM / 1000).toFixed(2) + " km" : "—"}</div></div>
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">Link Length</div><div className="text-lg font-bold">{(lenM / 1000).toFixed(2)} km</div></div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-lg bg-cyan-50 dark:bg-cyan-900/20 p-3"><div className="text-xs text-cyan-600">Loop Slack</div><div className="text-lg font-bold text-cyan-700">{totalLoopM > 0 ? totalLoopM + "m (" + loopSum.length + " loops)" : "None"}</div></div>
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3"><div className="text-xs text-amber-600">Total Length</div><div className="text-lg font-bold text-amber-700">{(totalM / 1000).toFixed(2)} km</div></div>
                    </div>
                    {lenM > 0 && (
                      <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
                        <div className="text-xs text-slate-400 mb-2">Link Requirement (with allowance)</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div className="text-slate-500">Actual:</div><div className="font-mono font-semibold">{Math.round(lenM).toLocaleString()} m</div>
                          <div className="text-slate-500">+5%:</div><div className="font-mono">{Math.round(lenM * 1.05).toLocaleString()} m</div>
                          <div className="text-slate-500">+10%:</div><div className="font-mono">{Math.round(lenM * 1.10).toLocaleString()} m</div>
                          <div className="text-slate-500">+15%:</div><div className="font-mono">{Math.round(lenM * 1.15).toLocaleString()} m</div>
                          <div className="text-slate-500">+20%:</div><div className="font-mono">{Math.round(lenM * 1.20).toLocaleString()} m</div>
                        </div>
                      </div>
                    )}
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
                <button className="btn-primary text-xs" onClick={() => startCableEdit(selectedCable)}>Edit Path</button>
                <button className="btn-secondary text-xs" onClick={() => { setSelectedCable(null); startEdit("cable", selectedCable); }}>Edit Info</button>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedUser && !showForm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSelectedUser(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white truncate">{selectedUser.name || "—"}</h2>
                <p className="text-sm text-slate-500">{selectedUser.subscriber || "—"}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={selectedUser.status} />
                <button onClick={() => setSelectedUser(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <SubscriberLink subscriber={selectedUser.subscriber || ""} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">Serial</div><div className="font-mono font-semibold">{selectedUser.serial || "—"}</div></div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">PON Port</div><div className="font-mono font-semibold">{selectedUser.pon_port || "—"}</div></div>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
                <div className="text-xs text-slate-400">Address</div>
                <div className="font-semibold">{selectedUser.address || "—"}</div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">RX Power</div><div className="font-semibold">{selectedUser.rx_power != null ? `${selectedUser.rx_power} dBm` : "—"}</div></div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">Last Seen</div><div className="font-semibold">{fmtTimeShort(selectedUser.last_seen)}</div></div>
              </div>
              {selectedUser.down_reason && (
                <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3"><div className="text-xs text-red-600">Down Reason</div><div className="font-semibold text-red-700">{selectedUser.down_reason}</div></div>
              )}
              <div className="text-xs text-slate-400">
                GPS: {selectedUser.gps_lat?.toFixed(6) || "—"}, {selectedUser.gps_lng?.toFixed(6) || "—"}
              </div>
            </div>
          </div>
        </div>
      )}

      {showForm === "cable" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowForm(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{editingId ? "Edit" : "Add"} Link</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className="label">Link ID</label><input className="input bg-slate-100 dark:bg-slate-800" value={cableForm.link_id || ""} readOnly placeholder="Auto-generated" /></div>
                <div><label className="label">Link Name</label><input className="input" value={cableForm.link_name || ""} onChange={(e) => setCableForm({ ...cableForm, link_name: e.target.value })} placeholder="e.g. Barishal Main Trunk" /></div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TjSearchSelect label="Source TJ" tjBoxes={tjBoxes} value={cableForm.src_tj_id || null} onChange={(id) => setCableForm({ ...cableForm, src_tj_id: id })} excludeId={cableForm.dst_tj_id || null} />
                <TjSearchSelect label="Destination TJ" tjBoxes={tjBoxes} value={cableForm.dst_tj_id || null} onChange={(id) => setCableForm({ ...cableForm, dst_tj_id: id })} excludeId={cableForm.src_tj_id || null} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className="label">Manufacturer *</label><input className="input" value={cableForm.manufacturer || ""} onChange={(e) => setCableForm({ ...cableForm, manufacturer: e.target.value })} required /></div>
                <div><label className="label">Cable Code *</label><input className="input" value={cableForm.code || ""} onChange={(e) => setCableForm({ ...cableForm, code: e.target.value })} placeholder="e.g. FOC-001" required /></div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className="label">Type</label><select className="input" value={cableForm.cable_type || "round"} onChange={(e) => setCableForm({ ...cableForm, cable_type: e.target.value })}>
                  <option value="round">Round Fiber</option><option value="figure8">Figure 8 Messenger</option>
                </select></div>
                <div><label className="label">Core Count</label><select className="input" value={cableForm.core_count || 12} onChange={(e) => setCableForm({ ...cableForm, core_count: Number(e.target.value) })}>
                  {[2, 4, 8, 12, 24, 36, 48, 144].map((n) => <option key={n} value={n}>{n} cores</option>)}
                </select></div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className="label">Route Type</label><select className="input" value={cableForm.route_type || "driving"} onChange={(e) => setCableForm({ ...cableForm, route_type: e.target.value })}>
                  <option value="driving">Driving Route</option><option value="foot">Walking Route</option>
                </select></div>
                <div><label className="label">Year *</label><input type="number" className="input" value={cableForm.manufacturing_year || ""} onChange={(e) => setCableForm({ ...cableForm, manufacturing_year: Number(e.target.value) })} required /></div>
              </div>
              <div><label className="label">Notes</label><textarea className="input" rows={2} value={cableForm.notes || ""} onChange={(e) => setCableForm({ ...cableForm, notes: e.target.value })} /></div>
              <div className="text-xs text-slate-500">Segments: {cableForm.segments?.length || 0} points</div>
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
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{editingId ? "Edit" : "Add"} TJ / Enclosure</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className="label">TJ ID</label><input className="input bg-slate-100 dark:bg-slate-800" value={tjForm.unique_id || ""} readOnly placeholder="Auto-generated" /></div>
                <div><label className="label">TJ Name</label><input className="input" value={tjForm.name || ""} onChange={(e) => setTjForm({ ...tjForm, name: e.target.value })} required /></div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className="label">TJ Type</label><select className="input" value={tjForm.box_type || "regular_tj"} onChange={(e) => {
                  const box_type = e.target.value;
                  const isLarge = box_type === "enclosure" || box_type === "dome";
                  setTjForm({ ...tjForm, box_type, tray_count: isLarge ? 1 : undefined, capacity: isLarge ? 12 : undefined });
                }}>
                  <option value="home_tj">Home TJ</option><option value="regular_tj">Regular TJ</option><option value="enclosure">Enclosure</option><option value="dome">Dome / Bamboo</option>
                </select></div>
                <div><label className="label">TJ Port</label><select className="input" value={tjForm.tj_port || 4} onChange={(e) => setTjForm({ ...tjForm, tj_port: Number(e.target.value) })}>
                  {[2, 4, 8, 10, 12].map((n) => <option key={n} value={n}>{n} ports</option>)}
                </select></div>
              </div>
              {(tjForm.box_type === "enclosure" || tjForm.box_type === "dome") && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div><label className="label">Tray Count</label><select className="input" value={tjForm.tray_count || 1} onChange={(e) => setTjForm({ ...tjForm, tray_count: Number(e.target.value) })}>
                    {[1, 2, 4, 8, 12].map((n) => <option key={n} value={n}>{n} trays</option>)}
                  </select></div>
                  <div><label className="label">Splice Capacity</label><select className="input" value={tjForm.capacity || 4} onChange={(e) => setTjForm({ ...tjForm, capacity: Number(e.target.value) })}>
                    {[2, 4, 8, 10, 12, 24, 48, 96, 144].map((n) => <option key={n} value={n}>{n} cores</option>)}
                  </select></div>
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className="label">Name</label><input className="input" value={splitterForm.name || ""} onChange={(e) => setSplitterForm({ ...splitterForm, name: e.target.value })} /></div>
                <div><label className="label">Split Ratio</label><select className="input" value={splitterForm.split_ratio || 2} onChange={(e) => setSplitterForm({ ...splitterForm, split_ratio: Number(e.target.value) })}>
                  {[2, 4, 8, 16, 32, 64].map((n) => <option key={n} value={n}>1:{n}</option>)}
                </select></div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div><label className="label">Link</label><select className="input" value={loopForm.cable_id || ""} onChange={(e) => setLoopForm({ ...loopForm, cable_id: Number(e.target.value) })}>
                <option value="">Select Link</option>
                {cables.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.core_count}C</option>)}
              </select></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div><label className="label">Link</label><select className="input" value={cutForm.cable_id || ""} onChange={(e) => setCutForm({ ...cutForm, cable_id: Number(e.target.value) })}>
                <option value="">Select Link</option>
                {cables.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.core_count}C</option>)}
              </select></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                {cutForm.id && cutForm.status !== "repaired" && <button className="btn-primary bg-green-600 hover:bg-green-700" onClick={() => { setShowForm(null); startRecovery(cutForm as CableCut); }}>Recover Cut</button>}
                {cutForm.id && <button className="btn-danger" onClick={() => { deleteCut(cutForm.id!); setShowForm(null); }}>Delete</button>}
                <button className="btn-secondary" onClick={() => setShowForm(null)}>Cancel</button>
                <button className="btn-primary" onClick={saveCut}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cut Recovery Confirmation Modal */}
      {recoveryCut && !recoveryResult && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setRecoveryCut(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Cut Recovery</h2>
              <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={() => setRecoveryCut(null)}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            {(() => {
              const cable = cables.find((c) => c.id === recoveryCut.cable_id);
              const coreCount = cable?.core_count || 0;
              const tjCapacity = coreCount <= 4 ? 4 : coreCount <= 8 ? 8 : coreCount <= 10 ? 10 : 0;
              const CORE_COLOR_NAMES = ["Blue", "Orange", "Green", "Brown", "Slate", "White", "Red", "Black", "Yellow", "Violet", "Rose", "Aqua"];
              return (
                <div className="space-y-4">
                  <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
                    <div className="text-sm font-medium text-green-800 dark:text-green-300">Auto-Recovery Plan</div>
                    <div className="text-xs text-green-700 dark:text-green-400 mt-1">System will create a new TJ and automatically splice all cores by color.</div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">New TJ Box</div>
                    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2 text-xs space-y-1">
                      <div><span className="font-medium">Capacity:</span> {tjCapacity || "Exceeds max"} Port {tjCapacity ? `(${tjCapacity <= 4 ? "4-port" : tjCapacity <= 8 ? "8-port" : "10-port"})` : ""}</div>
                      <div><span className="font-medium">Location:</span> {recoveryCut.lat.toFixed(6)}, {recoveryCut.lng.toFixed(6)}</div>
                      {tjCapacity === 0 && <div className="text-red-600 dark:text-red-400 font-medium">Core count {coreCount} exceeds maximum supported TJ capacity (10). Manual recovery required.</div>}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Connected Cable</div>
                    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2 text-xs">
                      <div className="font-mono font-semibold">{cable?.code || "?"}</div>
                      <div className="text-slate-500">{coreCount} cores · {cable?.cable_type || "—"}</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Automatic Splicing ({coreCount} cores)</div>
                    <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2 max-h-32 overflow-y-auto space-y-0.5">
                      {Array.from({ length: coreCount }, (_, i) => {
                        const color = CORE_COLOR_NAMES[i % CORE_COLOR_NAMES.length];
                        return (
                          <div key={i} className="flex items-center gap-2 text-xs">
                            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: `var(--core-${color.toLowerCase()})`, border: color === "White" ? "1px solid #ccc" : undefined }} />
                            <span className="text-green-600 dark:text-green-400">Core {i + 1}: {color} → {color}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button className="btn-secondary" onClick={() => setRecoveryCut(null)}>Cancel</button>
                    <button className="btn-primary bg-green-600 hover:bg-green-700" disabled={recovering || tjCapacity === 0} onClick={confirmRecovery}>
                      {recovering ? "Recovering..." : "Confirm Recovery"}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Cut Recovery Result Modal */}
      {recoveryResult && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setRecoveryResult(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Recovery Completed</h2>
              <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={() => setRecoveryResult(null)}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
                <div className="text-sm font-medium text-green-800 dark:text-green-300">Cut Recovery Successful</div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">New TJ Created</div>
                <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2 text-xs space-y-1">
                  <div><span className="font-medium">ID:</span> <span className="font-mono">{recoveryResult.tj_unique_id}</span></div>
                  <div><span className="font-medium">Name:</span> {recoveryResult.tj_name}</div>
                  <div><span className="font-medium">Capacity:</span> {recoveryResult.tj_capacity} Port</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Connected</div>
                <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2 text-xs">
                  <div className="font-mono font-semibold">{recoveryResult.cable_code}</div>
                  <div className="text-slate-500">{recoveryResult.core_count} cores → {recoveryResult.tj_unique_id}</div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Splices Created: {recoveryResult.splices_created}</div>
                <div className="rounded-md border border-slate-200 dark:border-slate-700 p-2 max-h-32 overflow-y-auto space-y-0.5">
                  {recoveryResult.splices.map((s) => (
                    <div key={s.core_index} className="flex items-center gap-2 text-xs">
                      <span className="text-green-600 dark:text-green-400">Core {s.core_index}: {s.color} → {s.color}</span>
                    </div>
                  ))}
                </div>
              </div>

              {recoveryResult.unmatched_cores.length > 0 && (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3">
                  <div className="text-xs font-medium text-amber-800 dark:text-amber-300">Unmatched Cores: {recoveryResult.unmatched_cores.join(", ")}</div>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button className="btn-primary" onClick={() => setRecoveryResult(null)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GPS Edit Modal */}
      {gpsForm && selectedUser && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setGpsForm(null)}>
          <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Edit GPS — {selectedUser.name}</h2>
              <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" onClick={() => setGpsForm(null)}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Latitude</label>
                <input type="number" step="any" className="input w-full text-sm" value={gpsForm.lat} onChange={(e) => setGpsForm({ ...gpsForm, lat: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Longitude</label>
                <input type="number" step="any" className="input w-full text-sm" value={gpsForm.lng} onChange={(e) => setGpsForm({ ...gpsForm, lng: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary flex-1" onClick={() => setGpsForm(null)}>Cancel</button>
                <button className="btn-primary flex-1" onClick={async () => {
                  if (!selectedUser || !gpsForm) return;
                  try {
                    await api.put(`/onus/${selectedUser.onu_id}`, { gps_lat: gpsForm.lat, gps_lng: gpsForm.lng });
                    setSelectedUser({ ...selectedUser, gps_lat: gpsForm.lat, gps_lng: gpsForm.lng });
                    setGpsForm(null);
                    load();
                  } catch (err) { setError(String(err)); }
                }}>Save</button>
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
                          <th className="text-right py-2 text-slate-600 dark:text-slate-400">Link Required</th>
                          <th className="text-left py-2 text-slate-600 dark:text-slate-400">Destinations</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feasResults.map((r, i) => {
                          const distM = Math.round(r.distanceM);
                          return (
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
                            <td className="py-2 text-right font-mono text-slate-700 dark:text-slate-300">{(r.distanceM / 1000).toFixed(2)} km</td>
                            <td className="py-2 text-right">
                              <div className="font-mono text-slate-700 dark:text-slate-300">{distM.toLocaleString()} m</div>
                              <div className="text-[10px] text-slate-400 mt-0.5 space-x-2">
                                <span>+5%: {Math.round(distM * 1.05).toLocaleString()} m</span>
                                <span>+10%: {Math.round(distM * 1.10).toLocaleString()} m</span>
                                <span>+15%: {Math.round(distM * 1.15).toLocaleString()} m</span>
                                <span>+20%: {Math.round(distM * 1.20).toLocaleString()} m</span>
                              </div>
                            </td>
                            <td className="py-2 text-slate-600 dark:text-slate-400">
                              {r.destinations.length > 0 ? r.destinations.join(", ") : <span className="italic text-slate-400">No links</span>}
                            </td>
                          </tr>
                          );
                        })}
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
          <button className="btn-secondary text-[10px] py-1 px-2" onClick={() => { setTjEditForm({ name: tj.name || "", address: tj.address || "", notes: tj.notes || "" }); setShowTjEdit(true); }}>Edit</button>
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
              // Group splices by tray_id
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
                        {/* Left side */}
                        <div className="flex items-center gap-1">
                          {sp.cable_a_id ? <CoreColorDot coreIndex={sp.core_a} size={8} /> : <span className="w-2 h-2 rounded-full bg-amber-400" />}
                          <span className="font-mono font-bold">{leftLabel}</span>
                          {ca?.manufacturer && <span className="text-[9px] text-slate-400">{ca.manufacturer}</span>}
                        </div>
                        <span className="text-slate-400">↔</span>
                        {/* Right side */}
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
              {/* Endpoint A */}
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

              {/* Endpoint B */}
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

              {/* Tray & Status */}
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

function FiberMapView({ cables, tjBoxes, splitters, loops, cuts, nocPopData, center, mapRef, planner, routeAlts, routing, isFullscreen, baseMap, netLayers, onSetBaseMap, onSetNetLayers, onToggleFullscreen, onTjClick, onDrawCreated, onRightClickAdd, onCableSegmentUpdate, onCableClick, onLoopClick, onCutClick, editingCableId, cableEditWaypoints, onStartCableEdit, onSaveCableEdit, onCancelCableEdit, onAddEditWaypoint, onRemoveEditWaypoint, onUpdateEditWaypoint, selectedWaypoint, onSelectEditWaypoint, onMapClick, onSelectRoute, onAddWaypoint, onRemoveWaypoint, onUpdateWaypoint, onStartPlan, onConfirmRoute, onCancelPlan, customWaypoints, onStartCustomDraw, onRemoveCustomWaypoint, onUpdateCustomWaypoint, onUndoCustomWaypoint, onClearCustomWaypoints, onConfirmCustomRoute, calcDistKm, drawCable, onStartDrawCable, onSetDrawMousePos, onConfirmDrawWaypoint, onUndoDrawWaypoint, onCancelDrawCable, onStartDragTj, dragTj, onSaveDragTj, onCancelDragTj, userPoints, selectedUser, onUserSelect, showUserLayer, highlightedObject }: {
  cables: Cable[]; tjBoxes: TjBox[]; splitters: Splitter[]; loops: FiberLoop[]; cuts: CableCut[];
  nocPopData: { nocs: any[]; pops: any[] };
  center: { lat: number; lng: number };
  mapRef: React.MutableRefObject<L.Map | null>;
  planner: { phase: string; srcTj: TjBox | null; dstTj: TjBox | null; waypoints: L.LatLng[] };
  routeAlts: { coords: [number, number][]; distance: number; duration: number }[];
  routing: boolean;
  isFullscreen: boolean;
  baseMap: "street" | "satellite" | "terrain" | "hybrid";
  netLayers: { olt: boolean; pop: boolean; tjBox: boolean; splitter: boolean; customer: boolean; fiberCable: boolean; cableRoute: boolean };
  onSetBaseMap: (m: "street" | "satellite" | "terrain" | "hybrid") => void;
  onSetNetLayers: (l: { olt: boolean; pop: boolean; tjBox: boolean; splitter: boolean; customer: boolean; fiberCable: boolean; cableRoute: boolean }) => void;
  onToggleFullscreen: () => void;
  onTjClick: (tj: TjBox) => void;
  onDrawCreated: (e: any) => void;
  onRightClickAdd: (kind: string, lat: number, lng: number) => void;
  onCableSegmentUpdate: (cableId: number, segments: { id?: number; start_lat: number; start_lng: number; end_lat: number; end_lng: number; order_index: number }[]) => void;
  onCableClick: (cable: Cable) => void;
  onLoopClick: (loop: FiberLoop) => void;
  onCutClick: (cut: CableCut) => void;
  editingCableId: number | null;
  cableEditWaypoints: L.LatLng[] | null;
  onStartCableEdit: (cable: Cable) => void;
  onSaveCableEdit: () => void;
  onCancelCableEdit: () => void;
  onAddEditWaypoint: (lat: number, lng: number) => void;
  onRemoveEditWaypoint: (idx: number) => void;
  onUpdateEditWaypoint: (idx: number, lat: number, lng: number) => void;
  selectedWaypoint: number | null;
  onSelectEditWaypoint: (idx: number | null) => void;
  onMapClick: (lat: number, lng: number) => void;
  onSelectRoute: (idx: number) => void;
  onAddWaypoint: (lat: number, lng: number) => void;
  onRemoveWaypoint: (idx: number) => void;
  onUpdateWaypoint: (idx: number, lat: number, lng: number) => void;
  onStartPlan: () => void;
  onConfirmRoute: () => void;
  onCancelPlan: () => void;
  customWaypoints: L.LatLng[];
  onStartCustomDraw: () => void;
  onRemoveCustomWaypoint: (idx: number) => void;
  onUpdateCustomWaypoint: (idx: number, lat: number, lng: number) => void;
  onUndoCustomWaypoint: () => void;
  onClearCustomWaypoints: () => void;
  onConfirmCustomRoute: () => void;
  calcDistKm: (wp: L.LatLng[]) => number;
  drawCable: { active: boolean; sourceTj: TjBox | null; routePoints: L.LatLng[]; mousePos: L.LatLng | null };
  onStartDrawCable: (tj: TjBox) => void;
  onSetDrawMousePos: (lat: number, lng: number) => void;
  onConfirmDrawWaypoint: () => void;
  onUndoDrawWaypoint: () => void;
  onCancelDrawCable: () => void;
  onStartDragTj: (tj: TjBox, marker: L.Marker) => void;
  dragTj: { active: boolean; tj: TjBox | null; marker: L.Marker | null };
  onSaveDragTj: () => void;
  onCancelDragTj: () => void;
  userPoints: MapPoint[];
  selectedUser: MapPoint | null;
  onUserSelect: (p: MapPoint | null) => void;
  showUserLayer: boolean;
  highlightedObject: { type: "cable" | "tj" | "splitter" | "user"; id: number | string } | null;
}) {
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const drawControlRef = useRef<L.Control.Draw | null>(null);
  const drawFeatureGroupRef = useRef<L.FeatureGroup>(new L.FeatureGroup());
  const routeMarkersRef = useRef<L.Marker[]>([]);
  const nocPopLayerRef = useRef<L.LayerGroup | null>(null);
  const cableLayersRef = useRef<Map<number, L.Polyline>>(new Map());
  const userLayerRef = useRef<L.LayerGroup | null>(null);
  const highlightLayerRef = useRef<L.Layer | null>(null);
  const onRightClickRef = useRef(onRightClickAdd);
  onRightClickRef.current = onRightClickAdd;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const onRemoveEditWaypointRef = useRef(onRemoveEditWaypoint);
  onRemoveEditWaypointRef.current = onRemoveEditWaypoint;
  const onUpdateEditWaypointRef = useRef(onUpdateEditWaypoint);
  onUpdateEditWaypointRef.current = onUpdateEditWaypoint;
  const onStartCableEditRef = useRef(onStartCableEdit);
  onStartCableEditRef.current = onStartCableEdit;
  const onSelectEditWaypointRef = useRef(onSelectEditWaypoint);
  onSelectEditWaypointRef.current = onSelectEditWaypoint;
  const tileLayersRef = useRef<Record<string, L.TileLayer>>({});
  const activeTileRef = useRef<L.TileLayer | null>(null);
  const customLayersRef = useRef<L.Layer[]>([]);
  const onRemoveCustomWaypointRef = useRef(onRemoveCustomWaypoint);
  onRemoveCustomWaypointRef.current = onRemoveCustomWaypoint;
  const onUpdateCustomWaypointRef = useRef(onUpdateCustomWaypoint);
  onUpdateCustomWaypointRef.current = onUpdateCustomWaypoint;
  const onStartDrawCableRef = useRef(onStartDrawCable);
  onStartDrawCableRef.current = onStartDrawCable;
  const onSetDrawMousePosRef = useRef(onSetDrawMousePos);
  onSetDrawMousePosRef.current = onSetDrawMousePos;
  const onUndoDrawWaypointRef = useRef(onUndoDrawWaypoint);
  onUndoDrawWaypointRef.current = onUndoDrawWaypoint;
  const drawCableRef = useRef(drawCable);
  drawCableRef.current = drawCable;
  const onUserSelectRef = useRef(onUserSelect);
  onUserSelectRef.current = onUserSelect;

  useEffect(() => {
    if (!mapEl || mapRef.current) return;
    const map = L.map(mapEl, { zoomControl: false }).setView([center.lat, center.lng], 12);

    L.control.zoom({ position: "bottomleft" }).addTo(map);

    const tiles: Record<string, L.TileLayer> = {
      street: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap", maxZoom: 19 }),
      satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "&copy; Esri", maxZoom: 18 }),
      terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenTopoMap", maxZoom: 17 }),
      hybrid: L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap + Esri", maxZoom: 19 }),
    };
    tiles.street.addTo(map);
    tileLayersRef.current = tiles;
    activeTileRef.current = tiles.street;

    const drawControl = new L.Control.Draw({
      position: "bottomleft",
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
        + '<div class="ctx-i" data-kind="feas" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>Feasibility Check</div>'
        + '<div style="height:1px;background:#334155;margin:4px 0"></div>'
        + '<div class="ctx-i" data-kind="tj" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>Add TJ Box</div>'
        + '<div class="ctx-i" data-kind="cable" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M4 12h16M12 4v16"/></svg>Add Link</div>'
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

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (onMapClickRef.current) onMapClickRef.current(e.latlng.lat, e.latlng.lng);
    });

    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      if (drawCableRef.current.active) {
        onSetDrawMousePosRef.current(e.latlng.lat, e.latlng.lng);
      }
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, [mapEl, center]);

  const onTjClickRef = useRef(onTjClick);
  onTjClickRef.current = onTjClick;

  useEffect(() => {
    if (!drawCable.active) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onUndoDrawWaypointRef.current(); } };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [drawCable.active]);

  useEffect(() => {
    const map = mapRef.current;
    const tiles = tileLayersRef.current;
    if (!map || !tiles[baseMap]) return;
    if (activeTileRef.current === tiles[baseMap]) return;
    if (activeTileRef.current) map.removeLayer(activeTileRef.current);
    tiles[baseMap].addTo(map);
    activeTileRef.current = tiles[baseMap];
  }, [baseMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    routeMarkersRef.current.forEach((m) => map.removeLayer(m));
    routeMarkersRef.current = [];
    if (planner.srcTj && planner.phase !== "idle") {
      const m = L.marker([planner.srcTj.lat, planner.srcTj.lng], { icon: tjIcon("#22c55e"), interactive: planner.phase === "select-dst" }).bindTooltip("SRC: " + planner.srcTj.unique_id, { permanent: true, className: "" }).addTo(map);
      routeMarkersRef.current.push(m);
    }
    if (planner.dstTj && planner.phase !== "idle") {
      const m = L.marker([planner.dstTj.lat, planner.dstTj.lng], { icon: tjIcon("#3b82f6"), interactive: false }).bindTooltip("DST: " + planner.dstTj.unique_id, { permanent: true, className: "" }).addTo(map);
      routeMarkersRef.current.push(m);
    }
    if (planner.phase === "draw" && planner.waypoints.length >= 2) {
      const pts: [number, number][] = planner.waypoints.map((ll) => [ll.lat, ll.lng]);
      const pl = L.polyline(pts, { color: "#ef4444", weight: 4, opacity: 0.85, dashArray: "8,4" }).addTo(map);
      routeMarkersRef.current.push(pl as any);
      const wpIcon = L.divIcon({ className: "", html: '<div style="width:12px;height:12px;background:#ef4444;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
      planner.waypoints.forEach((ll, i) => {
        const marker = L.marker([ll.lat, ll.lng], { icon: wpIcon, draggable: true }).addTo(map);
        marker.bindTooltip(`WP${i + 1}<br>double-click to remove`, { direction: "top" });
        marker.on("dragend", (e) => { const pos = e.target.getLatLng(); onUpdateWaypoint(i, pos.lat, pos.lng); });
        marker.on("dblclick", (e) => { L.DomEvent.stopPropagation(e); onRemoveWaypoint(i); });
        routeMarkersRef.current.push(marker);
      });
    }
  }, [planner.phase, planner.srcTj?.id, planner.dstTj?.id, planner.waypoints, onRemoveWaypoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    customLayersRef.current.forEach((l) => { if (map.hasLayer(l)) map.removeLayer(l); });
    customLayersRef.current = [];
    if (planner.phase !== "custom-draw" || !planner.srcTj || !planner.dstTj) return;
    const allWp = [L.latLng(planner.srcTj.lat, planner.srcTj.lng), ...customWaypoints, L.latLng(planner.dstTj.lat, planner.dstTj.lng)];
    if (allWp.length >= 2) {
      const pts: [number, number][] = allWp.map((ll) => [ll.lat, ll.lng]);
      const pl = L.polyline(pts, { color: "#f59e0b", weight: 4, opacity: 0.85, dashArray: "8,4" }).addTo(map);
      customLayersRef.current.push(pl);
      const srcIcon = L.divIcon({ className: "", html: '<div style="width:12px;height:12px;background:#22c55e;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
      const dstIcon = L.divIcon({ className: "", html: '<div style="width:12px;height:12px;background:#3b82f6;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
      const srcM = L.marker([planner.srcTj.lat, planner.srcTj.lng], { icon: srcIcon }).addTo(map);
      srcM.bindTooltip("Source: " + planner.srcTj.unique_id, { direction: "top" });
      customLayersRef.current.push(srcM);
      const dstM = L.marker([planner.dstTj.lat, planner.dstTj.lng], { icon: dstIcon }).addTo(map);
      dstM.bindTooltip("Dest: " + planner.dstTj.unique_id, { direction: "top" });
      customLayersRef.current.push(dstM);
      const wpIcon = L.divIcon({ className: "", html: '<div style="width:12px;height:12px;background:#f59e0b;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
      customWaypoints.forEach((ll, i) => {
        const marker = L.marker([ll.lat, ll.lng], { icon: wpIcon, draggable: true }).addTo(map);
        marker.bindTooltip(`WP${i + 1}<br>double-click to remove`, { direction: "top" });
        marker.on("dragend", (e) => { const pos = e.target.getLatLng(); onUpdateCustomWaypointRef.current(i, pos.lat, pos.lng); });
        marker.on("dblclick", (e) => { L.DomEvent.stopPropagation(e); onRemoveCustomWaypointRef.current(i); });
        customLayersRef.current.push(marker);
      });
    }
  }, [planner.phase, planner.srcTj?.id, planner.dstTj?.id, customWaypoints]);

  const drawCableLayersRef = useRef<L.Layer[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    drawCableLayersRef.current.forEach((l) => { if (map.hasLayer(l)) map.removeLayer(l); });
    drawCableLayersRef.current = [];
    if (!drawCable.active || drawCable.routePoints.length < 1) return;
    const allPts = drawCable.mousePos ? [...drawCable.routePoints, drawCable.mousePos] : drawCable.routePoints;
    const pts: [number, number][] = allPts.map((ll) => [ll.lat, ll.lng]);
    if (pts.length >= 2) {
      const pl = L.polyline(pts, { color: "#22c55e", weight: 4, opacity: 0.85, dashArray: "8,4" }).addTo(map);
      drawCableLayersRef.current.push(pl);
    }
    const srcIcon = L.divIcon({ className: "", html: '<div style="width:14px;height:14px;background:#22c55e;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>', iconSize: [14, 14], iconAnchor: [7, 7] });
    const wpIcon = L.divIcon({ className: "", html: '<div style="width:12px;height:12px;background:#f59e0b;border:2px solid white;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [12, 12], iconAnchor: [6, 6] });
    if (drawCable.sourceTj) {
      const m = L.marker([drawCable.sourceTj.lat, drawCable.sourceTj.lng], { icon: srcIcon, interactive: false })
        .bindTooltip("SRC: " + drawCable.sourceTj.unique_id, { permanent: true, direction: "top", offset: [0, -10] }).addTo(map);
      drawCableLayersRef.current.push(m);
    }
    for (let i = 1; i < drawCable.routePoints.length; i++) {
      const ll = drawCable.routePoints[i];
      const m = L.circleMarker([ll.lat, ll.lng], { radius: 5, color: "#f59e0b", fillColor: "#f59e0b", fillOpacity: 1, weight: 2 }).addTo(map);
      m.bindTooltip("WP" + i, { direction: "top" });
      drawCableLayersRef.current.push(m);
    }
    if (drawCable.mousePos) {
      const m = L.circleMarker([drawCable.mousePos.lat, drawCable.mousePos.lng], { radius: 4, color: "#22c55e", fillColor: "#22c55e", fillOpacity: 0.7, weight: 1, dashArray: "3,3" }).addTo(map);
      m.bindTooltip("Click to place", { direction: "top" });
      drawCableLayersRef.current.push(m);
    }
  }, [drawCable.active, drawCable.routePoints, drawCable.mousePos, drawCable.sourceTj?.id]);

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
    const onCableClickFn = onCableClick;
    const onLoopClickFn = onLoopClick;
    const onCutClickFn = onCutClick;

    if (netLayers.fiberCable) {
    for (const cable of cables) {
      if (!cable.segments?.length) continue;
      if (editingCableId === cable.id) continue;
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
        const tipParts = [cable.link_id ? cable.link_id + " | " + (cable.link_name || cable.code) : "<b>" + cable.code + "</b>", (cable.manufacturer || "?") + " | " + cable.code, cable.core_count + " cores"];
        if (straightM > 0) tipParts.push("Straight: " + (straightM / 1000).toFixed(2) + " km");
        tipParts.push("Link: " + lenKm + " km");
        if (loopSum > 0) tipParts.push("Loop: " + (loopSum / 1000).toFixed(2) + " km");
        tipParts.push("Total: " + (totalM / 1000).toFixed(2) + " km");
        tipParts.push("<i>click for details</i>");

        const pl = L.polyline(points, { color, weight: 2, opacity: 0.85 })
          .bindTooltip(tipParts.join("<br>"), { sticky: true });
        pl.addTo(map);
        cableLayersRef.current.set(cable.id, pl);

        pl.on("dblclick", (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          onStartCableEditRef.current(cable);
        });
        pl.on("click", (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          onCableClickFn(cable);
        });
      }

      for (let si = 0; si < cable.segments.length; si++) {
        const seg = cable.segments[si];
        const isEditing = editingCableId === cable.id;
        const r = isEditing ? 5 : 2;
        const sw = isEditing ? 2 : 1;
        const endMarker = L.circleMarker([seg.end_lat, seg.end_lng], { radius: r, color, fillColor: color, fillOpacity: 1, weight: sw });
        endMarker.on("click", (e) => { L.DomEvent.stopPropagation(e); });
        endMarker.addTo(map);
        if (si === 0) {
          const startMarker = L.circleMarker([seg.start_lat, seg.start_lng], { radius: r, color, fillColor: color, fillOpacity: 1, weight: sw });
          startMarker.on("click", (e) => { L.DomEvent.stopPropagation(e); });
          startMarker.addTo(map);
        }
      }
    }
    }

    if (netLayers.tjBox) {
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
      tip += "<br><i>click for details</i>";

      const marker = L.marker([tj.lat, tj.lng], { icon: markerIcon })
        .bindTooltip(tip, { sticky: true });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onTjClickRef.current(tj);
      });
      marker.on("contextmenu", (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        const map = mapRef.current;
        if (!map) return;
        const old = map.getContainer().querySelector(".ctx-menu");
        if (old) old.remove();
        const pt = map.latLngToContainerPoint(e.latlng);
        const menu = document.createElement("div");
        menu.className = "ctx-menu";
        menu.style.cssText = "position:absolute;z-index:9999;background:#1e293b;border-radius:8px;padding:4px 0;box-shadow:0 4px 16px rgba(0,0,0,.4);min-width:180px;left:" + pt.x + "px;top:" + pt.y + "px;";
        menu.innerHTML = '<div style="padding:6px 12px;color:#94a3b8;font-size:11px;font-weight:600">' + tj.unique_id + " — " + tj.name + "</div>"
          + '<div class="ctx-i" data-action="draw-cable" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><path d="M4 12h16M12 4v16"/></svg>Draw Cable</div>'
          + '<div class="ctx-i" data-action="drag-tj" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M12 2l0 20M2 12l20 0"/></svg>Drag / Move</div>'
          + '<div class="ctx-i" data-action="view-details" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
          + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>View Details</div>';
        map.getContainer().appendChild(menu);
        L.DomEvent.disableClickPropagation(menu);
        menu.querySelector('[data-action="draw-cable"]')?.addEventListener("click", () => {
          onStartDrawCableRef.current(tj);
          menu.remove();
        });
        menu.querySelector('[data-action="drag-tj"]')?.addEventListener("click", () => {
          onStartDragTj(tj, marker);
          menu.remove();
        });
        menu.querySelector('[data-action="view-details"]')?.addEventListener("click", () => {
          onTjClickRef.current(tj);
          menu.remove();
        });
        map.once("click", () => menu.remove());
      });
      marker.addTo(map);
    }
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
  }, [cables, tjBoxes, splitters, loops, cuts, netLayers]);

  // Cable edit overlay: renders editable waypoints and route polyline
  const cableEditLayersRef = useRef<L.Layer[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    cableEditLayersRef.current.forEach((l) => map.removeLayer(l));
    cableEditLayersRef.current = [];
    if (!editingCableId || !cableEditWaypoints || cableEditWaypoints.length < 2) return;

    const pts: [number, number][] = cableEditWaypoints.map((ll) => [ll.lat, ll.lng]);
    const routePl = L.polyline(pts, { color: "#ef4444", weight: 4, opacity: 0.9, dashArray: "8,4" }).addTo(map);
    cableEditLayersRef.current.push(routePl);

    const wpIcon = L.divIcon({
      className: "",
      html: '<div style="width:14px;height:14px;background:#ef4444;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
    const wpSelectedIcon = L.divIcon({
      className: "",
      html: '<div style="width:18px;height:18px;background:#fbbf24;border:3px solid white;border-radius:50%;cursor:grab;box-shadow:0 2px 8px rgba(0,0,0,.6)"></div>',
      iconSize: [18, 18], iconAnchor: [9, 9],
    });
    const endIcon = L.divIcon({
      className: "",
      html: '<div style="width:14px;height:14px;background:#22c55e;border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
    cableEditWaypoints.forEach((ll, i) => {
      const isFirst = i === 0;
      const isLast = i === cableEditWaypoints.length - 1;
      const isSelected = selectedWaypoint === i;
      const icon = isFirst || isLast ? endIcon : isSelected ? wpSelectedIcon : wpIcon;
      const label = isFirst ? "SRC (drag to move)" : isLast ? "DST (drag to move)" : isSelected ? "WP" + (i + 1) + " selected" : "WP" + (i + 1) + " (drag · dbl-click to remove)";
      const marker = L.marker([ll.lat, ll.lng], { icon, draggable: true }).bindTooltip(label, { direction: "top", offset: [0, -8] }).addTo(map);

      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectEditWaypointRef.current(isFirst || isLast ? null : i);
      });
      marker.on("dragend", (e) => {
        const pos = e.target.getLatLng();
        onUpdateEditWaypointRef.current(i, pos.lat, pos.lng);
      });
      marker.on("dblclick", (e) => {
        L.DomEvent.stopPropagation(e);
        if (!isFirst && !isLast) onRemoveEditWaypointRef.current(i);
      });
      cableEditLayersRef.current.push(marker);
    });

    return () => {
      cableEditLayersRef.current.forEach((l) => { if (map.hasLayer(l)) map.removeLayer(l); });
      cableEditLayersRef.current = [];
    };
  }, [editingCableId, cableEditWaypoints, selectedWaypoint]);

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

  useEffect(() => {
    const map = mapRef.current;
    const layer = nocPopLayerRef.current;
    if (!map || !layer) return;
    if (netLayers.pop) { if (!map.hasLayer(layer)) layer.addTo(map); }
    else { if (map.hasLayer(layer)) map.removeLayer(layer); }
  }, [netLayers.pop]);

  // User markers layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (userLayerRef.current) {
      map.removeLayer(userLayerRef.current);
    }

    if (!showUserLayer || userPoints.length === 0) return;

    const layer = L.layerGroup();

    for (const p of userPoints) {
      const color = STATUS_COLOR[p.status] || "#6b7280";
      const isBlinking = p.status === "wire_down" || p.status === "lost" || p.status === "llid_admin_down";
      const blinkStyle = isBlinking ? "animation:blink 1.2s ease-in-out infinite;" : "";
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:14px;height:14px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);${blinkStyle}"></div><style>@keyframes blink{0%,100%{opacity:1}50%{opacity:0.3}}</style>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

      const parts = [
        `<b>${p.subscriber || "—"}</b>`,
        `ONU: ${p.name || "—"}`,
        `Serial: ${p.serial || "—"}`,
        `Status: ${p.status}`,
        `PON: ${p.pon_port || "—"}`,
        `RX: ${p.rx_power != null ? p.rx_power + " dBm" : "—"}`,
        `Address: ${p.address || "—"}`,
      ];
      if (p.last_seen) parts.push(`Last: ${fmtTimeShort(p.last_seen)}`);
      if (!p.bound) parts.push(`<span style="color:#f97316">⚠ Unbound</span>`);

      if (parts.length > 0) parts.push("<br><i>click for details</i>");

      if (p.gps_lat && p.gps_lng) {
        const marker = L.marker([p.gps_lat, p.gps_lng], { icon })
          .bindTooltip(parts.join("<br>"), { sticky: true });
        marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          onUserSelectRef.current(p);
        });
        marker.addTo(layer);
      }
    }

    userLayerRef.current = layer;
    layer.addTo(map);
  }, [userPoints, showUserLayer, mapRef]);

  // Highlight effect: pulsing ring around the selected object
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (highlightLayerRef.current) {
      map.removeLayer(highlightLayerRef.current);
      highlightLayerRef.current = null;
    }
    if (!highlightedObject) return;

    let layer: L.Layer | null = null;
    const pulseColor = "#2563eb";
    const pulseWeight = 4;

    if (highlightedObject.type === "cable") {
      const c = cables.find((x) => x.id === highlightedObject.id);
      if (c && c.segments?.length >= 1) {
        const pts: [number, number][] = [];
        for (const s of c.segments) pts.push([s.start_lat, s.start_lng]);
        const last = c.segments[c.segments.length - 1];
        pts.push([last.end_lat, last.end_lng]);
        if (pts.length >= 2) {
          layer = L.polyline(pts, { color: pulseColor, weight: pulseWeight, opacity: 0.7, dashArray: "8,8", className: "highlight-pulse" });
        }
      }
    } else if (highlightedObject.type === "tj") {
      const t = tjBoxes.find((x) => x.id === highlightedObject.id);
      if (t) layer = L.circleMarker([t.lat, t.lng], { radius: 22, color: pulseColor, weight: 3, fillColor: pulseColor, fillOpacity: 0.15, dashArray: "6,6", className: "highlight-pulse" });
    } else if (highlightedObject.type === "splitter") {
      const s = splitters.find((x) => x.id === highlightedObject.id);
      if (s) layer = L.circleMarker([s.lat, s.lng], { radius: 18, color: pulseColor, weight: 3, fillColor: pulseColor, fillOpacity: 0.15, dashArray: "6,6", className: "highlight-pulse" });
    } else if (highlightedObject.type === "user") {
      const p = userPoints.find((x) => `${x.olt_id}-${x.onu_id}` === highlightedObject.id);
      if (p && p.gps_lat && p.gps_lng) layer = L.circleMarker([p.gps_lat, p.gps_lng], { radius: 18, color: pulseColor, weight: 3, fillColor: pulseColor, fillOpacity: 0.15, dashArray: "6,6", className: "highlight-pulse" });
    }

    if (layer) {
      layer.addTo(map);
      highlightLayerRef.current = layer;
    }
  }, [highlightedObject, cables, tjBoxes, splitters, userPoints, mapRef]);

  return (
    <div className="relative h-full">
      <div ref={setMapEl} className="w-full h-full" style={{ minHeight: isFullscreen ? "100%" : "400px" }} />

      {/* Cable Edit Toolbar */}
      {editingCableId && cableEditWaypoints && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] flex items-center gap-2 rounded-xl bg-white/95 dark:bg-slate-900/95 px-4 py-2.5 shadow-2xl border border-slate-200 dark:border-slate-700 backdrop-blur-sm">
          <span className="text-xs font-semibold text-red-600">Editing Cable Route</span>
          <span className="text-[10px] text-slate-400">Click map to add points · Drag to move · Double-click to remove</span>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />
          <span className="text-[10px] text-slate-500 font-mono">{calcDistKm(cableEditWaypoints).toFixed(2)} km · {cableEditWaypoints.length} pts</span>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-500">+5%: {Math.round(calcDistKm(cableEditWaypoints) * 1000 * 1.05).toLocaleString()} m · +10%: {Math.round(calcDistKm(cableEditWaypoints) * 1000 * 1.10).toLocaleString()} m</span>
          <button className="rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 transition" onClick={onSaveCableEdit}>Save</button>
          <button className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition" onClick={onCancelCableEdit}>Cancel</button>
        </div>
      )}

      {/* Draw Cable Toolbar */}
      {drawCable.active && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] flex items-center gap-2 rounded-xl bg-white/95 dark:bg-slate-900/95 px-4 py-2.5 shadow-2xl border border-emerald-300 dark:border-emerald-700 backdrop-blur-sm">
          <span className="text-xs font-semibold text-emerald-600">Drawing Cable</span>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />
          <div className="flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs font-medium">{drawCable.sourceTj?.unique_id}</span>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          <span className="text-xs font-semibold text-emerald-600">Move mouse · Click to place · Click TJ to finish</span>
          {drawCable.routePoints.length > 1 && (
            <>
              <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />
              <span className="text-[10px] text-slate-500 font-mono">{calcDistKm(drawCable.routePoints).toFixed(2)} km · {drawCable.routePoints.length - 1} pts</span>
            </>
          )}
          <span className="text-[10px] text-slate-400">ESC=undo</span>
          <button className="rounded-md bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition" onClick={onCancelDrawCable}>Cancel</button>
        </div>
      )}

      {/* Drag TJ Toolbar */}
      {dragTj.active && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] flex items-center gap-2 rounded-xl bg-white/95 dark:bg-slate-900/95 px-4 py-2.5 shadow-2xl border border-amber-300 dark:border-amber-700 backdrop-blur-sm">
          <span className="text-xs font-semibold text-amber-600">Dragging TJ: {dragTj.tj?.unique_id}</span>
          <span className="text-[10px] text-slate-400">Drag the marker to move, then Save</span>
          <button className="rounded-md bg-green-50 px-2.5 py-1 text-[11px] font-medium text-green-600 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/40 transition" onClick={onSaveDragTj}>Save</button>
          <button className="rounded-md bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition" onClick={onCancelDragTj}>Cancel</button>
        </div>
      )}

      {/* Cable Plan Toolbar */}
      {planner.phase !== "idle" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[999] flex items-center gap-2 rounded-xl bg-white/95 dark:bg-slate-900/95 px-4 py-2.5 shadow-2xl border border-slate-200 dark:border-slate-700 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            {planner.phase === "select-src" && (
              <><span className="text-xs font-semibold text-blue-600">Click Source TJ</span><span className="text-[10px] text-slate-400">— Select the starting TJ box on the map</span></>
            )}
            {planner.phase === "select-dst" && (
              <><div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" /><span className="text-xs font-medium">{planner.srcTj?.unique_id}</span></div><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg><span className="text-xs font-semibold text-blue-600">Click Destination TJ</span></>
            )}
            {planner.phase === "fetching" && (
              <><div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" /><span className="text-xs font-medium">{planner.srcTj?.unique_id}</span></div><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg><div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-blue-500" /><span className="text-xs font-medium">{planner.dstTj?.unique_id}</span></div><span className="text-[10px] text-slate-400 ml-1 animate-pulse">Finding routes...</span></>
            )}
            {planner.phase === "select-route" && (
              <><div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" /><span className="text-xs font-medium">{planner.srcTj?.unique_id}</span></div><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg><div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-blue-500" /><span className="text-xs font-medium">{planner.dstTj?.unique_id}</span></div><span className="text-[10px] text-slate-400 ml-1">— Select a route below</span></>
            )}
            {planner.phase === "draw" && (
              <><div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" /><span className="text-xs font-medium">{planner.srcTj?.unique_id}</span></div><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg><div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-blue-500" /><span className="text-xs font-medium">{planner.dstTj?.unique_id}</span></div><span className="text-[10px] text-slate-400 mx-1">|</span><span className="text-xs font-semibold text-red-600">Edit Route</span><span className="text-[10px] text-slate-400">— Click map to add points, double-click to remove</span></>
            )}
            {planner.phase === "custom-draw" && (
              <><div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" /><span className="text-xs font-medium">{planner.srcTj?.unique_id}</span></div><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg><div className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-blue-500" /><span className="text-xs font-medium">{planner.dstTj?.unique_id}</span></div><span className="text-[10px] text-slate-400 mx-1">|</span><span className="text-xs font-semibold text-amber-600">Custom Route</span><span className="text-[10px] text-slate-400">— Click map to add points, double-click to remove</span></>
            )}
          </div>
          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-1" />
          {planner.phase === "draw" && planner.waypoints.length >= 2 && (
            <>
              <span className="text-[10px] text-slate-500 font-mono">{calcDistKm(planner.waypoints).toFixed(2)} km · {planner.waypoints.length} pts</span>
              <span className="text-[10px] text-slate-400">|</span>
              <span className="text-[10px] text-slate-500">+5%: {Math.round(calcDistKm(planner.waypoints) * 1000 * 1.05).toLocaleString()} m · +10%: {Math.round(calcDistKm(planner.waypoints) * 1000 * 1.10).toLocaleString()} m · +15%: {Math.round(calcDistKm(planner.waypoints) * 1000 * 1.15).toLocaleString()} m · +20%: {Math.round(calcDistKm(planner.waypoints) * 1000 * 1.20).toLocaleString()} m</span>
            </>
          )}
          {planner.phase === "custom-draw" && customWaypoints.length >= 1 && (() => {
            const src = planner.srcTj; const dst = planner.dstTj;
            if (!src || !dst) return null;
            const allWp = [L.latLng(src.lat, src.lng), ...customWaypoints, L.latLng(dst.lat, dst.lng)];
            const distKm = calcDistKm(allWp);
            return (
              <>
                <span className="text-[10px] text-slate-500 font-mono">{distKm.toFixed(2)} km · {allWp.length} pts</span>
                <span className="text-[10px] text-slate-400">|</span>
                <span className="text-[10px] text-slate-500">+5%: {Math.round(distKm * 1000 * 1.05).toLocaleString()} m · +10%: {Math.round(distKm * 1000 * 1.10).toLocaleString()} m · +15%: {Math.round(distKm * 1000 * 1.15).toLocaleString()} m · +20%: {Math.round(distKm * 1000 * 1.20).toLocaleString()} m</span>
              </>
            );
          })()}
          {planner.phase === "draw" && (
            <button className="rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 transition" onClick={onConfirmRoute}>Confirm Route</button>
          )}
          {planner.phase === "custom-draw" && (
            <>
              <button className="rounded-md bg-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 transition" onClick={onUndoCustomWaypoint} disabled={customWaypoints.length === 0}>Undo</button>
              <button className="rounded-md bg-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 transition" onClick={onClearCustomWaypoints} disabled={customWaypoints.length === 0}>Clear</button>
              <button className="rounded-md bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 transition" onClick={onConfirmCustomRoute} disabled={customWaypoints.length < 1}>Use Route</button>
            </>
          )}
          <button className="rounded-md bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 transition" onClick={onCancelPlan}>Cancel</button>
        </div>
      )}

      {/* Route Alternatives Selection Panel */}
      {planner.phase === "select-route" && routeAlts.length > 0 && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[999] rounded-xl bg-white/95 dark:bg-slate-900/95 shadow-2xl border border-slate-200 dark:border-slate-700 backdrop-blur-sm p-4 max-w-lg w-[90vw]">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 mb-3">Select Route — {planner.srcTj?.unique_id} → {planner.dstTj?.unique_id}</div>
          <div className="space-y-2">
            {routeAlts.map((alt, i) => {
              const distM = Math.round(alt.distance);
              const distKm = (alt.distance / 1000).toFixed(2);
              const wpCount = alt.coords.length;
              const colors = ["bg-emerald-500", "bg-amber-500", "bg-violet-500", "bg-rose-500"];
              const borderColors = ["border-emerald-500", "border-amber-500", "border-violet-500", "border-rose-500"];
              return (
                <button key={i} className={`w-full flex items-center gap-3 rounded-lg border-2 ${borderColors[i] || "border-slate-300"} bg-white dark:bg-slate-800 p-3 hover:shadow-md transition text-left`} onClick={() => onSelectRoute(i)}>
                  <div className={`w-8 h-8 rounded-full ${colors[i] || "bg-slate-400"} text-white flex items-center justify-center text-sm font-bold`}>{i + 1}</div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-slate-800 dark:text-white">Route {i + 1}</div>
                    <div className="text-[10px] text-slate-500">{wpCount} waypoints · {i === 0 ? "Shortest" : "Alternative"}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5 font-mono">+5%: {Math.round(distM * 1.05).toLocaleString()} m · +10%: {Math.round(distM * 1.10).toLocaleString()} m · +15%: {Math.round(distM * 1.15).toLocaleString()} m · +20%: {Math.round(distM * 1.20).toLocaleString()} m</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{distKm} km</div>
                    <div className="text-[10px] text-slate-400">{distM.toLocaleString()} m</div>
                  </div>
                </button>
              );
            })}
            <button className="w-full flex items-center gap-3 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800/50 p-3 hover:shadow-md hover:border-amber-400 transition text-left" onClick={onStartCustomDraw}>
              <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
              </div>
              <div className="flex-1">
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">Draw Custom Route</div>
                <div className="text-[10px] text-slate-400">Click map points to create your own route</div>
              </div>
            </button>
          </div>
        </div>
      )}

      <div className="absolute top-2 right-2 z-[999] rounded-xl bg-white/95 dark:bg-slate-900/95 shadow-2xl border border-slate-200 dark:border-slate-700 backdrop-blur-sm p-2 sm:top-4 sm:right-4 sm:p-3 w-40 sm:w-52 max-h-[80vh] overflow-y-auto scrollbar-thin">
        <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 mb-2 uppercase tracking-wider">Base Map</div>
        <div className="grid grid-cols-2 gap-1 mb-3">
          {([["street","Street"],["satellite","Satellite"],["terrain","Terrain"],["hybrid","Hybrid"]] as const).map(([key,label]) => (
            <button key={key} onClick={() => onSetBaseMap(key)} className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${baseMap === key ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"}`}>{label}</button>
          ))}
        </div>
        <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 mb-2 uppercase tracking-wider">Network Layers</div>
        <div className="space-y-1">
          {([
            ["pop","NOC/POP","#f97316"],
            ["tjBox","TJ Box","#6366f1"],
            ["splitter","Splitter","#f59e0b"],
            ["fiberCable","Fiber Link","#22c55e"],
            ["cableRoute","Link Route","#8b5cf6"],
            ["olt","OLT","#ef4444"],
            ["customer","Customer","#06b6d4"],
          ] as const).map(([key,label,color]) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer group">
              <input type="checkbox" checked={netLayers[key]} onChange={() => onSetNetLayers({ ...netLayers, [key]: !netLayers[key] })} className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white transition">{label}</span>
            </label>
          ))}
        </div>
      </div>

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
