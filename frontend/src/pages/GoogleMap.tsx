/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useJsApiLoader } from "@react-google-maps/api";
import ActionResultBanner from "../components/ActionResultBanner";
import PhotoGallery from "../components/PhotoGallery";
import TjDetailPanel from "../components/TjDetailPanel";
import { api } from "../api/client";
import { Cable, TjBox, Splitter, FiberLoop, CableCut, Splice, TJ_PHOTO_TYPES, TJ_PHOTO_LABELS, MapPoint, MapPointResponse, CutRecoveryResult, canWrite } from "../api/types";
import SubscriberLink from "../components/SubscriberLink";
import StatusBadge from "../components/StatusBadge";
import { fmtTimeShort } from "../lib/time";
import { useUserRole } from "../lib/role";
import { tjTooltip, cableTooltip, loopTooltip, cutTooltip, userTooltip, nocTooltip, popTooltip, splitterTooltip, tooltipWrap } from "../lib/mapTooltips";

interface TempSegment {
  start_lat: number; start_lng: number; end_lat: number; end_lng: number; order_index: number;
}

const STATUS_COLOR: Record<string, string> = {
  pppoe: "#22c55e", up: "#22c55e", power_off: "#f97316", wire_down: "#ef4444",
  inactive: "#f97316", offline: "#f97316", unknown: "#6b7280", lost: "#a855f7",
  llid_admin_down: "#3b82f6",
};

const CORE_COLORS: Record<number, string> = {
  1: "#3b82f6", 2: "#f97316", 4: "#22c55e", 6: "#92400e",
  8: "#ef4444", 12: "#8b5cf6",
};

const TJ_ICONS: Record<string, string> = {
  home_tj: "#22c55e", regular_tj: "#6366f1", enclosure: "#f59e0b", dome: "#ef4444",
};

const SPLITTER_RATIO_COLORS: Record<number, string> = {
  2: "#22c55e", 4: "#3b82f6", 8: "#f59e0b", 16: "#ef4444", 32: "#8b5cf6", 64: "#ec4899",
};

function tjSvgUrl(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="${color}" stroke="white" stroke-width="2"/><text x="12" y="16" text-anchor="middle" font-size="10" fill="white" font-weight="bold">TJ</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function splitterSvgUrl(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><polygon points="10,2 18,18 2,18" fill="${color}" stroke="white" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function loopSvgUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><polygon points="12,2 21,7 21,17 12,22 3,17 3,7" fill="#06b6d4" stroke="white" stroke-width="2"/><text x="12" y="16" text-anchor="middle" font-size="9" fill="white" font-weight="bold">LP</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function cutSvgUrl(color = "#ef4444"): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><line x1="5" y1="17" x2="17" y2="5" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/><circle cx="5" cy="17" r="3" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="17" cy="5" r="3" fill="${color}" stroke="white" stroke-width="1.5"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function nocSvgUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28"><rect x="4" y="8" width="20" height="16" rx="2" fill="#ef4444" stroke="white" stroke-width="2"/><rect x="10" y="2" width="8" height="8" rx="1" fill="#ef4444" stroke="white" stroke-width="1.5"/><text x="14" y="20" text-anchor="middle" font-size="7" fill="white" font-weight="bold">NOC</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function popSvgUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#f97316" stroke="white" stroke-width="2"/><text x="12" y="16" text-anchor="middle" font-size="8" fill="white" font-weight="bold">POP</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
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

const LIBRARIES: ("drawing" | "geometry" | "places")[] = [];

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

export default function GoogleMap() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyLoading, setApiKeyLoading] = useState(true);
  const [apiKeyError, setApiKeyError] = useState("");

  useEffect(() => {
    api.get<any[]>("/settings").then((list) => {
      const found = list.find((s: any) => s.key === "google_maps_api_key");
      if (found?.value) {
        setApiKey(found.value);
      } else {
        setApiKeyError("Google Maps API key not configured. Go to Settings → API Keys.");
      }
    }).catch(() => setApiKeyError("Failed to load API key settings."))
      .finally(() => setApiKeyLoading(false));
  }, []);

  if (apiKeyLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-3">
          <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
          <div className="text-sm text-slate-500">Loading API key...</div>
        </div>
      </div>
    );
  }

  if (apiKeyError || !apiKey) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center space-y-3 max-w-md">
          <div className="text-red-500 text-lg font-semibold">Google Maps Not Configured</div>
          <div className="text-sm text-slate-500">{apiKeyError || "No API key found."}</div>
          <a href="/settings" className="btn-primary inline-block text-sm">Go to Settings</a>
        </div>
      </div>
    );
  }

  return <GoogleMapInner apiKey={apiKey} />;
}

