import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api/client";
import { MapPoint, MapPointResponse } from "../api/types";
import SubscriberLink from "../components/SubscriberLink";
import StatusBadge from "../components/StatusBadge";
import { fmtTimeShort } from "../lib/time";
import { useUserRole } from "../lib/role";
import { canWrite } from "../api/types";

const statusColor: Record<string, string> = {
  pppoe: "#22c55e",
  up: "#22c55e",
  power_off: "#f97316",
  wire_down: "#ef4444",
  inactive: "#f97316",
  offline: "#f97316",
  unknown: "#6b7280",
  lost: "#a855f7",
  llid_admin_down: "#3b82f6",
};

const statusLabel: Record<string, string> = {
  pppoe: "Online",
  up: "Online",
  power_off: "Offline",
  wire_down: "Wire Down",
  inactive: "Offline",
  offline: "Offline",
  unknown: "Unknown",
  lost: "Lost",
  llid_admin_down: "LLID Admin Down",
};

// Default view: Barishal city, Bangladesh.
const CITY_LAT = 22.7;
const CITY_LNG = 90.3667;

function buildIcon(color: string, blink: boolean) {
  const anim = blink ? "animation:blink 1s ease-in-out infinite;" : "";
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">'
    + '<style>@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}</style>'
    + '<circle cx="8" cy="8" r="7" fill="' + color + '" stroke="white" stroke-width="2" style="' + anim + '"/>'
    + '</svg>';
  return L.divIcon({
    className: "",
    html: svg,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function InfoPanel({ p, onClose }: { p: MapPoint; onClose: () => void }) {
  return (
    <div className="pointer-events-auto w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800">
        <span className="font-mono text-sm font-bold text-brand-700 dark:text-cyan-300">{p.pon_port}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="space-y-2.5 px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-900 dark:text-white">{p.name || p.subscriber || "—"}</div>
            {p.olt_name && <div className="text-xs text-slate-500">{p.olt_name}</div>}
          </div>
          <StatusBadge status={p.status} />
        </div>

        {p.subscriber && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">Subscriber</span>
            <SubscriberLink subscriber={p.subscriber} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
            <div className="text-slate-400 dark:text-slate-500">Serial</div>
            <div className="truncate font-mono text-slate-700 dark:text-slate-200">{p.serial || "—"}</div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
            <div className="text-slate-400 dark:text-slate-500">RX</div>
            <div className="font-mono text-slate-700 dark:text-slate-200">
              {p.rx_power != null ? `${p.rx_power.toFixed(1)} dBm` : "—"}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
            <div className="text-slate-400 dark:text-slate-500">GPS</div>
            <div className="font-mono text-slate-700 dark:text-slate-200">
              {p.gps_lat.toFixed(6)}, {p.gps_lng.toFixed(6)}
            </div>
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
            <div className="text-slate-400 dark:text-slate-500">Status</div>
            <div className="text-slate-700 dark:text-slate-200">{statusLabel[p.status] || p.status}</div>
          </div>
        </div>

        {p.down_reason && (
          <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <span className="font-semibold">Deregistered:</span>
            <span>{p.down_reason}</span>
          </div>
        )}

        {p.address && <div className="text-xs text-slate-500">{p.address}</div>}
        {p.gps_accuracy != null && (
          <div className="text-[11px] text-slate-400 dark:text-slate-500">
            GPS accuracy ±{p.gps_accuracy.toFixed(2)} m{p.gps_accuracy >= 9 ? " (exceeds 9 m limit)" : " (OK)"}
          </div>
        )}
        {p.last_seen && (
          <div className="text-[11px] text-slate-400 dark:text-slate-500">Last seen {fmtTimeShort(p.last_seen)}</div>
        )}
      </div>
    </div>
  );
}

function MapView({
  points,
  center,
  onSelect,
  selected,
  isFullscreen,
  onToggleFullscreen,
  onAddGps,
}: {
  points: MapPoint[];
  center: { lat: number; lng: number };
  onSelect: (p: MapPoint | null) => void;
  selected: MapPoint | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onAddGps: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onAddRef = useRef(onAddGps);
  onAddRef.current = onAddGps;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { center: [CITY_LAT, CITY_LNG], zoom: 13 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on("click", () => onSelectRef.current(null));

    map.on("contextmenu", (e: L.LeafletMouseEvent) => {
      const old = map.getContainer().querySelector(".ctx-menu");
      if (old) old.remove();

      const pt = map.latLngToContainerPoint(e.latlng);
      const menu = document.createElement("div");
      menu.className = "ctx-menu";
      menu.style.cssText = "position:absolute;z-index:9999;background:#1e293b;border-radius:8px;padding:4px 0;box-shadow:0 4px 16px rgba(0,0,0,.4);min-width:180px;left:" + pt.x + "px;top:" + pt.y + "px;";
      menu.innerHTML = '<div style="padding:6px 12px;color:#94a3b8;font-size:11px;font-weight:600">' + e.latlng.lat.toFixed(6) + ", " + e.latlng.lng.toFixed(6) + "</div>"
        + '<div class="ctx-i" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>'
        + "Add Subscriber GPS</div>"
        + '<div class="ctx-i" style="padding:7px 12px;color:#e2e8f0;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:8px" onmouseover="this.style.background=\'#334155\'" onmouseout="this.style.background=\'transparent\'">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>'
        + "Copy Coordinates</div>";
      map.getContainer().appendChild(menu);
      L.DomEvent.disableClickPropagation(menu);

      const items = menu.querySelectorAll(".ctx-i");
      items[0].addEventListener("click", () => {
        onAddRef.current(e.latlng.lat, e.latlng.lng);
        menu.remove();
      });
      items[1].addEventListener("click", () => {
        navigator.clipboard.writeText(e.latlng.lat.toFixed(6) + ", " + e.latlng.lng.toFixed(6));
        menu.remove();
      });
      map.once("click", () => menu.remove());
    });

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    map.invalidateSize();
    layer.clearLayers();
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map((p) => [p.gps_lat, p.gps_lng] as [number, number]));
      map.fitBounds(bounds.pad(0.1), { maxZoom: 14 });
    } else {
      map.setView([center.lat, center.lng], 13);
    }
    for (const p of points) {
      const color = statusColor[p.status] || statusColor.unknown;
      const blink = p.status === "wire_down" || p.status === "lost" || p.status === "llid_admin_down";
      const icon = buildIcon(color, blink);
      const marker = L.marker([p.gps_lat, p.gps_lng], { icon });
      const statusTxt = statusLabel[p.status] || p.status;
      marker.bindTooltip(
        '<div style="font-size:12px;font-weight:700;white-space:nowrap">' + (p.subscriber || "—") + '</div>'
        + '<div style="font-size:11px;color:#475569;white-space:nowrap">' + (p.name || "—") + (p.serial ? " · " + p.serial : "") + '</div>'
        + '<div style="font-size:11px;font-weight:600;color:' + color + '">' + statusTxt
        + (p.rx_power != null ? " · " + p.rx_power.toFixed(1) + " dBm" : "")
        + '</div>',
        { sticky: true, className: "" }
      );
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        onSelectRef.current(p);
      });
      marker.addTo(layer);
    }
  }, [points, center]);

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="w-full h-full" style={{ minHeight: "400px" }} />
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
      {selected && (
        <div className="pointer-events-none absolute bottom-16 left-4 z-[500]">
          <InfoPanel p={selected} onClose={() => onSelect(null)} />
        </div>
      )}
    </div>
  );
}

