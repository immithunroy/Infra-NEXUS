import { Cable, TjBox, Splitter, FiberLoop, CableCut } from "../api/types";

const SPLITTER_LOSS_DB: Record<number, number> = { 2: 3.5, 4: 7.0, 8: 10.5, 16: 14.0, 32: 17.5, 64: 20.5 };
function splitterLoss(ratio: number): number { return SPLITTER_LOSS_DB[ratio] ?? 10 * Math.log10(ratio) + 0.5; }

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

// Shared tooltip wrapper — matches Leaflet's default .leaflet-tooltip styling
export function tooltipWrap(inner: string): string {
  return `<div style="background:#fff;color:#334155;padding:4px 10px;border-radius:3px;box-shadow:0 1px 6px rgba(0,0,0,0.35);font-size:12px;line-height:1.45;max-width:280px;white-space:nowrap;pointer-events:none;font-family:system-ui,-apple-system,sans-serif;">${inner}</div>`;
}

export function tjTooltip(tj: TjBox, hostedSplitters: Splitter[]): string {
  let tip = `<b>${tj.unique_id}</b> · ${tj.name}`
    + `<br>${tj.box_type} · ${tj.tj_port} ports`
    + ((tj.box_type === "enclosure" || tj.box_type === "dome") ? ` · ${tj.capacity} cap · ${tj.tray_count} trays` : "")
    + (tj.address ? `<br>${tj.address}` : "");
  if (hostedSplitters.length > 0) {
    tip += `<br><hr style="margin:4px 0;border-color:#475569">`;
    for (const sp of hostedSplitters) {
      const loss = splitterLoss(sp.split_ratio);
      const outCount = sp.output_cores ? sp.output_cores.split(',').length : sp.split_ratio;
      tip += `<span style="color:#f59e0b">▲</span> <b>${sp.unique_id}</b> 1:${sp.split_ratio}`;
      tip += ` · In: core ${sp.input_core || "—"}`;
      tip += ` · Out: ${outCount} ports`;
      tip += ` (${loss.toFixed(1)} dB)`;
      if (sp.name) tip += ` · ${sp.name}`;
      tip += `<br>`;
    }
  }
  tip += `<br><i>click for details</i>`;
  return tooltipWrap(tip);
}

export function cableTooltip(cable: Cable, tjBoxes: TjBox[], loops: FiberLoop[]): string {
  const lenM = cableLengthM(cable);
  const lenKm = (lenM / 1000).toFixed(2);
  const loopSum = loops.filter((l) => l.cable_id === cable.id).reduce((a, l) => a + l.loop_length_m, 0);
  const totalM = lenM + loopSum;
  const dstTj = cable.dst_tj_id ? tjBoxes.find((t) => t.id === cable.dst_tj_id) : null;
  const straightM = dstTj && cable.segments.length ? haversine(cable.segments[0].start_lat, cable.segments[0].start_lng, dstTj.lat, dstTj.lng) : 0;

  const tipParts = [
    cable.link_id ? cable.link_id + " | " + (cable.link_name || cable.code) : `<b>${cable.code}</b>`,
    (cable.manufacturer || "?") + " | " + cable.code,
    cable.core_count + " cores",
  ];
  if (straightM > 0) tipParts.push("Straight: " + (straightM / 1000).toFixed(2) + " km");
  tipParts.push("Link: " + lenKm + " km");
  if (loopSum > 0) tipParts.push("Loop: " + (loopSum / 1000).toFixed(2) + " km");
  tipParts.push("Total: " + (totalM / 1000).toFixed(2) + " km");
  tipParts.push("<i>click for details</i>");

  return tooltipWrap(tipParts.join("<br>"));
}

export function splitterTooltip(sp: Splitter): string {
  const loss = splitterLoss(sp.split_ratio);
  const outCount = sp.output_cores ? sp.output_cores.split(',').length : sp.split_ratio;
  let tip = `<b>${sp.unique_id}</b> · ${sp.name || "Splitter"}`;
  tip += `<br>1:${sp.split_ratio} · Loss: ${loss.toFixed(1)} dB`;
  tip += `<br>In: core ${sp.input_core || "—"}`;
  tip += ` · Out: ${outCount} ports`;
  tip += `<br><i>click for details</i>`;
  return tooltipWrap(tip);
}

export function loopTooltip(loop: FiberLoop): string {
  return tooltipWrap(
    "<b>Fiber Loop</b>"
    + (loop.loop_length_m ? `<br>${loop.loop_length_m}m slack` : "")
    + (loop.notes ? `<br>${loop.notes}` : "")
    + "<br><i>click for details</i>"
  );
}

export function cutTooltip(cut: CableCut): string {
  return tooltipWrap(
    "<b>" + (cut.status === "repaired" ? "Repaired" : "CABLE CUT") + "</b>"
    + (cut.splice_tj_name ? `<br>Splice at: ${cut.splice_tj_name}` : "")
    + (cut.notes ? `<br>${cut.notes}` : "")
    + "<br><i>click for details</i>"
  );
}

export function userTooltip(p: { subscriber?: string; name?: string; serial?: string; status: string; pon_port?: string; rx_power?: number | null; address?: string; last_seen?: string | null; bound?: boolean }, fmtTimeShort: (v: string | null | undefined) => string): string {
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
  parts.push("<br><i>click for details</i>");
  return tooltipWrap(parts.join("<br>"));
}

export function nocTooltip(noc: any): string {
  const deviceList = (noc.devices || []).map((d: any) =>
    `<div style="font-size:11px">${d.name} <span style="color:${d.status === "reachable" ? "#22c55e" : "#ef4444"}">${d.status}</span></div>`
  ).join("");
  return tooltipWrap(`<b>${noc.name}</b><br>${noc.address || ""}<br>${noc.device_count || 0} device(s)<br>${deviceList}`);
}

export function popTooltip(pop: any): string {
  const deviceList = (pop.devices || []).map((d: any) =>
    `<div style="font-size:11px">${d.name} <span style="color:${d.status === "reachable" ? "#22c55e" : "#ef4444"}">${d.status}</span></div>`
  ).join("");
  return tooltipWrap(`<b>${pop.name}</b><br>${pop.address || ""}<br>${pop.device_count || 0} device(s)<br>${deviceList}`);
}
