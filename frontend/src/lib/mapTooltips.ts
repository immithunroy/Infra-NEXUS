import { Cable, TjBox, Splitter, FiberLoop, CableCut } from "../api/types";

export function fmtM(m: number): string { return Math.round(m).toLocaleString() + " m"; }
export function kmToM(km: number | null): number | null { return km != null ? Math.round(km * 1000) : null; }

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

function rxPowerStyle(rx: number | null | undefined): string {
  if (rx == null) return "color:#94a3b8;font-weight:600;";
  if (rx >= -18) return "color:#16a34a;font-weight:700;";
  if (rx >= -22) return "color:#22c55e;font-weight:600;";
  if (rx >= -26) return "color:#eab308;font-weight:600;";
  if (rx >= -28) return "color:#f97316;font-weight:700;";
  return "color:#ef4444;font-weight:700;";
}

function rxPowerLabel(rx: number | null | undefined): string {
  if (rx == null) return "—";
  if (rx >= -18) return "Strong";
  if (rx >= -22) return "Good";
  if (rx >= -26) return "Fair";
  if (rx >= -28) return "Weak";
  return "Critical";
}

// Shared tooltip wrapper with optional title bar — Open Sans font
const FONT = 'font-family:"Open Sans",system-ui,-apple-system,sans-serif;';

export function tooltipWrap(inner: string, title?: string): string {
  const header = title
    ? `<div style="background:#1e293b;color:#f1f5f9;padding:6px 10px;font-size:12px;font-weight:600;${FONT}border-bottom:1px solid #334155;">${title}</div>`
    : '';
  return `<div style="background:#fff;color:#334155;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.3);font-size:12px;line-height:1.5;max-width:300px;white-space:nowrap;pointer-events:none;${FONT}overflow:hidden;">${header}<div style="padding:6px 10px;">${inner}</div></div>`;
}

export function tjTooltip(tj: TjBox, hostedSplitters: Splitter[]): string {
  let tip = `<b>${tj.unique_id}</b> · ${tj.name}`
    + `<br>${tj.box_type} · ${tj.tj_port} ports`
    + ((tj.box_type === "enclosure" || tj.box_type === "dome") ? ` · ${tj.capacity} cap · ${tj.tray_count} trays` : "")
    + (tj.address ? `<br><span style="color:#64748b">${tj.address}</span>` : "");
  if (hostedSplitters.length > 0) {
    tip += `<br><hr style="margin:4px 0;border-color:#e2e8f0">`;
    for (const sp of hostedSplitters) {
      const loss = splitterLoss(sp.split_ratio);
      const outCount = sp.output_cores ? sp.output_cores.split(',').length : sp.split_ratio;
      tip += `<span style="color:#f59e0b">▲</span> <b>${sp.unique_id}</b> 1:${sp.split_ratio}`;
      tip += ` · In: core ${sp.input_core || "—"}`;
      tip += ` · Out: ${outCount} ports`;
      tip += ` <span style="color:#64748b">(${loss.toFixed(1)} dB)</span>`;
      if (sp.name) tip += ` · ${sp.name}`;
      tip += `<br>`;
    }
  }
  tip += `<br><i style="color:#94a3b8">click for details</i>`;
  return tooltipWrap(tip, `${tj.unique_id} — TJ Box`);
}

export function cableTooltip(cable: Cable, tjBoxes: TjBox[], loops: FiberLoop[]): string {
  const lenM = cableLengthM(cable);
  const loopSum = loops.filter((l) => l.cable_id === cable.id).reduce((a, l) => a + l.loop_length_m, 0);
  const totalM = lenM + loopSum;
  const dstTj = cable.dst_tj_id ? tjBoxes.find((t) => t.id === cable.dst_tj_id) : null;
  const straightM = dstTj && cable.segments.length ? haversine(cable.segments[0].start_lat, cable.segments[0].start_lng, dstTj.lat, dstTj.lng) : 0;

  const tipParts = [
    `<b>${cable.link_id || cable.code}</b> <span style="color:#64748b">| ${cable.manufacturer || "?"} | ${cable.code}</span>`,
    cable.link_name || "",
  ];
  if (straightM > 0) tipParts.push(`<span style="color:#64748b">Straight:</span> ${fmtM(straightM)}`);
  tipParts.push(`<span style="color:#64748b">Link:</span> ${fmtM(lenM)}`);
  if (loopSum > 0) tipParts.push(`<span style="color:#64748b">Loop:</span> ${fmtM(loopSum)}`);
  tipParts.push(`<b>Total:</b> ${fmtM(totalM)}`);
  tipParts.push(`<br><i style="color:#94a3b8">click for details</i>`);

  return tooltipWrap(tipParts.join("<br>"), `${cable.link_id || cable.code} — Link`);
}

