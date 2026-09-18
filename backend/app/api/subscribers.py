from datetime import timedelta, timezone
import io
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import AcsDevice, AcsParameter, MikrotikDevice, Onu, OnuMacHistory, OnuSubscriber, OnuTelemetry, PppActiveEntry, Subscriber, Ticket, TicketStatus, User
from ..utils.time import utcnow
from ..security import get_current_user, user_role
from ..services.mac_vendor import vendor_map
from ..services.remote_probe import probe_ips
from ..services import acs as acs_service
from ..services import router_wifi
from ..utils.status import display_status
from ..schemas import (
    AcsWifiStatusOut,
    MacHistoryEntry,
    RemoteAccess,
    SubscriberProfile,
    SubscriberSummary,
    TelemetryPoint,
    TrafficSample,
    TrafficSession,
)
from pydantic import BaseModel


class RemoteProbeRequest(BaseModel):
    ips: list[str] = []

router = APIRouter(
    prefix="/api/subscribers", tags=["subscribers"], dependencies=[Depends(get_current_user)]
)


async def _acs_map(db: AsyncSession) -> dict[int, int]:
    """Map onu_id -> first matching ACS device id (TR-069 registered routers)."""
    rows = (
        await db.execute(select(AcsDevice.onu_id, AcsDevice.id).where(AcsDevice.onu_id.is_not(None)))
    ).all()
    return {onu_id: dev_id for onu_id, dev_id in rows}

# Largest delta between two byte counters for which a bandwidth rate is still
# meaningful. Beyond this the sample pair spans too long to represent live use.
_MAX_RATE_DT_SECONDS = 1800


def _telemetry_points(rows: list[OnuTelemetry]) -> list[TelemetryPoint]:
    """Convert telemetry rows to API points, deriving bandwidth (Mbps).

    Rates come from the delta of consecutive byte counters divided by the time
    between samples; the first point of a run has no predecessor so it is null.
    """
    points: list[TelemetryPoint] = []
    prev: OnuTelemetry | None = None
    for t in rows:
        rx_mbps: float | None = None
        tx_mbps: float | None = None
        if (
            prev is not None
            and t.in_octets is not None
            and t.out_octets is not None
            and prev.in_octets is not None
            and prev.out_octets is not None
        ):
            dt = (t.sampled_at - prev.sampled_at).total_seconds()
            if 0 < dt <= _MAX_RATE_DT_SECONDS:
                d_in = t.in_octets - prev.in_octets
                d_out = t.out_octets - prev.out_octets
                # 32-bit counter wrap: add one wrap of the Counter32 range.
                if d_in < 0:
                    d_in += 1 << 32
                if d_out < 0:
                    d_out += 1 << 32
                rx_mbps = max(d_in, 0) * 8 / dt / 1e6
                tx_mbps = max(d_out, 0) * 8 / dt / 1e6
        points.append(
            TelemetryPoint(
                sampled_at=t.sampled_at,
                rx_power=t.rx_power,
                tx_power=t.tx_power,
                rx_mbps=rx_mbps,
                tx_mbps=tx_mbps,
            )
        )
        prev = t
    return points