function GoogleMapInner({ apiKey }: { apiKey: string }) {
  const { role } = useUserRole();
  const writeOk = canWrite(role);

  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    libraries: LIBRARIES,
  });

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
  type LatLng = { lat: number; lng: number };
  const [planner, setPlanner] = useState<{ phase: PlanPhase; srcTj: TjBox | null; dstTj: TjBox | null; waypoints: LatLng[] }>({ phase: "idle", srcTj: null, dstTj: null, waypoints: [] });
  const [routeAlts, setRouteAlts] = useState<{ coords: [number, number][]; distance: number; duration: number }[]>([]);
  const [customWaypoints, setCustomWaypoints] = useState<LatLng[]>([]);
  const [routing, setRouting] = useState(false);

  const calcWaypointDistKm = useCallback((wp: LatLng[]): number => { let d = 0; for (let i = 0; i < wp.length - 1; i++) d += haversine(wp[i].lat, wp[i].lng, wp[i + 1].lat, wp[i + 1].lng); return d / 1000; }, []);

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
    const waypoints = alt.coords.map((c) => ({ lat: c[0], lng: c[1] }));
    setPlanner((p) => ({ ...p, phase: "draw" as PlanPhase, waypoints }));
    setRouteAlts([]);
  }, [routeAlts]);

  const addWaypoint = useCallback((lat: number, lng: number) => {
    setPlanner((p) => { if (p.phase !== "draw" || p.waypoints.length < 2) return p;
      const pt = { lat, lng }; let best = 0, bestD = Infinity;
      for (let i = 0; i < p.waypoints.length - 1; i++) { const mid = { lat: (p.waypoints[i].lat + p.waypoints[i + 1].lat) / 2, lng: (p.waypoints[i].lng + p.waypoints[i + 1].lng) / 2 }; const d = haversine(pt.lat, pt.lng, mid.lat, mid.lng); if (d < bestD) { bestD = d; best = i; } }
      const wp = [...p.waypoints]; wp.splice(best + 1, 0, pt); return { ...p, waypoints: wp };
    });
  }, []);

  const removeWaypoint = useCallback((idx: number) => {
    setPlanner((p) => { if (p.phase !== "draw" || p.waypoints.length <= 2) return p; const wp = [...p.waypoints]; wp.splice(idx, 1); return { ...p, waypoints: wp }; });
  }, []);

  const updateWaypoint = useCallback((idx: number, lat: number, lng: number) => {
    setPlanner((p) => { if (p.phase !== "draw" || idx < 0 || idx >= p.waypoints.length) return p; const wp = [...p.waypoints]; wp[idx] = { lat, lng }; return { ...p, waypoints: wp }; });
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

  const startCustomDraw = useCallback(() => { setPlanner((p) => ({ ...p, phase: "custom-draw" as PlanPhase })); }, []);

  const addCustomWaypoint = useCallback((lat: number, lng: number) => {
    setCustomWaypoints((wp) => {
      if (wp.length === 0) return [{ lat, lng }];
      const pt = { lat, lng }; let best = 0, bestD = Infinity;
      for (let i = 0; i < wp.length - 1; i++) { const mid = { lat: (wp[i].lat + wp[i + 1].lat) / 2, lng: (wp[i].lng + wp[i + 1].lng) / 2 }; const d = haversine(pt.lat, pt.lng, mid.lat, mid.lng); if (d < bestD) { bestD = d; best = i; } }
      const newWp = [...wp]; newWp.splice(best + 1, 0, pt); return newWp;
    });
  }, []);

  const removeCustomWaypoint = useCallback((idx: number) => {
    setCustomWaypoints((wp) => { if (wp.length <= 1) return wp; const n = [...wp]; n.splice(idx, 1); return n; });
  }, []);

  const updateCustomWaypoint = useCallback((idx: number, lat: number, lng: number) => {
    setCustomWaypoints((wp) => { if (idx < 0 || idx >= wp.length) return wp; const n = [...wp]; n[idx] = { lat, lng }; return n; });
  }, []);

  const undoCustomWaypoint = useCallback(() => { setCustomWaypoints((wp) => wp.length > 0 ? wp.slice(0, -1) : wp); }, []);
  const clearCustomWaypoints = useCallback(() => { setCustomWaypoints([]); }, []);

  const confirmCustomRoute = useCallback(() => {
    setPlanner((p) => {
      if (!p.srcTj || !p.dstTj || customWaypoints.length < 1) return p;
      const allWp = [{ lat: p.srcTj.lat, lng: p.srcTj.lng }, ...customWaypoints, { lat: p.dstTj.lat, lng: p.dstTj.lng }];
      return { ...p, phase: "draw" as PlanPhase, waypoints: allWp };
    });
    setCustomWaypoints([]);
  }, [customWaypoints]);

  const [drawCable, setDrawCable] = useState<{ active: boolean; sourceTj: TjBox | null; routePoints: LatLng[]; mousePos: LatLng | null }>({ active: false, sourceTj: null, routePoints: [], mousePos: null });

  const startDrawCable = useCallback((tj: TjBox) => {
    setDrawCable({ active: true, sourceTj: tj, routePoints: [{ lat: tj.lat, lng: tj.lng }], mousePos: null });
  }, []);

  const setDrawMousePos = useCallback((lat: number, lng: number) => {
    setDrawCable((d) => { if (!d.active) return d; return { ...d, mousePos: { lat, lng } }; });
  }, []);

  const confirmDrawWaypoint = useCallback((lat?: number, lng?: number) => {
    setDrawCable((d) => {
      if (!d.active) return d;
      let pt: { lat: number; lng: number };
      if (lat != null && lng != null) {
        pt = { lat, lng };
      } else if (d.mousePos) {
        pt = { lat: d.mousePos.lat, lng: d.mousePos.lng };
      } else {
        return d;
      }
      const last = d.routePoints[d.routePoints.length - 1];
      if (last && last.lat === pt.lat && last.lng === pt.lng) return d;
      return { ...d, routePoints: [...d.routePoints, pt], mousePos: null };
    });
  }, []);

  const undoDrawWaypoint = useCallback(() => {
    setDrawCable((d) => { if (!d.active || d.routePoints.length <= 1) return d; const pts = [...d.routePoints]; pts.pop(); return { ...d, routePoints: pts }; });
  }, []);

  const finishDrawCable = useCallback((dstTj: TjBox) => {
    setDrawCable((d) => {
      if (!d.active || !d.sourceTj) return d;
      const allPoints = [...d.routePoints, { lat: dstTj.lat, lng: dstTj.lng }];
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

  const cancelDrawCable = useCallback(() => { setDrawCable({ active: false, sourceTj: null, routePoints: [], mousePos: null }); }, []);

  const [dragTj, setDragTj] = useState<{ active: boolean; tj: TjBox | null; marker: google.maps.Marker | null }>({ active: false, tj: null, marker: null });

  const startDragTj = useCallback((tj: TjBox, marker: google.maps.Marker) => {
    setDragTj({ active: true, tj, marker });
    marker.setDraggable(true);
  }, []);

  const saveDragTj = useCallback(async () => {
    if (!dragTj.tj || !dragTj.marker) return;
    const pos = dragTj.marker.getPosition();
    if (!pos) return;
    try {
      await api.put(`/fiber/tj-boxes/${dragTj.tj.id}/move`, { lat: pos.lat(), lng: pos.lng() });
      dragTj.marker.setDraggable(false);
      setDragTj({ active: false, tj: null, marker: null });
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to move TJ");
    }
  }, [dragTj]);

  const cancelDragTj = useCallback(() => {
    if (dragTj.marker && dragTj.tj) {
      dragTj.marker.setPosition({ lat: dragTj.tj.lat, lng: dragTj.tj.lng });
      dragTj.marker.setDraggable(false);
    }
    setDragTj({ active: false, tj: null, marker: null });
  }, [dragTj]);

  const [selectedTj, setSelectedTj] = useState<TjBox | null>(null);
  const [selectedCable, setSelectedCable] = useState<Cable | null>(null);
  const [cableEdit, setCableEdit] = useState<{
    cableId: number;
    waypoints: LatLng[];
    originalWaypoints: LatLng[];
    cable: Cable;
  } | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<number | null>(null);
  const [loopForm, setLoopForm] = useState<Partial<FiberLoop>>({});
  const [cutForm, setCutForm] = useState<Partial<CableCut>>({});
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<"links" | "tj" | "splitters" | "users">("links");
  const [searchCables, setSearchCables] = useState("");
  const [searchTj, setSearchTj] = useState("");
  const [searchSp, setSearchSp] = useState("");
  const [searchCuts, setSearchCuts] = useState("");

  const [mapPoints, setMapPoints] = useState<MapPoint[]>([]);
  const [filterUserStatus, setFilterUserStatus] = useState("all");
  const [filterUserText, setFilterUserText] = useState("");
  const [selectedUser, setSelectedUser] = useState<MapPoint | null>(null);
  const [userSidebarSearch, setUserSidebarSearch] = useState("");
  const [gpsForm, setGpsForm] = useState<{ lat: number; lng: number } | null>(null);

  const [recoveryCut, setRecoveryCut] = useState<CableCut | null>(null);
  const [recoveryResult, setRecoveryResult] = useState<CutRecoveryResult | null>(null);
  const [recovering, setRecovering] = useState(false);

  const [feasCheckOpen, setFeasCheckOpen] = useState(false);
  const [feasLat, setFeasLat] = useState("");
  const [feasLng, setFeasLng] = useState("");
  const [feasResults, setFeasResults] = useState<{ tj: TjBox; distanceM: number; destinations: string[] }[]>([]);
  const [feasChecked, setFeasChecked] = useState(false);

  const mapRef = useRef<google.maps.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const polylinesRef = useRef<Map<number, google.maps.Polyline>>(new Map());
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

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

  useEffect(() => {
    if (showForm === "tj" && !editingId) {
      api.get<{ unique_id: string }>("/fiber/tj-boxes/next-id")
        .then((data) => setTjForm((prev) => ({ ...prev, unique_id: data.unique_id })))
        .catch(() => {});
    }
  }, [showForm, editingId]);

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

  const filteredUsers = useMemo(() => {
    if (filterType !== "all" && filterType !== "customers") return [];
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
  }, [mapPoints, filterUserStatus, filterUserText, filterType]);

  const highlightObject = useCallback((type: HighlightedType, id: number | string) => {
    setHighlightedObject({ type, id });
    const map = mapRef.current;
    if (!map) return;
    if (type === "cable") {
      const c = cables.find((x) => x.id === id);
      if (c && c.segments.length > 0) {
        const mid = c.segments[Math.floor(c.segments.length / 2)];
        map.panTo({ lat: mid.start_lat, lng: mid.start_lng });
        map.setZoom(16);
      }
    } else if (type === "tj") {
      const t = tjBoxes.find((x) => x.id === id);
      if (t) { map.panTo({ lat: t.lat, lng: t.lng }); map.setZoom(16); }
    } else if (type === "splitter") {
      const s = splitters.find((x) => x.id === id);
      if (s) { map.panTo({ lat: s.lat, lng: s.lng }); map.setZoom(17); }
    } else if (type === "user") {
      const p = filteredUsers.find((x) => `${x.olt_id}-${x.onu_id}` === id);
      if (p && p.gps_lat && p.gps_lng) { map.panTo({ lat: p.gps_lat, lng: p.gps_lng }); map.setZoom(17); }
    }
  }, [cables, tjBoxes, splitters, filteredUsers]);

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

  const startCableEdit = useCallback((cable: Cable) => {
    if (!cable.segments?.length) return;
    const wps: LatLng[] = cable.segments.map((s) => ({ lat: s.start_lat, lng: s.start_lng }));
    const last = cable.segments[cable.segments.length - 1];
    wps.push({ lat: last.end_lat, lng: last.end_lng });
    setSelectedCable(null);
    setSelectedWaypoint(null);
    setCableEdit({ cableId: cable.id, waypoints: wps, originalWaypoints: wps.map((wp) => ({ ...wp })), cable });
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
      setCableEdit(null); setSelectedWaypoint(null); await load();
    } catch (e) { setError(String(e)); }
  }, [cableEdit, load]);

  const cancelCableEdit = useCallback(() => { setCableEdit(null); setSelectedWaypoint(null); }, []);

  const addEditWaypoint = useCallback((lat: number, lng: number) => {
    setSelectedWaypoint(null);
    setCableEdit((prev) => {
      if (!prev || prev.waypoints.length < 2) return prev;
      const pt = { lat, lng }; let best = 0, bestD = Infinity;
      for (let i = 0; i < prev.waypoints.length - 1; i++) {
        const mid = { lat: (prev.waypoints[i].lat + prev.waypoints[i + 1].lat) / 2, lng: (prev.waypoints[i].lng + prev.waypoints[i + 1].lng) / 2 };
        const d = haversine(pt.lat, pt.lng, mid.lat, mid.lng);
        if (d < bestD) { bestD = d; best = i; }
      }
      const wp = [...prev.waypoints]; wp.splice(best + 1, 0, pt);
      return { ...prev, waypoints: wp };
    });
  }, []);

  const removeEditWaypoint = useCallback((idx: number) => {
    setSelectedWaypoint(null);
    setCableEdit((prev) => { if (!prev || prev.waypoints.length <= 2) return prev; const wp = [...prev.waypoints]; wp.splice(idx, 1); return { ...prev, waypoints: wp }; });
  }, []);

  const updateEditWaypoint = useCallback((idx: number, lat: number, lng: number) => {
    setCableEdit((prev) => { if (!prev || idx < 0 || idx >= prev.waypoints.length) return prev; const wp = [...prev.waypoints]; wp[idx] = { lat, lng }; return { ...prev, waypoints: wp }; });
  }, []);

  const selectEditWaypoint = useCallback((idx: number | null) => { setSelectedWaypoint(idx); }, []);

  const saveLoop = async () => {
    try {
      if (loopForm.id) { await api.put(`/fiber/loops/${loopForm.id}`, loopForm); }
      else { await api.post("/fiber/loops", loopForm); }
      setShowForm(null); setLoopForm({}); await load();
    } catch (e) { setError(String(e)); }
  };

  const deleteLoop = async (id: number) => { if (!confirm("Delete loop?")) return; try { await api.del(`/fiber/loops/${id}`); await load(); } catch (e) { setError(String(e)); } };

  const saveCut = async () => {
    try {
      if (cutForm.id) { await api.put(`/fiber/cuts/${cutForm.id}`, cutForm); }
      else { await api.post("/fiber/cuts", cutForm); }
      setShowForm(null); setCutForm({}); await load();
    } catch (e) { setError(String(e)); }
  };

  const markRepaired = async (cutId: number) => {
    try { const result = await api.post<CutRecoveryResult>(`/fiber/cuts/${cutId}/recover`, {}); setRecoveryResult(result); await load(); } catch (e) { setError(String(e)); }
  };

  const startRecovery = (cut: CableCut) => { setRecoveryCut(cut); setRecoveryResult(null); };

  const confirmRecovery = async () => {
    if (!recoveryCut) return;
    setRecovering(true);
    try { const result = await api.post<CutRecoveryResult>(`/fiber/cuts/${recoveryCut.id}/recover`, {}); setRecoveryResult(result); setRecoveryCut(null); await load(); }
    catch (e) { setError(String(e)); }
    finally { setRecovering(false); }
  };

  const deleteCut = async (id: number) => { if (!confirm("Delete cut record?")) return; try { await api.del(`/fiber/cuts/${id}`); await load(); } catch (e) { setError(String(e)); } };

  const runFeasibilityCheck = () => {
    const lat = parseFloat(feasLat), lng = parseFloat(feasLng);
    if (isNaN(lat) || isNaN(lng)) { setError("Invalid coordinates"); return; }
    const results = tjBoxes.map((tj) => {
      const distanceM = haversine(lat, lng, tj.lat, tj.lng);
      const destinations: string[] = [];
      for (const c of cables) {
        if (!c.segments?.length) continue;
        const nearStart = c.segments.some((s) => haversine(s.start_lat, s.start_lng, tj.lat, tj.lng) < 50);
        const nearEnd = c.segments.some((s) => haversine(s.end_lat, s.end_lng, tj.lat, tj.lng) < 50);
        if (nearStart || nearEnd) {
          const otherTjId = c.src_tj_id === tj.id ? c.dst_tj_id : c.src_tj_id;
          if (otherTjId) { const other = tjBoxes.find((t) => t.id === otherTjId); if (other && !destinations.includes(other.unique_id)) destinations.push(other.unique_id); }
        }
      }
      return { tj, distanceM, destinations };
    }).sort((a, b) => a.distanceM - b.distanceM).slice(0, 3);
    setFeasResults(results);
    setFeasChecked(true);
  };

  // ── Google Map initialization ──
  useEffect(() => {
    if (!isLoaded || !mapContainerRef.current || mapRef.current) return;
    const map = new google.maps.Map(mapContainerRef.current, {
      center: CITY_CENTER,
      zoom: 13,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: false,
      gestureHandling: "greedy",
    });
    mapRef.current = map;

    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat(), lng = e.latLng.lng();
      if (drawCable.active) { confirmDrawWaypoint(lat, lng); return; }
      if (cableEdit) { addEditWaypoint(lat, lng); return; }
      if (planner.phase === "custom-draw") { addCustomWaypoint(lat, lng); return; }
      if (planner.phase === "draw") { addWaypoint(lat, lng); return; }
      setSelectedWaypoint(null);
      setHighlightedObject(null);
    });

    map.addListener("rightclick", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      e.domEvent.preventDefault();
      const lat = e.latLng.lat(), lng = e.latLng.lng();
      const existing = document.getElementById("gmap-ctx-menu");
      if (existing) existing.remove();
      const menu = document.createElement("div");
      menu.id = "gmap-ctx-menu";
      menu.style.cssText = `position:fixed;z-index:9999;background:white;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:4px 0;min-width:180px;font-size:13px;`;
      const items = [
        { label: "Feasibility Check", kind: "feas", color: "#22c55e" },
        { label: "Add TJ Box", kind: "tj", color: "#6366f1" },
        { label: "Add Link", kind: "cable", color: "#ef4444" },
        { label: "Add Loop", kind: "loop", color: "#06b6d4" },
        { label: "Report Cut", kind: "cut", color: "#ef4444" },
      ];
      for (const item of items) {
        const btn = document.createElement("button");
        btn.textContent = item.label;
        btn.style.cssText = `display:block;width:100%;text-align:left;padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;color:#334155;`;
        btn.onmouseenter = () => btn.style.background = "#f1f5f9";
        btn.onmouseleave = () => btn.style.background = "none";
        btn.onclick = () => {
          menu.remove();
          if (item.kind === "feas") { setFeasLat(String(lat)); setFeasLng(String(lng)); setFeasCheckOpen(true); }
          else if (item.kind === "tj") { setTjForm({ lat, lng }); setShowForm("tj"); }
          else if (item.kind === "cable") { setShowForm("cable"); }
          else if (item.kind === "loop") { setLoopForm({ lat, lng }); setShowForm("loop"); }
          else if (item.kind === "cut") { setCutForm({ lat, lng }); setShowForm("cut"); }
        };
        menu.appendChild(btn);
      }
      const px = (e.domEvent as MouseEvent).clientX, py = (e.domEvent as MouseEvent).clientY;
      menu.style.left = `${px}px`; menu.style.top = `${py}px`;
      document.body.appendChild(menu);
      const removeMenu = () => { menu.remove(); document.removeEventListener("click", removeMenu); };
      setTimeout(() => document.addEventListener("click", removeMenu), 0);
    });

    map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng || !drawCable.active) return;
      setDrawMousePos(e.latLng.lat(), e.latLng.lng());
    });

  }, [isLoaded]);

  // Dedicated Esc key handler for draw cable (updates when drawCable.active changes)
  useEffect(() => {
    if (!drawCable.active) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); undoDrawWaypoint(); } };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [drawCable.active]);

  // Re-attach click handlers when modes change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    google.maps.event.clearListeners(map, "click");
    google.maps.event.clearListeners(map, "rightclick");
    google.maps.event.clearListeners(map, "mousemove");

    map.addListener("click", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      const lat = e.latLng.lat(), lng = e.latLng.lng();
      if (drawCable.active) { confirmDrawWaypoint(lat, lng); return; }
      if (cableEdit) { addEditWaypoint(lat, lng); return; }
      if (planner.phase === "custom-draw") { addCustomWaypoint(lat, lng); return; }
      if (planner.phase === "draw") { addWaypoint(lat, lng); return; }
      setSelectedWaypoint(null);
      setHighlightedObject(null);
    });

    map.addListener("rightclick", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      e.domEvent.preventDefault();
      const lat = e.latLng.lat(), lng = e.latLng.lng();
      const existing = document.getElementById("gmap-ctx-menu");
      if (existing) existing.remove();
      const menu = document.createElement("div");
      menu.id = "gmap-ctx-menu";
      menu.style.cssText = `position:fixed;z-index:9999;background:white;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:4px 0;min-width:180px;font-size:13px;`;
      const items = [
        { label: "Feasibility Check", kind: "feas" },
        { label: "Add TJ Box", kind: "tj" },
        { label: "Add Link", kind: "cable" },
        { label: "Add Loop", kind: "loop" },
        { label: "Report Cut", kind: "cut" },
      ];
      for (const item of items) {
        const btn = document.createElement("button");
        btn.textContent = item.label;
        btn.style.cssText = `display:block;width:100%;text-align:left;padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;color:#334155;`;
        btn.onmouseenter = () => btn.style.background = "#f1f5f9";
        btn.onmouseleave = () => btn.style.background = "none";
        btn.onclick = () => {
          menu.remove();
          if (item.kind === "feas") { setFeasLat(String(lat)); setFeasLng(String(lng)); setFeasCheckOpen(true); }
          else if (item.kind === "tj") { setTjForm({ lat, lng }); setShowForm("tj"); }
          else if (item.kind === "cable") { setShowForm("cable"); }
          else if (item.kind === "loop") { setLoopForm({ lat, lng }); setShowForm("loop"); }
          else if (item.kind === "cut") { setCutForm({ lat, lng }); setShowForm("cut"); }
        };
        menu.appendChild(btn);
      }
      const px = (e.domEvent as MouseEvent).clientX, py = (e.domEvent as MouseEvent).clientY;
      menu.style.left = `${px}px`; menu.style.top = `${py}px`;
      document.body.appendChild(menu);
      const removeMenu = () => { menu.remove(); document.removeEventListener("click", removeMenu); };
      setTimeout(() => document.addEventListener("click", removeMenu), 0);
    });

    map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      if (!e.latLng || !drawCable.active) return;
      setDrawMousePos(e.latLng.lat(), e.latLng.lng());
    });
  }, [drawCable.active, cableEdit, planner.phase]);

  // ── Base map switching ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setMapTypeId(baseMap === "satellite" ? "satellite" : baseMap === "terrain" ? "terrain" : "roadmap");
  }, [baseMap]);

  // ── Render markers & polylines ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current.clear();
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current.clear();

    // Initialize shared InfoWindow for hover tooltips
    if (!infoWindowRef.current) {
      infoWindowRef.current = new google.maps.InfoWindow({ content: "", pixelOffset: new google.maps.Size(0, -10) });
    }
    const iw = infoWindowRef.current;

    // NOC/POP
    if (netLayers.pop) {
      for (const noc of nocPopData.nocs) {
        const m = new google.maps.Marker({ position: { lat: noc.lat, lng: noc.lng }, map, icon: { url: nocSvgUrl(), scaledSize: new google.maps.Size(28, 28) } });
        m.addListener("mouseover", () => { iw.setContent(nocTooltip(noc)); iw.open({ anchor: m, map }); });
        m.addListener("mouseout", () => iw.close());
        markersRef.current.set(`noc-${noc.id}`, m);
      }
      for (const pop of nocPopData.pops) {
        const m = new google.maps.Marker({ position: { lat: pop.lat, lng: pop.lng }, map, icon: { url: popSvgUrl(), scaledSize: new google.maps.Size(24, 24) } });
        m.addListener("mouseover", () => { iw.setContent(popTooltip(pop)); iw.open({ anchor: m, map }); });
        m.addListener("mouseout", () => iw.close());
        markersRef.current.set(`pop-${pop.id}`, m);
      }
    }

    // Cables — polyline hover tooltip
    if (netLayers.fiberCable) {
      for (const cable of cables) {
        if (!cable.segments?.length) continue;
        const path = cable.segments.flatMap((s) => [{ lat: s.start_lat, lng: s.start_lng }, { lat: s.end_lat, lng: s.end_lng }]);
        const color = CORE_COLORS[cable.core_count] || "#6b7280";
        const pl = new google.maps.Polyline({ path, map, strokeColor: color, strokeOpacity: 0.8, strokeWeight: 3, clickable: !drawCable.active });
        pl.addListener("click", () => setSelectedCable(cable));
        pl.addListener("dblclick", () => { if (writeOk) startCableEdit(cable); });
        pl.addListener("rightclick", (e: google.maps.MapMouseEvent) => { e.domEvent.preventDefault(); e.domEvent.stopPropagation(); });
        pl.addListener("mouseover", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          iw.setContent(cableTooltip(cable, tjBoxes, loops));
          iw.setPosition(e.latLng);
          iw.open(map);
        });
        pl.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) iw.setPosition(e.latLng);
        });
        pl.addListener("mouseout", () => iw.close());
        polylinesRef.current.set(cable.id, pl);
      }
    }

    // TJ Boxes
    if (netLayers.tjBox) {
      for (const tj of tjBoxes) {
        const color = TJ_ICONS[tj.box_type] || "#6366f1";
        const hostedSps = splitters.filter((s) => s.tj_box_id === tj.id);
        const m = new google.maps.Marker({
          position: { lat: tj.lat, lng: tj.lng }, map,
          icon: { url: tjSvgUrl(color), scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) },
        });
        m.addListener("mouseover", () => { iw.setContent(tjTooltip(tj, hostedSps)); iw.open({ anchor: m, map }); });
        m.addListener("mouseout", () => iw.close());
        m.addListener("click", () => {
          if (drawCable.active && drawCable.sourceTj?.id !== tj.id) { finishDrawCable(tj); return; }
          if (planner.phase === "select-src") { setPlanner((p) => ({ ...p, srcTj: tj, phase: "select-dst" as PlanPhase })); return; }
          if (planner.phase === "select-dst") { setPlanner((p) => ({ ...p, dstTj: tj })); fetchOsrmAlts(planner.srcTj!, tj); return; }
          setSelectedTj(tj);
        });
        m.addListener("rightclick", (e: google.maps.MapMouseEvent) => {
          e.domEvent.preventDefault();
          e.domEvent.stopPropagation();
          const existing = document.getElementById("gmap-tj-ctx");
          if (existing) existing.remove();
          const menu = document.createElement("div");
          menu.id = "gmap-tj-ctx";
          menu.style.cssText = `position:fixed;z-index:9999;background:white;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:4px 0;min-width:160px;font-size:13px;`;
          const actions = [
            { label: "Draw Cable", action: () => startDrawCable(tj) },
            { label: "Drag / Move", action: () => startDragTj(tj, m) },
            { label: "View Details", action: () => setSelectedTj(tj) },
          ];
          for (const a of actions) {
            const btn = document.createElement("button");
            btn.textContent = a.label;
            btn.style.cssText = `display:block;width:100%;text-align:left;padding:8px 16px;border:none;background:none;cursor:pointer;font-size:13px;color:#334155;`;
            btn.onmouseenter = () => btn.style.background = "#f1f5f9";
            btn.onmouseleave = () => btn.style.background = "none";
            btn.onclick = () => { menu.remove(); a.action(); };
            menu.appendChild(btn);
          }
          const px = (e.domEvent as MouseEvent).clientX, py = (e.domEvent as MouseEvent).clientY;
          menu.style.left = `${px}px`; menu.style.top = `${py}px`;
          document.body.appendChild(menu);
          const removeMenu = () => { menu.remove(); document.removeEventListener("click", removeMenu); };
          setTimeout(() => document.addEventListener("click", removeMenu), 0);
        });
        markersRef.current.set(`tj-${tj.id}`, m);
      }
    }

    // Splitters
    if (netLayers.splitter) {
      for (const sp of splitters) {
        const color = SPLITTER_RATIO_COLORS[sp.split_ratio] || "#f59e0b";
        const m = new google.maps.Marker({
          position: { lat: sp.lat, lng: sp.lng }, map,
          icon: { url: splitterSvgUrl(color), scaledSize: new google.maps.Size(20, 20), anchor: new google.maps.Point(10, 10) },
        });
        m.addListener("mouseover", () => { iw.setContent(splitterTooltip(sp)); iw.open({ anchor: m, map }); });
        m.addListener("mouseout", () => iw.close());
        m.addListener("click", () => {
          if (planner.phase === "select-src" || planner.phase === "select-dst") return;
          setSplitterForm(sp); setEditingId(sp.id); setEditKind("splitter"); setShowForm("splitter");
        });
        markersRef.current.set(`sp-${sp.id}`, m);
      }
    }

    // Loops
    for (const loop of loops) {
      const m = new google.maps.Marker({
        position: { lat: loop.lat, lng: loop.lng }, map,
        icon: { url: loopSvgUrl(), scaledSize: new google.maps.Size(24, 24), anchor: new google.maps.Point(12, 12) },
      });
      m.addListener("mouseover", () => { iw.setContent(loopTooltip(loop)); iw.open({ anchor: m, map }); });
      m.addListener("mouseout", () => iw.close());
      m.addListener("click", () => { setLoopForm(loop); setShowForm("loop"); });
      markersRef.current.set(`loop-${loop.id}`, m);
    }

    // Cuts
    for (const cut of cuts) {
      const color = cut.status === "repaired" ? "#22c55e" : "#ef4444";
      const m = new google.maps.Marker({
        position: { lat: cut.lat, lng: cut.lng }, map,
        icon: { url: cutSvgUrl(color), scaledSize: new google.maps.Size(22, 22), anchor: new google.maps.Point(11, 11) },
      });
      m.addListener("mouseover", () => { iw.setContent(cutTooltip(cut)); iw.open({ anchor: m, map }); });
      m.addListener("mouseout", () => iw.close());
      m.addListener("click", () => { setCutForm(cut); setShowForm("cut"); });
      markersRef.current.set(`cut-${cut.id}`, m);
    }

    // Users
    if (netLayers.customer) {
      for (const p of mapPoints) {
        if (!p.gps_lat || !p.gps_lng) continue;
        const color = STATUS_COLOR[p.status] || "#6b7280";
        const isFault = p.status === "wire_down" || p.status === "lost" || p.status === "llid_admin_down";
        const m = new google.maps.Marker({
          position: { lat: p.gps_lat, lng: p.gps_lng }, map,
          icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><circle cx="6" cy="6" r="5" fill="${color}" stroke="white" stroke-width="1.5"/></svg>`)}`, scaledSize: new google.maps.Size(12, 12), anchor: new google.maps.Point(6, 6) },
        });
        m.addListener("mouseover", () => { iw.setContent(userTooltip(p, fmtTimeShort)); iw.open({ anchor: m, map }); });
        m.addListener("mouseout", () => iw.close());
        m.addListener("click", () => setSelectedUser(p));
        markersRef.current.set(`user-${p.olt_id}-${p.onu_id}`, m);
      }
    }
  }, [cables, tjBoxes, splitters, loops, cuts, mapPoints, nocPopData, netLayers, drawCable.active, planner.phase]);

  // ── Highlight overlay ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !highlightedObject) return;
    // Simple highlight via panTo
    if (highlightedObject.type === "tj") {
      const t = tjBoxes.find((x) => x.id === highlightedObject.id);
      if (t) { map.panTo({ lat: t.lat, lng: t.lng }); map.setZoom(16); }
    }
  }, [highlightedObject, tjBoxes]);

  // ── Drawing overlays (waypoints, routes) ──
  const drawingOverlaysRef = useRef<google.maps.Marker[]>([]);
  const drawingPolylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Clear old
    drawingOverlaysRef.current.forEach((m) => m.setMap(null));
    drawingOverlaysRef.current = [];
    drawingPolylinesRef.current.forEach((p) => p.setMap(null));
    drawingPolylinesRef.current = [];

    // Planner route
    if (planner.phase === "draw" && planner.waypoints.length >= 2) {
      const pl = new google.maps.Polyline({ path: planner.waypoints, map, strokeColor: "#ef4444", strokeOpacity: 0.8, strokeWeight: 3, geodesic: true });
      drawingPolylinesRef.current.push(pl);
      planner.waypoints.forEach((wp, i) => {
        const isFirst = i === 0, isLast = i === planner.waypoints.length - 1;
        const m = new google.maps.Marker({
          position: wp, map, draggable: true,
          icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="6" fill="${isFirst ? "#22c55e" : isLast ? "#3b82f6" : "#ef4444"}" stroke="white" stroke-width="2"/></svg>`)}`, scaledSize: new google.maps.Size(14, 14), anchor: new google.maps.Point(7, 7) },
          label: isFirst ? "SRC" : isLast ? "DST" : undefined,
        });
        m.addListener("dragend", () => { const pos = m.getPosition(); if (pos) updateWaypoint(i, pos.lat(), pos.lng()); });
        m.addListener("dblclick", () => removeWaypoint(i));
        drawingOverlaysRef.current.push(m);
      });
    }

    // Custom draw waypoints
    if (planner.phase === "custom-draw" && customWaypoints.length > 0) {
      if (planner.srcTj) {
        const m = new google.maps.Marker({ position: { lat: planner.srcTj.lat, lng: planner.srcTj.lng }, map, icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="6" fill="#22c55e" stroke="white" stroke-width="2"/></svg>`)}`, scaledSize: new google.maps.Size(14, 14) } });
        m.addListener("mouseover", () => { const iw = infoWindowRef.current; if (iw) { iw.setContent(tooltipWrap("<b>Source TJ</b><br>" + planner.srcTj!.name)); iw.open({ anchor: m, map }); } });
        m.addListener("mouseout", () => { const iw = infoWindowRef.current; if (iw) iw.close(); });
        drawingOverlaysRef.current.push(m);
      }
      if (planner.dstTj) {
        const m = new google.maps.Marker({ position: { lat: planner.dstTj.lat, lng: planner.dstTj.lng }, map, icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="6" fill="#3b82f6" stroke="white" stroke-width="2"/></svg>`)}`, scaledSize: new google.maps.Size(14, 14) } });
        m.addListener("mouseover", () => { const iw = infoWindowRef.current; if (iw) { iw.setContent(tooltipWrap("<b>Destination TJ</b><br>" + planner.dstTj!.name)); iw.open({ anchor: m, map }); } });
        m.addListener("mouseout", () => { const iw = infoWindowRef.current; if (iw) iw.close(); });
        drawingOverlaysRef.current.push(m);
      }
      const allPts = [...(planner.srcTj ? [{ lat: planner.srcTj.lat, lng: planner.srcTj.lng }] : []), ...customWaypoints, ...(planner.dstTj ? [{ lat: planner.dstTj.lat, lng: planner.dstTj.lng }] : [])];
      if (allPts.length >= 2) {
        const pl = new google.maps.Polyline({ path: allPts, map, strokeColor: "#f59e0b", strokeOpacity: 0.6, strokeWeight: 2, geodesic: true, icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1 }, repeat: "20px", offset: "0" }] });
        drawingPolylinesRef.current.push(pl);
      }
      customWaypoints.forEach((wp, i) => {
        const m = new google.maps.Marker({
          position: wp, map, draggable: true,
          icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"><circle cx="6" cy="6" r="5" fill="#f59e0b" stroke="white" stroke-width="1.5"/></svg>`)}`, scaledSize: new google.maps.Size(12, 12), anchor: new google.maps.Point(6, 6) },
        });
        m.addListener("dragend", () => { const pos = m.getPosition(); if (pos) updateCustomWaypoint(i, pos.lat(), pos.lng()); });
        m.addListener("dblclick", () => removeCustomWaypoint(i));
        drawingOverlaysRef.current.push(m);
      });
    }

    // Draw cable mode
    if (drawCable.active) {
      if (drawCable.sourceTj) {
        const m = new google.maps.Marker({ position: { lat: drawCable.sourceTj.lat, lng: drawCable.sourceTj.lng }, map, icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="6" fill="#22c55e" stroke="white" stroke-width="2"/></svg>`)}`, scaledSize: new google.maps.Size(14, 14) } });
        m.addListener("mouseover", () => { const iw = infoWindowRef.current; if (iw) { iw.setContent(tooltipWrap("<b>Source TJ</b><br>" + drawCable.sourceTj!.name)); iw.open({ anchor: m, map }); } });
        m.addListener("mouseout", () => { const iw = infoWindowRef.current; if (iw) iw.close(); });
        drawingOverlaysRef.current.push(m);
      }
      if (drawCable.routePoints.length >= 1) {
        const pts = [...drawCable.routePoints, ...(drawCable.mousePos ? [drawCable.mousePos] : [])];
        const pl = new google.maps.Polyline({ path: pts, map, strokeColor: "#22c55e", strokeOpacity: 0.85, strokeWeight: 4, geodesic: true, clickable: false });
        drawingPolylinesRef.current.push(pl);
      }
      drawCable.routePoints.forEach((wp, i) => {
        if (i === 0) return; // Skip source
        const m = new google.maps.Marker({
          position: wp, map, clickable: false,
          icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4" fill="#f59e0b" stroke="white" stroke-width="1"/></svg>`)}`, scaledSize: new google.maps.Size(10, 10), anchor: new google.maps.Point(5, 5) },
        });
        drawingOverlaysRef.current.push(m);
      });
      if (drawCable.mousePos) {
        const m = new google.maps.Marker({
          position: drawCable.mousePos, map, clickable: false,
          icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle cx="5" cy="5" r="4" fill="#22c55e" fill-opacity="0.5" stroke="#22c55e" stroke-width="1"/></svg>`)}`, scaledSize: new google.maps.Size(10, 10), anchor: new google.maps.Point(5, 5) },
        });
        m.addListener("mouseover", () => { const iw = infoWindowRef.current; if (iw) { iw.setContent(tooltipWrap("Click to place")); iw.open({ anchor: m, map }); } });
        m.addListener("mouseout", () => { const iw = infoWindowRef.current; if (iw) iw.close(); });
        drawingOverlaysRef.current.push(m);
      }
    }

    // Cable edit mode
    if (cableEdit) {
      const pl = new google.maps.Polyline({ path: cableEdit.waypoints, map, strokeColor: "#ef4444", strokeOpacity: 0.8, strokeWeight: 3, geodesic: true });
      drawingPolylinesRef.current.push(pl);
      cableEdit.waypoints.forEach((wp, i) => {
        const isFirst = i === 0, isLast = i === cableEdit.waypoints.length - 1;
        const isSelected = selectedWaypoint === i;
        const m = new google.maps.Marker({
          position: wp, map, draggable: true,
          icon: { url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${isSelected ? 18 : 14}" height="${isSelected ? 18 : 14}"><circle cx="${isSelected ? 9 : 7}" cy="${isSelected ? 9 : 7}" r="${isSelected ? 8 : 6}" fill="${isFirst || isLast ? "#22c55e" : isSelected ? "#f59e0b" : "#ef4444"}" stroke="white" stroke-width="2"/></svg>`)}`, scaledSize: new google.maps.Size(isSelected ? 18 : 14, isSelected ? 18 : 14), anchor: new google.maps.Point(isSelected ? 9 : 7, isSelected ? 9 : 7) },
        });
        m.addListener("click", () => selectEditWaypoint(i));
        m.addListener("dragend", () => { const pos = m.getPosition(); if (pos) updateEditWaypoint(i, pos.lat(), pos.lng()); });
        if (!isFirst && !isLast) m.addListener("dblclick", () => removeEditWaypoint(i));
        drawingOverlaysRef.current.push(m);
      });
    }
  }, [planner.waypoints, planner.phase, planner.srcTj, planner.dstTj, customWaypoints, drawCable, cableEdit, selectedWaypoint]);

  const formatDistance = (m: number) => m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m";

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center space-y-3 max-w-md">
          <div className="text-red-500 text-lg font-semibold">Failed to load Google Maps</div>
          <div className="text-sm text-slate-500">Check your API key and ensure Maps JavaScript API is enabled.</div>
        </div>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className={`flex h-full ${isFullscreen ? "fixed inset-0 z-50" : ""}`}>
      {error && <ActionResultBanner ok={false} message={error} onDismiss={() => setError("")} />}

      {/* Left sidebar */}
      <div className="w-80 shrink-0 border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-200 dark:border-slate-700 space-y-2">
          <div className="flex items-center gap-2">
            <select className="input text-xs flex-1" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">All Layers</option>
              <option value="cable">Links</option>
              <option value="tj">TJ Boxes</option>
              <option value="splitter">Splitters</option>
              <option value="customers">Customers</option>
            </select>
          </div>
          {filterType === "cable" && (
            <select className="input text-xs" value={filterCore} onChange={(e) => setFilterCore(e.target.value)}>
              <option value="all">All Core Counts</option>
              {[2, 4, 8, 12, 24, 36, 48, 144].map((n) => <option key={n} value={n}>{n} cores</option>)}
            </select>
          )}
          {filterType === "tj" && (
            <select className="input text-xs" value={filterPort} onChange={(e) => setFilterPort(e.target.value)}>
              <option value="all">All Port Counts</option>
              {[2, 4, 8, 10, 12].map((n) => <option key={n} value={n}>{n} ports</option>)}
            </select>
          )}
          {filterType === "splitter" && (
            <select className="input text-xs" value={filterRatio} onChange={(e) => setFilterRatio(e.target.value)}>
              <option value="all">All Ratios</option>
              {[2, 4, 8, 16, 32, 64].map((n) => <option key={n} value={n}>1:{n}</option>)}
            </select>
          )}
          {filterType === "customers" && (
            <select className="input text-xs" value={filterUserStatus} onChange={(e) => setFilterUserStatus(e.target.value)}>
              <option value="all">All Status</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="wire_down">Wire Down</option>
              <option value="unknown">Unknown</option>
              <option value="lost">Lost</option>
              <option value="llid_admin_down">LLID Admin Down</option>
            </select>
          )}
          <input className="input text-xs" placeholder="Search..." value={filterText} onChange={(e) => setFilterText(e.target.value)} />
        </div>

        {/* Tab list */}
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          {(["links", "tj", "splitters", "users"] as const).map((tab) => (
            <button key={tab} className={`flex-1 py-2 text-xs font-medium capitalize ${activeTab === tab ? "text-blue-600 border-b-2 border-blue-600" : "text-slate-500 hover:text-slate-700"}`} onClick={() => setActiveTab(tab)}>
              {tab === "links" ? "Links" : tab === "tj" ? "TJ" : tab === "splitters" ? "Splitters" : "Users"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {activeTab === "links" && (
            <>
              <input className="input text-xs w-full mb-1 py-1" placeholder="Search links..." value={searchCables} onChange={(e) => setSearchCables(e.target.value)} />
              {filteredCables.map((c) => {
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
            </>
          )}
          {activeTab === "tj" && (
            <>
              <input className="input text-xs w-full mb-1 py-1" placeholder="Search TJs..." value={searchTj} onChange={(e) => setSearchTj(e.target.value)} />
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
            </>
          )}
          {activeTab === "splitters" && (
            <>
              <input className="input text-xs w-full mb-1 py-1" placeholder="Search splitters..." value={searchSp} onChange={(e) => setSearchSp(e.target.value)} />
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
            </>
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
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Map container */}
      <div className="flex-1 relative">
        <div ref={mapContainerRef} className="h-full w-full" />

        {/* Base map toggle */}
        <div className="absolute top-2 right-2 z-10 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-1 flex gap-1">
          {(["street", "satellite", "terrain", "hybrid"] as const).map((bm) => (
            <button key={bm} className={`px-2 py-1 text-[10px] rounded ${baseMap === bm ? "bg-blue-600 text-white" : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"}`} onClick={() => setBaseMap(bm)}>
              {bm.charAt(0).toUpperCase() + bm.slice(1)}
            </button>
          ))}
        </div>

        {/* Action ribbon */}
        {writeOk && (
          <div className="absolute top-[44px] right-2 z-10 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-1 flex gap-1">
            <button className="px-2 py-1 text-[10px] rounded font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50" onClick={() => { setShowForm("cable"); setEditingId(null); setCableForm({ cable_type: "round", core_count: 12, route_type: "driving", src_tj_id: null, dst_tj_id: null }); }}>+ Link</button>
            <button className="px-2 py-1 text-[10px] rounded font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50" onClick={() => { setShowForm("tj"); setEditingId(null); setTjForm({ box_type: "regular_tj", tj_port: 4, capacity: 4, tray_count: 1 }); }}>+ TJ</button>
            <button className="px-2 py-1 text-[10px] rounded font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50" onClick={() => { setFeasCheckOpen(true); setFeasChecked(false); setFeasResults([]); setFeasLat(""); setFeasLng(""); }}>Feasibility</button>
            <button className={`px-2 py-1 text-[10px] rounded font-medium ${planner.phase !== "idle" ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"}`} onClick={() => setPlanner({ phase: "select-src", srcTj: null, dstTj: null, waypoints: [] })}>
              {planner.phase !== "idle" ? "Planning..." : "Plan Link"}
            </button>
          </div>
        )}

        {/* Layer toggles */}
        <div className="absolute top-[80px] right-2 z-10 bg-white dark:bg-slate-800 rounded-lg shadow-lg border border-slate-200 dark:border-slate-700 p-2 space-y-1">
          {([
            { key: "pop", label: "NOC/POP", color: "#f97316" },
            { key: "tjBox", label: "TJ Box", color: "#6366f1" },
            { key: "splitter", label: "Splitter", color: "#f59e0b" },
            { key: "fiberCable", label: "Fiber Link", color: "#22c55e" },
            { key: "customer", label: "Customer", color: "#06b6d4" },
          ] as const).map(({ key, label, color }) => (
            <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={(netLayers as any)[key]} onChange={(e) => setNetLayers({ ...netLayers, [key]: e.target.checked })} className="rounded" />
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-slate-600 dark:text-slate-300">{label}</span>
            </label>
          ))}
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-20 left-2 z-10 flex flex-col gap-1">
          <button className="w-8 h-8 bg-white dark:bg-slate-800 rounded shadow border border-slate-200 dark:border-slate-700 flex items-center justify-center text-lg font-bold text-slate-600 dark:text-slate-300" onClick={() => mapRef.current?.setZoom((mapRef.current?.getZoom() || 13) + 1)}>+</button>
          <button className="w-8 h-8 bg-white dark:bg-slate-800 rounded shadow border border-slate-200 dark:border-slate-700 flex items-center justify-center text-lg font-bold text-slate-600 dark:text-slate-300" onClick={() => mapRef.current?.setZoom((mapRef.current?.getZoom() || 13) - 1)}>−</button>
        </div>

        {/* Planner toolbar */}
        {planner.phase !== "idle" && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-3 text-sm">
            {planner.phase === "select-src" && <span className="text-slate-600 dark:text-slate-300">Click a TJ box as <strong>source</strong></span>}
            {planner.phase === "select-dst" && <span className="text-slate-600 dark:text-slate-300">Click a TJ box as <strong>destination</strong></span>}
            {planner.phase === "fetching" && <span className="text-blue-600">Fetching routes...</span>}
            {planner.phase === "select-route" && (
              <div className="flex items-center gap-2">
                <span className="text-slate-600 dark:text-slate-300">Select a route:</span>
                {routeAlts.map((alt, i) => (
                  <button key={i} className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs" onClick={() => selectRoute(i)}>
                    {(alt.distance / 1000).toFixed(1)}km
                  </button>
                ))}
              </div>
            )}
            {planner.phase === "draw" && (
              <div className="flex items-center gap-2">
                <span className="text-slate-600 dark:text-slate-300">{planner.waypoints.length} pts · {calcWaypointDistKm(planner.waypoints).toFixed(2)}km</span>
                <button className="btn-primary text-xs py-1" onClick={confirmRoute}>Confirm</button>
              </div>
            )}
            {planner.phase === "custom-draw" && (
              <div className="flex items-center gap-2">
                <span className="text-slate-600 dark:text-slate-300">{customWaypoints.length} custom pts</span>
                <button className="btn-primary text-xs py-1" onClick={confirmCustomRoute}>Use Custom</button>
                <button className="btn-secondary text-xs py-1" onClick={startCustomDraw}>Switch to OSRM</button>
              </div>
            )}
            <button className="text-slate-400 hover:text-slate-600 text-xs" onClick={cancelPlan}>Cancel</button>
          </div>
        )}

        {/* Draw cable toolbar */}
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
                <span className="text-[10px] text-slate-500 font-mono">{calcWaypointDistKm(drawCable.routePoints).toFixed(2)} km · {drawCable.routePoints.length - 1} pts</span>
              </>
            )}
            <span className="text-[10px] text-slate-400">ESC=undo</span>
            <button className="rounded-md bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition" onClick={cancelDrawCable}>Cancel</button>
          </div>
        )}

        {/* Cable edit toolbar */}
        {cableEdit && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-3 text-sm">
            <span className="text-slate-600 dark:text-slate-300">
              {cableEdit.waypoints.length} points · {calcWaypointDistKm(cableEdit.waypoints).toFixed(2)}km
            </span>
            <button className="btn-primary text-xs py-1" onClick={saveCableEdit}>Save</button>
            <button className="btn-secondary text-xs py-1" onClick={cancelCableEdit}>Cancel</button>
          </div>
        )}

        {/* TJ drag toolbar */}
        {dragTj.active && dragTj.tj && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-200 dark:border-slate-700 px-4 py-2 flex items-center gap-3 text-sm">
            <span className="text-slate-600 dark:text-slate-300">Dragging: <strong>{dragTj.tj.unique_id}</strong></span>
            <button className="btn-primary text-xs py-1" onClick={saveDragTj}>Save</button>
            <button className="btn-secondary text-xs py-1" onClick={cancelDragTj}>Cancel</button>
          </div>
        )}
      </div>

      {/* ── Modals ── */}

      {/* Cable detail */}
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
                <button className="btn-danger text-xs" onClick={() => { setSelectedCable(null); deleteItem("cable", selectedCable.id); }}>Delete</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* User detail */}
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
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">Connected OLT</div><div className="font-semibold">{selectedUser.olt_name || "—"}</div></div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">PON Port</div><div className="font-mono font-semibold">{selectedUser.pon_port || "—"}</div></div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3"><div className="text-xs text-slate-400">GPS Accuracy</div><div className="font-semibold">{selectedUser.gps_accuracy != null ? `±${selectedUser.gps_accuracy}m` : "—"}</div></div>
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

      {/* TJ detail */}
      {selectedTj && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSelectedTj(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <TjDetailPanel tj={selectedTj} cables={cables} splitters={splitters} splices={splices} onClose={() => setSelectedTj(null)} onSpliceChange={load} writeOk={writeOk}
              onAddSplitter={() => { setSplitterForm({ split_ratio: 2, tj_box_id: selectedTj.id, lat: selectedTj.lat, lng: selectedTj.lng }); setEditingId(null); setShowForm("splitter"); }}
              onEditSplitter={(sp) => { setEditingId(sp.id); setEditKind("splitter"); setSplitterForm(sp as any); setShowForm("splitter"); }}
              onDelete={() => { setSelectedTj(null); deleteItem("tj", selectedTj.id); }}
            />
          </div>
        </div>
      )}

      {/* Cable form */}
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

      {/* TJ form */}
      {showForm === "tj" && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setShowForm(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl dark:bg-slate-900 sm:p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">{editingId ? "Edit" : "Add"} TJ / Enclosure</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div><label className="label">TJ ID</label><input className="input bg-slate-100 dark:bg-slate-800" value={tjForm.unique_id || ""} readOnly placeholder={editingId ? "Keep current" : "Reserving..."} /></div>
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

      {/* Splitter form */}
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

      {/* Loop form */}
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

      {/* Cut form */}
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

      {/* Cut Recovery Confirmation */}
      {recoveryCut && !recoveryResult && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setRecoveryCut(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Cut Recovery</h2>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setRecoveryCut(null)}>
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
                      <div><span className="font-medium">Capacity:</span> {tjCapacity || "Exceeds max"} Port</div>
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

      {/* Cut Recovery Result */}
      {recoveryResult && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setRecoveryResult(null)}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Recovery Completed</h2>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setRecoveryResult(null)}>
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

      {/* GPS Edit */}
      {gpsForm && selectedUser && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setGpsForm(null)}>
          <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Edit GPS — {selectedUser.name}</h2>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => setGpsForm(null)}>
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

      {/* Feasibility Check */}
      {feasCheckOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => { setFeasCheckOpen(false); setFeasChecked(false); setFeasResults([]); }}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Feasibility Check</h2>
              <button className="text-slate-400 hover:text-slate-600" onClick={() => { setFeasCheckOpen(false); setFeasChecked(false); setFeasResults([]); }}>
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-400">Enter coordinates to find the 3 nearest TJ boxes and their connected cable destinations.</p>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Latitude</label><input type="number" step="any" className="input" placeholder="e.g. 1.3521" value={feasLat} onChange={(e) => setFeasLat(e.target.value)} /></div>
                <div><label className="label">Longitude</label><input type="number" step="any" className="input" placeholder="e.g. 103.8198" value={feasLng} onChange={(e) => setFeasLng(e.target.value)} /></div>
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
                            const map = mapRef.current;
                            if (map) { map.panTo({ lat: r.tj.lat, lng: r.tj.lng }); map.setZoom(16); setSelectedTj(r.tj); }
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