export function splitterTooltip(sp: Splitter): string {
  const loss = splitterLoss(sp.split_ratio);
  const outCount = sp.output_cores ? sp.output_cores.split(',').length : sp.split_ratio;
  let tip = `<b>${sp.unique_id}</b> · ${sp.name || "Splitter"}`;
  tip += `<br>1:${sp.split_ratio} · Loss: ${loss.toFixed(1)} dB`;
  tip += `<br>In: core ${sp.input_core || "—"}`;
  tip += ` · Out: ${outCount} ports`;
  tip += `<br><i style="color:#94a3b8">click for details</i>`;
  return tooltipWrap(tip, `${sp.unique_id} — Splitter`);
}

export function loopTooltip(loop: FiberLoop): string {
  let tip = "";
  if (loop.loop_length_m) tip += `${loop.loop_length_m}m slack`;
  if (loop.notes) tip += (tip ? "<br>" : "") + `<span style="color:#64748b">${loop.notes}</span>`;
  tip += (tip ? "<br><br>" : "") + `<i style="color:#94a3b8">click for details</i>`;
  return tooltipWrap(tip, "Fiber Loop");
}

export function cutTooltip(cut: CableCut): string {
  const isRepaired = cut.status === "repaired";
  let tip = "";
  if (cut.splice_tj_name) tip += `Splice at: ${cut.splice_tj_name}`;
  if (cut.notes) tip += (tip ? "<br>" : "") + `<span style="color:#64748b">${cut.notes}</span>`;
  tip += (tip ? "<br><br>" : "") + `<i style="color:#94a3b8">click for details</i>`;
  return tooltipWrap(tip, isRepaired ? "Repaired" : "Cable Cut");
}

export function userTooltip(p: { subscriber?: string; name?: string; serial?: string; status: string; pon_port?: string; olt_name?: string; rx_power?: number | null; distance?: number | null; address?: string; last_seen?: string | null; bound?: boolean }, fmtTimeShort: (v: string | null | undefined) => string): string {
  const rxStyle = rxPowerStyle(p.rx_power);
  const rxLabel = rxPowerLabel(p.rx_power);
  const rxStr = p.rx_power != null ? `${p.rx_power} dBm` : "—";
  const distStr = p.distance != null ? fmtM(p.distance * 1000) : "—";

  const parts = [
    `ONU: <b>${p.name || "—"}</b>`,
    `Serial: ${p.serial || "—"}`,
    `Status: ${p.status}`,
    `OLT: ${p.olt_name || "N/A"}`,
    `PON: ${p.pon_port || "—"}`,
    `RX: <span style="${rxStyle}">${rxStr} ${rxLabel}</span>`,
    `Distance: ${distStr}`,
    `Address: <span style="color:#64748b">${p.address || "—"}</span>`,
  ];
  if (p.last_seen) parts.push(`Last: ${fmtTimeShort(p.last_seen)}`);
  if (!p.bound) parts.push(`<span style="color:#ef4444;font-weight:600">⚠ Unbound</span>`);
  parts.push(`<br><i style="color:#94a3b8">click for details</i>`);

  let title: string;
  if (!p.bound) {
    title = "User — Unbound";
  } else if (p.subscriber) {
    title = `User — ${p.subscriber}`;
  } else if (p.name) {
    title = `User — ${p.name}`;
  } else {
    title = "User";
  }

  return tooltipWrap(parts.join("<br>"), title);
}

export function nocTooltip(noc: any): string {
  const deviceList = (noc.devices || []).map((d: any) =>
    `<div style="font-size:11px">${d.name} <span style="color:${d.status === "reachable" ? "#16a34a" : "#ef4444"};font-weight:600">${d.status}</span></div>`
  ).join("");
  return tooltipWrap(`${noc.address || ""}<br>${noc.device_count || 0} device(s)<br>${deviceList}`, `${noc.name} — NOC`);
}

export function popTooltip(pop: any): string {
  const deviceList = (pop.devices || []).map((d: any) =>
    `<div style="font-size:11px">${d.name} <span style="color:${d.status === "reachable" ? "#16a34a" : "#ef4444"};font-weight:600">${d.status}</span></div>`
  ).join("");
  return tooltipWrap(`${pop.address || ""}<br>${pop.device_count || 0} device(s)<br>${deviceList}`, `${pop.name} — POP`);
}