@router.get("", response_model=list[SubscriberSummary])
async def list_subscribers(
    q: str | None = Query(default=None),
    status: str | None = Query(default=None, description="connected|disconnected|disabled"),
    sort: str | None = Query(default=None, description="subscriber|status"),
    order: str = Query(default="asc", description="asc|desc"),
    limit: int = Query(default=500, le=2000),
    db: AsyncSession = Depends(get_db),
):
    """List subscribers sourced from MikroTik PPPoE secrets.

    Every secret synced by the periodic scan appears here immediately,
    regardless of whether a PPPoE session is active or an ONU is bound.

    status filter:
      - omitted/all: all non-deleted secrets
      - connected: currently has an active PPPoE session
      - disconnected: secret exists but no active session, not disabled
      - disabled: subscriber marked as disabled/billing-expired
    """
    # Source of truth: subscribers table (MikroTik secrets)
    sel = (
        select(Subscriber)
        .where(Subscriber.is_deleted == False)  # noqa: E712
    )

    # Status filtering
    if status == "disabled":
        sel = sel.where(Subscriber.disabled == True)  # noqa: E712
    elif status == "connected":
        # Only secrets that have an active PPPoE session
        active_subq = (
            select(PppActiveEntry.subscriber)
            .group_by(PppActiveEntry.subscriber)
            .subquery()
        )
        sel = sel.where(Subscriber.pppoe_username.in_(select(active_subq.c.subscriber)))
    elif status == "disconnected":
        # Secrets without active session, not disabled
        active_subq = (
            select(PppActiveEntry.subscriber)
            .group_by(PppActiveEntry.subscriber)
            .subquery()
        )
        sel = sel.where(
            Subscriber.disabled == False,  # noqa: E712
            ~Subscriber.pppoe_username.in_(select(active_subq.c.subscriber)),
        )

    # Text search
    if q:
        like = f"%{q}%"
        sel = sel.where(Subscriber.pppoe_username.ilike(like))

    # Sorting
    if sort == "status":
        sel = sel.order_by(Subscriber.disabled.desc(), Subscriber.pppoe_username.asc())
    else:
        sel = sel.order_by(Subscriber.pppoe_username.desc() if order == "desc" else Subscriber.pppoe_username.asc())

    sel = sel.limit(limit)
    subs = (await db.execute(sel)).scalars().all()

    if not subs:
        return []

    usernames = [s.pppoe_username for s in subs]

    # Find active PPPoE sessions for these subscribers
    active_sessions = (
        await db.execute(
            select(PppActiveEntry.subscriber, PppActiveEntry.mac, PppActiveEntry.ip, PppActiveEntry.interface)
            .where(PppActiveEntry.subscriber.in_(usernames))
            .group_by(PppActiveEntry.subscriber, PppActiveEntry.mac, PppActiveEntry.ip, PppActiveEntry.interface)
        )
    ).all()
    active_map: dict[str, dict] = {}
    for row in active_sessions:
        active_map[row.subscriber] = {"mac": row.mac, "ip": row.ip, "interface": row.interface}

    # Find matching ONUs for these subscribers via two paths:
    # 1. Onu.subscriber (primary subscriber, backward compat)
    # 2. onu_subscribers table (multi-subscriber ONUs via switch)
    onu_rows = (
        await db.execute(
            select(Onu).options(selectinload(Onu.olt)).where(Onu.subscriber.in_(usernames))
        )
    ).scalars().all()
    onu_map: dict[str, Onu] = {o.subscriber: o for o in onu_rows}

    # Check onu_subscribers for additional bindings
    onu_sub_rows = (
        await db.execute(
            select(OnuSubscriber.onu_id, OnuSubscriber.pppoe_username)
            .where(OnuSubscriber.pppoe_username.in_(usernames))
        )
    ).all()
    # Map: pppoe_username -> onu_id (from onu_subscribers)
    onu_sub_map: dict[str, int] = {}
    onu_ids_from_sub = set()
    for row in onu_sub_rows:
        onu_sub_map[row.pppoe_username] = row.onu_id
        onu_ids_from_sub.add(row.onu_id)

    # Fetch ONUs that are only in onu_subscribers (not in onu_map yet)
    extra_onu_ids = onu_ids_from_sub - {o.id for o in onu_rows}
    if extra_onu_ids:
        extra_onus = (
            await db.execute(
                select(Onu).options(selectinload(Onu.olt)).where(Onu.id.in_(extra_onu_ids))
            )
        ).scalars().all()
        for o in extra_onus:
            onu_map.setdefault(o.subscriber, o)  # Don't overwrite existing

    # Combine all onu_ids for MAC history and vendor lookup
    all_onu_ids = list({o.id for o in onu_rows} | onu_ids_from_sub)
    counts: dict[int, int] = {}
    if all_onu_ids:
        rows = (
            await db.execute(
                select(OnuMacHistory.onu_id, func.count())
                .where(OnuMacHistory.onu_id.in_(all_onu_ids))
                .group_by(OnuMacHistory.onu_id)
            )
        ).all()
        counts = {onu_id: c for onu_id, c in rows}

    # MAC vendor lookup — collect MACs from all ONUs involved
    macs = []
    for oid in all_onu_ids:
        onu_obj = next((o for o in onu_rows if o.id == oid), None)
        if onu_obj and onu_obj.last_mac:
            macs.append(onu_obj.last_mac)
    for s in active_sessions:
        if s.mac:
            macs.append(s.mac)
    vendors = await vendor_map(db, macs) if macs else {}

    # ACS mapping
    acs_by_onu = await _acs_map(db)

    # Build onu_id lookup for each subscriber (check both maps)
    def _get_onu(uname: str) -> Onu | None:
        # Direct ONU match (primary subscriber)
        if uname in onu_map:
            return onu_map[uname]
        # onu_subscribers table match
        if uname in onu_sub_map:
            oid = onu_sub_map[uname]
            # Find the Onu object from extra_onus or onu_rows
            for o in onu_rows:
                if o.id == oid:
                    return o
        return None

    out: list[SubscriberSummary] = []
    for s in subs:
        uname = s.pppoe_username
        o = _get_onu(uname)
        act = active_map.get(uname)

        # Determine status
        is_connected = act is not None
        is_disabled = s.disabled
        onu_bind = o is not None

        if is_disabled:
            display = "disabled"
        elif is_connected:
            display = "connected"
        elif onu_bind:
            state_val = (o.state.value if hasattr(o.state, "value") else str(o.state)) if o else "unknown"
            display = state_val
        else:
            display = "disconnected"

        # MAC: prefer active session MAC, fall back to ONU MAC
        mac = act["mac"] if act else (o.last_mac if o else "")

        # MikroTik IP from ONU, or look up from device
        mikrotik_ip = ""
        if o and o.mikrotik_ip:
            mikrotik_ip = o.mikrotik_ip
        elif s.mikrotik_device_id:
            dev = await db.get(MikrotikDevice, s.mikrotik_device_id)
            if dev:
                mikrotik_ip = dev.ip

        rx_power = o.rx_power if o else None
        tx_power = o.tx_power if o else None

        out.append(
            SubscriberSummary(
                subscriber=uname,
                onu_id=o.id if o else 0,
                onu_name=o.name if o else "",
                olt_name=o.olt.name if o and o.olt else "",
                pon_port=o.pon_port if o else "",
                last_mac=mac,
                mac_vendor=vendors.get(mac.lower(), ""),
                mikrotik_ip=mikrotik_ip,
                state=(o.state.value if hasattr(o.state, "value") else str(o.state)) if o else "",
                bound=o.bound if o else False,
                down_reason=(o.down_reason or "") if o else "",
                status=display,
                disabled=is_disabled,
                connected=is_connected,
                onu_binded=onu_bind,
                acs_device_id=acs_by_onu.get(o.id) if o else None,
                rx_power=rx_power,
                tx_power=tx_power,
                mac_change_count=counts.get(o.id, 0) if o else 0,
                last_seen=o.last_seen if o else (s.last_seen_at),
                phone=(o.phone or "") if o else "",
                mobile2=(o.mobile2 or "") if o else "",
            )
        )
    return out