export default function NetworkMap() {
  const { role } = useUserRole();
  const writeOk = canWrite(role);
  const [data, setData] = useState<MapPointResponse | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<MapPoint | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [gpsForm, setGpsForm] = useState<{ lat: number; lng: number } | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterText, setFilterText] = useState("");
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [editUser, setEditUser] = useState<MapPoint | null>(null);
  const [editForm, setEditForm] = useState({ address: "", gps_lat: 0, gps_lng: 0 });

  const load = useCallback(() => {
    api
      .get<MapPointResponse>("/map/points")
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  const center = useMemo(
    () => ({
      lat: data?.city_lat || CITY_LAT,
      lng: data?.city_lng || CITY_LNG,
    }),
    [data]
  );

  const filteredPoints = useMemo(() => {
    let pts = data?.points || [];
    if (filterStatus !== "all") {
      pts = pts.filter((p) => {
        if (filterStatus === "online") return p.status === "pppoe" || p.status === "up";
        if (filterStatus === "offline") return p.status === "power_off" || p.status === "inactive" || p.status === "offline";
        if (filterStatus === "wire_down") return p.status === "wire_down";
        if (filterStatus === "unknown") return p.status === "unknown";
        if (filterStatus === "lost") return p.status === "lost";
        if (filterStatus === "llid_admin_down") return p.status === "llid_admin_down";
        return true;
      });
    }
    if (filterText) {
      const q = filterText.toLowerCase();
      pts = pts.filter((p) =>
        (p.name || "").toLowerCase().includes(q)
        || (p.subscriber || "").toLowerCase().includes(q)
        || (p.serial || "").toLowerCase().includes(q)
      );
    }
    return pts;
  }, [data, filterStatus, filterText]);

  const sidebarPoints = useMemo(() => {
    if (!sidebarSearch) return filteredPoints;
    const q = sidebarSearch.toLowerCase();
    return filteredPoints.filter((p) =>
      (p.name || "").toLowerCase().includes(q)
      || (p.subscriber || "").toLowerCase().includes(q)
      || (p.serial || "").toLowerCase().includes(q)
      || (p.pon_port || "").toLowerCase().includes(q)
      || (p.address || "").toLowerCase().includes(q)
    );
  }, [filteredPoints, sidebarSearch]);

  const statusSummary = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of data?.points || []) c[p.status] = (c[p.status] || 0) + 1;
    return c;
  }, [data]);

  return (
    <div className={isFullscreen ? "fixed inset-0 z-[9998] bg-white dark:bg-slate-900 flex flex-col" : "flex flex-col relative"} style={{ zIndex: 1, height: isFullscreen ? "100vh" : "calc(100vh - 4rem)" }}>
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 shrink-0">
        {!isFullscreen && <h1 className="text-lg font-bold text-slate-900 dark:text-white whitespace-nowrap mr-1">User Map</h1>}
        <select className="input w-28 text-xs py-1" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">All Status</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="wire_down">Wire Down</option>
          <option value="unknown">Unknown</option>
          <option value="lost">Lost</option>
          <option value="llid_admin_down">LLID Admin Down</option>
        </select>
        <input className="input flex-1 min-w-[120px] text-xs py-1" placeholder="Search..." value={filterText} onChange={(e) => setFilterText(e.target.value)} />
        <span className="text-[10px] text-slate-400 whitespace-nowrap">{filteredPoints.length}/{data?.points?.length || 0}</span>
      </div>

      {error && <div className="px-3 py-1 text-xs text-red-600 shrink-0">{error}</div>}

      {/* Main content: map + sidebar */}
      <div className="flex-1 flex min-h-0">
        {/* Map fills remaining space */}
        <div className="flex-1 relative min-h-0" style={{ zIndex: 2 }}>
          <MapView
            points={filteredPoints}
            center={center}
            onSelect={setSelected}
            selected={selected}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
            onAddGps={(lat, lng) => setGpsForm({ lat, lng })}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-[320px] shrink-0 border-l border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-y-auto flex flex-col">
          {/* Status summary */}
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
            <div className="flex flex-wrap gap-2 text-[10px]">
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400"><span className="h-2 w-2 rounded-full" style={{ background: "#22c55e" }} />Online {statusSummary.pppoe || 0}</span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400"><span className="h-2 w-2 rounded-full" style={{ background: "#f97316" }} />Offline {((statusSummary.power_off || 0) + (statusSummary.inactive || 0) + (statusSummary.offline || 0))}</span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400"><span className="h-2 w-2 rounded-full" style={{ background: "#ef4444" }} />Wire Down {statusSummary.wire_down || 0}</span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400"><span className="h-2 w-2 rounded-full" style={{ background: "#6b7280" }} />Unknown {statusSummary.unknown || 0}</span>
              <span className="flex items-center gap-1 text-slate-600 dark:text-slate-400"><span className="h-2 w-2 rounded-full" style={{ background: "#a855f7" }} />Lost {statusSummary.lost || 0}</span>
            </div>
          </div>

          {/* Search */}
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
            <input className="input text-xs py-1 w-full" placeholder="Search user, subscriber, serial, port..." value={sidebarSearch} onChange={(e) => setSidebarSearch(e.target.value)} />
          </div>

          {/* User list */}
          <div className="flex-1 overflow-y-auto">
            {sidebarPoints.length > 0 ? sidebarPoints.map((p) => {
              const color = statusColor[p.status] || statusColor.unknown;
              return (
                <div key={p.onu_id} className={`px-3 py-2 border-b border-slate-100 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition ${selected?.onu_id === p.onu_id ? "bg-blue-50 dark:bg-blue-900/20" : ""}`} onClick={() => setSelected(p)}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{p.subscriber || p.name || "—"}</div>
                      <div className="text-[10px] text-slate-500 truncate">{p.name || "—"} · {p.pon_port}</div>
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: color + "22", color }}>{p.status}</span>
                  </div>
                  {p.address && <div className="text-[10px] text-slate-400 mt-0.5 truncate">{p.address}</div>}
                </div>
              );
            }) : <div className="px-3 py-4 text-xs text-slate-400 text-center">No users found</div>}
          </div>

          {/* Selected user detail */}
          {selected && (
            <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-3 bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white">{selected.subscriber || selected.name}</h3>
                <button className="text-[10px] text-slate-400 hover:text-slate-600" onClick={() => setSelected(null)}>✕</button>
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between"><span className="text-slate-500">Status</span><StatusBadge status={selected.status} /></div>
                <div className="flex justify-between"><span className="text-slate-500">ONU Name</span><span className="font-mono">{selected.name || "—"}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">PON Port</span><span className="font-mono">{selected.pon_port}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">OLT</span><span className="font-mono">{selected.olt_name || "—"}</span></div>
                {selected.serial && <div className="flex justify-between"><span className="text-slate-500">Serial</span><span className="font-mono">{selected.serial}</span></div>}
                {selected.rx_power != null && <div className="flex justify-between"><span className="text-slate-500">RX Power</span><span className="font-mono">{selected.rx_power.toFixed(1)} dBm</span></div>}
                <div className="flex justify-between"><span className="text-slate-500">GPS</span><span className="font-mono">{selected.gps_lat?.toFixed(6) || "—"}, {selected.gps_lng?.toFixed(6) || "—"}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Address</span><span className="text-right max-w-[150px] truncate">{selected.address || "—"}</span></div>
                {selected.last_seen && <div className="flex justify-between"><span className="text-slate-500">Last Seen</span><span>{fmtTimeShort(selected.last_seen)}</span></div>}
              </div>
              {selected.down_reason && <div className="mt-2 rounded-md bg-rose-50 dark:bg-rose-950/40 px-2 py-1 text-[10px] text-rose-700 dark:text-rose-300">{selected.down_reason}</div>}
              <div className="flex gap-1 mt-2">
                <SubscriberLink subscriber={selected.subscriber} />
                {writeOk && <button className="btn-secondary text-[10px] py-0.5 px-2" onClick={() => { setEditUser(selected); setEditForm({ address: selected.address || "", gps_lat: selected.gps_lat || 0, gps_lng: selected.gps_lng || 0 }); }}>Edit GPS/Address</button>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* GPS form modal */}
      {gpsForm && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setGpsForm(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">Add Subscriber GPS</h2>
            <div className="space-y-3">
              <div><label className="label">Latitude</label><input type="number" step="any" className="input" value={gpsForm.lat} onChange={(e) => setGpsForm({ ...gpsForm, lat: Number(e.target.value) })} /></div>
              <div><label className="label">Longitude</label><input type="number" step="any" className="input" value={gpsForm.lng} onChange={(e) => setGpsForm({ ...gpsForm, lng: Number(e.target.value) })} /></div>
              <p className="text-xs text-slate-500">Assign this GPS coordinate to a subscriber from the Subscribers page.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setGpsForm(null)}>Cancel</button>
                <button className="btn-primary" onClick={() => { navigator.clipboard.writeText(gpsForm.lat.toFixed(6) + ", " + gpsForm.lng.toFixed(6)); setGpsForm(null); }}>Copy & Close</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit user GPS/Address modal */}
      {editUser && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setEditUser(null)}>
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-bold">Edit {editUser.subscriber || editUser.name}</h2>
            <div className="space-y-3">
              <div><label className="label">Address</label><input className="input" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Latitude</label><input type="number" step="any" className="input" value={editForm.gps_lat} onChange={(e) => setEditForm({ ...editForm, gps_lat: Number(e.target.value) })} /></div>
                <div><label className="label">Longitude</label><input type="number" step="any" className="input" value={editForm.gps_lng} onChange={(e) => setEditForm({ ...editForm, gps_lng: Number(e.target.value) })} /></div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn-secondary" onClick={() => setEditUser(null)}>Cancel</button>
                <button className="btn-primary" onClick={async () => {
                  try {
                    await api.put(`/onus/${editUser.onu_id}`, { address: editForm.address, gps_lat: editForm.gps_lat, gps_lng: editForm.gps_lng });
                    setEditUser(null);
                    load();
                  } catch (e) { alert(String(e)); }
                }}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