@router.post("/remote/probe")
async def probe_remote_access(body: RemoteProbeRequest):
    """Probe a batch of IPs for remote management pages (8080/80/443/8443)."""
    results = await probe_ips(body.ips)
    return {"results": results}


@router.get("/{subscriber}/remote", response_model=RemoteAccess)
async def subscriber_remote(subscriber: str, db: AsyncSession = Depends(get_db)):
    """Probe a single subscriber's current IP for remote access."""
    onu = (
        await db.execute(select(Onu).where(Onu.subscriber == subscriber))
    ).scalars().first()
    if onu is None:
        raise HTTPException(status_code=404, detail="Subscriber not found")
    ip = (onu.mikrotik_ip or "").strip()
    if not ip:
        return RemoteAccess(ip="", reachable=False, url="", ports=[], checked_at=0)
    results = await probe_ips([ip])
    data = results[ip]
    return RemoteAccess(**data)


@router.get("/{subscriber}/wifi", response_model=AcsWifiStatusOut)
async def subscriber_wifi(subscriber: str, db: AsyncSession = Depends(get_db)):
    """Read the subscriber's router WiFi config.

    Prefers the ACS (TR-069) reported parameters when the router exposes them;
    otherwise reads the WiFi config directly from the router's web admin using
    the Cudy or TP-Link protocol (whichever management port is open).
    """
    onu = (
        await db.execute(select(Onu).where(Onu.subscriber == subscriber))
    ).scalars().first()
    if onu is None:
        raise HTTPException(status_code=404, detail="Subscriber not found")

    # 1) ACS / TR-069 path — most reliable when the CPE reports WLAN params.
    acs_by_onu = await _acs_map(db)
    acs_id = acs_by_onu.get(onu.id)
    if acs_id is not None:
        rows = (
            await db.execute(
                select(AcsParameter)
                .where(
                    AcsParameter.device_id == acs_id,
                    AcsParameter.name.like("InternetGatewayDevice.LANDevice.1.WLANConfiguration.%"),
                )
                .order_by(AcsParameter.name)
            )
        ).scalars().all()
        if rows:
            return acs_service.build_wifi_status(rows)

    # 2) Direct router web-admin read (Cudy / TP-Link).
    ip = (onu.mikrotik_ip or "").strip()
    if ip:
        result = await router_wifi.read_wifi(ip)
        if result["supported"]:
            return AcsWifiStatusOut(**result)

    return AcsWifiStatusOut(
        supported=False,
        summary=(
            "No WiFi parameters reported via TR-069 and the router's management "
            "page did not answer on 8080/443/80."
            if ip
            else "No router IP assigned to this subscriber."
        ),
    )


@router.get("/{subscriber}/telemetry", response_model=list[TelemetryPoint])
async def subscriber_telemetry(
    subscriber: str,
    hours: int = Query(default=168, le=8760),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Telemetry data with server-side downsampling for long ranges.

    Returns raw 5-min samples for recent data, hourly averages for 7-30d,
    daily averages for 30d-1y. Max ~500 points per response.
    """
    onu = (
        await db.execute(select(Onu.id).where(Onu.subscriber == subscriber))
    ).scalars().first()
    if onu is None:
        raise HTTPException(status_code=404, detail="Subscriber not found")

    since = utcnow() - timedelta(hours=hours)
    rows = (
        await db.execute(
            select(OnuTelemetry)
            .where(OnuTelemetry.onu_id == onu, OnuTelemetry.sampled_at >= since)
            .order_by(OnuTelemetry.sampled_at)
        )
    ).scalars().all()

    if not rows:
        return []

    raw_points = _telemetry_points(rows)

    # Downsample thresholds
    HOUR_7 = 168
    DAY_30 = 720

    if hours <= HOUR_7:
        return _cap(raw_points, 500)

    # For 7d-30d: hourly buckets; for 30d-1y: daily buckets
    bucket_hours = 24 if hours > DAY_30 else 1
    return _downsample(raw_points, bucket_hours, max_points=500)


def _cap(points: list[TelemetryPoint], max_n: int) -> list[TelemetryPoint]:
    """Keep every Nth point if over max_n."""
    if len(points) <= max_n:
        return points
    step = len(points) / max_n
    return [points[int(i * step)] for i in range(max_n)]


def _downsample(points: list[TelemetryPoint], bucket_hours: int, max_points: int = 500) -> list[TelemetryPoint]:
    """Average telemetry points into time buckets."""
    if not points:
        return []

    bucket_seconds = bucket_hours * 3600
    t0 = points[0].sampled_at.replace(tzinfo=timezone.utc) if points[0].sampled_at.tzinfo is None else points[0].sampled_at
    buckets: list[list[TelemetryPoint]] = [[] for _ in range(len(points))]

    idx = 0
    bucket_start = t0.timestamp()
    bucket_end = bucket_start + bucket_seconds

    for p in points:
        ts = p.sampled_at.replace(tzinfo=timezone.utc) if p.sampled_at.tzinfo is None else p.sampled_at
        t = ts.timestamp()
        while t >= bucket_end:
            idx += 1
            bucket_start = bucket_end
            bucket_end += bucket_seconds
            if idx >= len(buckets):
                buckets.append([])
        buckets[idx].append(p)

    result: list[TelemetryPoint] = []
    for b in buckets:
        if not b:
            continue
        n = len(b)
        mid = b[n // 2].sampled_at
        avg = TelemetryPoint(
            sampled_at=mid,
            rx_power=_avg([p.rx_power for p in b if p.rx_power is not None]),
            tx_power=_avg([p.tx_power for p in b if p.tx_power is not None]),
            rx_mbps=_avg([p.rx_mbps for p in b if p.rx_mbps is not None]),
            tx_mbps=_avg([p.tx_mbps for p in b if p.tx_mbps is not None]),
        )
        result.append(avg)

    return _cap(result, max_points)


def _avg(vals: list[float]) -> float | None:
    if not vals:
        return None
    return round(sum(vals) / len(vals), 2)


@router.get("/export")
async def export_users(format: str = Query("xlsx", regex="^(xlsx|json)$"), db: AsyncSession = Depends(get_db)):
    """Export all subscribers with address fields, PPPoE username, MAC history, and router brand."""
    from ..models import OLTDevice

    # Fetch all ONUs with OLT info
    result = await db.execute(
        select(Onu).options(selectinload(Onu.olt)).order_by(Onu.subscriber, Onu.id)
    )
    onus = result.scalars().all()

    # Collect all MACs for vendor lookup
    all_macs = set()
    for onu in onus:
        if onu.last_mac:
            all_macs.add(onu.last_mac.lower())
    # Also collect historical MACs
    mac_history_result = await db.execute(select(OnuMacHistory))
    mac_history_rows = mac_history_result.scalars().all()
    for mh in mac_history_rows:
        if mh.mac:
            all_macs.add(mh.mac.lower())

    # Resolve vendors
    vendors = await vendor_map(db, all_macs)

    # Build export data
    rows = []
    for onu in onus:
        # Get MAC history for this ONU
        history_result = await db.execute(
            select(OnuMacHistory).where(OnuMacHistory.onu_id == onu.id).order_by(OnuMacHistory.changed_at.desc())
        )
        history = history_result.scalars().all()

        # Current MAC info
        current_mac = onu.last_mac or onu.mac
        current_brand = vendors.get(current_mac.lower(), "") if current_mac else ""

        # Historical MACs with brands
        mac_history = []
        for mh in history:
            mac_history.append({
                "mac": mh.mac,
                "brand": vendors.get(mh.mac.lower(), ""),
                "changed_at": mh.changed_at.isoformat() if mh.changed_at else "",
            })

        rows.append({
            "subscriber": onu.subscriber,
            "name": onu.name,
            "olt_name": onu.olt.name if onu.olt else "",
            "pon_port": onu.pon_port,
            "serial": onu.serial,
            "current_mac": current_mac,
            "router_brand": current_brand,
            "address": onu.address,
            "gps_lat": onu.gps_lat,
            "gps_lng": onu.gps_lng,
            "phone": onu.phone,
            "email": onu.email,
            "landmark": onu.landmark,
            "state": onu.state.value if onu.state else "",
            "bound": onu.bound,
            "last_seen": onu.last_seen.isoformat() if onu.last_seen else "",
            "mac_history": mac_history,
        })

    if format == "json":
        return StreamingResponse(
            io.BytesIO(json.dumps(rows, indent=2, default=str).encode()),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=subscribers_export.json"},
        )

    # Excel export
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Subscribers"

    # Headers
    headers = [
        "PPPoE Username", "Name", "OLT", "PON Port", "Serial",
        "Current MAC", "Router Brand",
        "Address", "GPS Lat", "GPS Lng", "Phone", "Email", "Landmark",
        "State", "Bound", "Last Seen",
        "MAC History (MAC | Brand | Changed At)",
    ]
    ws.append(headers)

    # Data rows
    for row in rows:
        # Format MAC history as pipe-separated string
        mac_history_str = " | ".join(
            [f"{m['mac']} ({m['brand']}) {m['changed_at']}" for m in row["mac_history"]]
        ) if row["mac_history"] else ""

        ws.append([
            row["subscriber"],
            row["name"],
            row["olt_name"],
            row["pon_port"],
            row["serial"],
            row["current_mac"],
            row["router_brand"],
            row["address"],
            row["gps_lat"],
            row["gps_lng"],
            row["phone"],
            row["email"],
            row["landmark"],
            row["state"],
            row["bound"],
            row["last_seen"],
            mac_history_str,
        ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=subscribers_export.xlsx"},
    )


@router.get("/{subscriber}", response_model=SubscriberProfile)
async def subscriber_profile(
    subscriber: str,
    hours: int = Query(default=168, le=8760),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Full subscriber profile: current state + optical history + MAC changes."""
    onu = (
        await db.execute(
            select(Onu).options(selectinload(Onu.olt)).where(Onu.subscriber == subscriber)
        )
    ).scalars().first()
    if onu is None:
        raise HTTPException(status_code=404, detail="Subscriber not found")

    role = user_role(user)
    can_edit = role in ("admin", "global_write")
    if not can_edit:
        assigned = (
            await db.execute(
                select(Ticket).where(
                    Ticket.assigned_to == user.id,
                    Ticket.onu_id == onu.id,
                    Ticket.status.in_((TicketStatus.open, TicketStatus.in_progress)),
                )
            )
        ).scalar_one_or_none()
        can_edit = assigned is not None

    acs_by_onu = await _acs_map(db)

    since = utcnow() - timedelta(hours=hours)
    telemetry_rows = (
        await db.execute(
            select(OnuTelemetry)
            .where(OnuTelemetry.onu_id == onu.id, OnuTelemetry.sampled_at >= since)
            .order_by(OnuTelemetry.sampled_at)
        )
    ).scalars().all()
    mac_rows = (
        await db.execute(
            select(OnuMacHistory)
            .where(OnuMacHistory.onu_id == onu.id)
            .order_by(OnuMacHistory.changed_at.desc())
            .limit(200)
        )
    ).scalars().all()

    vendors = await vendor_map(
        db, [onu.last_mac] + [m.mac for m in mac_rows]
    )
    state = onu.state.value if hasattr(onu.state, "value") else str(onu.state)
    return SubscriberProfile(
        subscriber=onu.subscriber,
        onu_id=onu.id,
        onu_name=onu.name,
        olt_name=onu.olt.name if onu.olt else "",
        pon_port=onu.pon_port,
        serial=onu.serial,
        last_mac=onu.last_mac,
        mac_vendor=vendors.get(onu.last_mac.lower(), ""),
        mikrotik_ip=onu.mikrotik_ip,
        state=state,
        bound=onu.bound,
        can_edit_gps=can_edit,
        down_reason=onu.down_reason or "",
        status=display_status(state, onu.bound, onu.down_reason or ""),
        acs_device_id=acs_by_onu.get(onu.id),
        address=onu.address,
        gps_lat=onu.gps_lat,
        gps_lng=onu.gps_lng,
        gps_accuracy=onu.gps_accuracy,
        phone=onu.phone,
        email=onu.email,
        note=onu.note,
        telemetry=_telemetry_points(telemetry_rows),
        mac_history=[
            MacHistoryEntry(mac=m.mac, mac_vendor=vendors.get(m.mac.lower(), ""), changed_at=m.changed_at)
            for m in mac_rows
        ],
        last_seen=onu.last_seen,
    )


# ---------------------------------------------------------------------------
# Live Traffic Monitoring
# ---------------------------------------------------------------------------

import asyncio
import time

from ..drivers.mikrotik import MikrotikDriver


# In-memory store: subscriber_name -> session data
_traffic_sessions: dict[str, dict] = {}


async def _traffic_monitor_task(
    subscriber: str,
    device_id: int,
    interface: str,
    mikrotik_name: str,
    mikrotik_ip: str,
):
    """Background task: poll MikroTik byte counters every 2 seconds for 2 minutes, compute rates from deltas."""
    session = _traffic_sessions.get(subscriber)
    if not session:
        return

    try:
        from sqlalchemy import select as sa_select
        from ..database import SessionLocal

        async with SessionLocal() as db:
            device = (await db.execute(sa_select(MikrotikDevice).where(MikrotikDevice.id == device_id))).scalar_one_or_none()

        if not device:
            session["status"] = "error"
            session["error"] = "MikroTik device not found"
            return

        driver = MikrotikDriver(device)
        start = time.time()
        prev_rx = None
        prev_tx = None
        prev_time = None

        while time.time() - start < 120:
            if session.get("stop_requested"):
                session["status"] = "completed"
                break

            try:
                now = time.time()
                data = await driver.monitor_traffic_once(interface)
                cur_rx = data.get("rx_byte", 0)
                cur_tx = data.get("tx_byte", 0)

                if prev_rx is not None and prev_time is not None:
                    dt = now - prev_time
                    if dt > 0:
                        # Compute bits per second from byte deltas
                        rx_bps = max(0, int((cur_rx - prev_rx) * 8 / dt)) if cur_rx >= prev_rx else 0
                        tx_bps = max(0, int((cur_tx - prev_tx) * 8 / dt)) if cur_tx >= prev_tx else 0
                    else:
                        rx_bps = 0
                        tx_bps = 0
                    sample = TrafficSample(timestamp=now, rx_rate=rx_bps, tx_rate=tx_bps)
                    session["samples"].append(sample)

                prev_rx = cur_rx
                prev_tx = cur_tx
                prev_time = now
                session["elapsed"] = round(now - start, 1)
                session["remaining"] = max(0, round(120 - (now - start), 1))
            except Exception as e:
                session["error"] = str(e)

            await asyncio.sleep(2)

        if session["status"] == "running":
            session["status"] = "completed"

    except Exception as e:
        if session:
            session["status"] = "error"
            session["error"] = str(e)


@router.post("/{subscriber}/traffic/start", response_model=TrafficSession)
async def start_traffic_monitor(
    subscriber: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Start live traffic monitoring for a PPPoE subscriber (2 minutes)."""
    # Stop any existing session for this subscriber
    if subscriber in _traffic_sessions:
        _traffic_sessions[subscriber]["stop_requested"] = True
        await asyncio.sleep(0.5)

    # Find the subscriber's ONU to get mikrotik_ip (which is actually the PPPoE IP)
    onu = (await db.execute(select(Onu).where(Onu.subscriber == subscriber))).scalars().first()
    if not onu:
        raise HTTPException(status_code=404, detail="Subscriber not found")

    # Find the active PPPoE session to get MikroTik device_id and interface
    ppp_entry = (
        await db.execute(
            select(PppActiveEntry).where(PppActiveEntry.subscriber == subscriber)
        )
    ).scalars().first()

    if not ppp_entry:
        raise HTTPException(status_code=404, detail="Subscriber not currently active on any MikroTik")

    # Get MikroTik device info
    mkt_device = await db.get(MikrotikDevice, ppp_entry.device_id)
    if not mkt_device:
        raise HTTPException(status_code=404, detail="MikroTik device not found")

    # Resolve interface: use DB value or look up live from MikroTik
    interface = ppp_entry.interface
    if not interface:
        try:
            driver = MikrotikDriver(mkt_device)
            interface = await asyncio.to_thread(driver.get_pppoe_interface, subscriber)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"get_pppoe_interface failed for {subscriber}: {e}")
            interface = ""
    if not interface:
        raise HTTPException(status_code=404, detail="Could not determine PPPoE interface on MikroTik")

    # Create session
    session_data = {
        "subscriber": subscriber,
        "interface": interface,
        "mikrotik_name": mkt_device.name,
        "mikrotik_ip": mkt_device.ip,
        "status": "running",
        "samples": [],
        "elapsed": 0,
        "remaining": 120,
        "error": "",
        "stop_requested": False,
        "task": None,
    }
    _traffic_sessions[subscriber] = session_data

    # Start background task
    task = asyncio.create_task(
        _traffic_monitor_task(subscriber, ppp_entry.device_id, interface, mkt_device.name, mkt_device.ip)
    )
    session_data["task"] = task

    return TrafficSession(
        subscriber=subscriber,
        interface=interface,
        mikrotik_name=mkt_device.name,
        mikrotik_ip=mkt_device.ip,
        status="running",
        samples=[],
        elapsed=0,
        remaining=120,
    )


@router.get("/{subscriber}/traffic/samples", response_model=TrafficSession)
async def get_traffic_samples(
    subscriber: str,
    user: User = Depends(get_current_user),
):
    """Get current traffic monitoring samples."""
    session = _traffic_sessions.get(subscriber)
    if not session:
        raise HTTPException(status_code=404, detail="No active traffic session")

    return TrafficSession(
        subscriber=session["subscriber"],
        interface=session["interface"],
        mikrotik_name=session["mikrotik_name"],
        mikrotik_ip=session["mikrotik_ip"],
        status=session["status"],
        samples=session["samples"],
        elapsed=session["elapsed"],
        remaining=session["remaining"],
        error=session.get("error", ""),
    )


@router.delete("/{subscriber}/traffic/stop")
async def stop_traffic_monitor(
    subscriber: str,
    user: User = Depends(get_current_user),
):
    """Stop traffic monitoring early."""
    session = _traffic_sessions.get(subscriber)
    if not session:
        raise HTTPException(status_code=404, detail="No active traffic session")

    session["stop_requested"] = True
    return {"message": "Traffic monitoring stopped"}
