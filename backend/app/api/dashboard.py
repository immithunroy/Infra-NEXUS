from fastapi import APIRouter, Depends
import asyncio
import re
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Binding, MacEntry, MikrotikDevice, OLTDevice, Onu, OnuOutage, OnuTelemetry, PppActiveEntry, PortArea, ScanLog, User
from ..schemas import BrandBucket, DashboardSummary, MassDownPort, OltUsage, PortUsage, ScanLogOut, SignalBucket, WeakOnu
from ..security import get_current_user
from ..services.mac_vendor import vendor_map
from ..utils.time import utcnow

router = APIRouter(prefix="/api", tags=["dashboard"], dependencies=[Depends(get_current_user)])

SIGNAL_BUCKETS: list[tuple[str, float, float]] = [
    ("<= -28 dBm", float("-inf"), -28.0),
    ("-28 to -24", -28.0, -24.0),
    ("-24 to -20", -24.0, -20.0),
    ("-20 to -16", -20.0, -16.0),
    (">= -16 dBm", -16.0, float("inf")),
]


@router.get("/dashboard", response_model=DashboardSummary)
async def dashboard_summary(db: AsyncSession = Depends(get_db)):
    olts = (await db.execute(select(OLTDevice))).scalars().all()
    onus = (await db.execute(select(Onu))).scalars().all()

    olt_reachable = sum(1 for d in olts if d.status == "reachable")
    onu_total = len(onus)
    onu_manual = sum(1 for o in onus if o.source.value == "manual")
    onu_active = sum(1 for o in onus if o.state.value == "active")
    onu_inactive = sum(1 for o in onus if o.state.value == "inactive")
    onu_bound = sum(1 for o in onus if o.bound)

    mac_count = (await db.execute(select(func.count(MacEntry.id)))).scalar() or 0
    active_count = (await db.execute(select(func.count(PppActiveEntry.id)))).scalar() or 0
    mkt_count = (await db.execute(select(func.count(MikrotikDevice.id)))).scalar() or 0
    matched = (await db.execute(select(func.count(Binding.id)).where(Binding.bound.is_(True)))).scalar() or 0
    last = (await db.execute(select(func.max(ScanLog.started_at)))).scalar()

    mikrotiks = (await db.execute(select(MikrotikDevice))).scalars().all()
    subscriber_total = sum(d.subscriber_count for d in mikrotiks)
    subscriber_active = sum(d.active_count for d in mikrotiks)

    olt_usages: list[OltUsage] = []
    for d in olts:
        dev_onus = [o for o in onus if o.olt_id == d.id]
        port_map: dict[str, dict] = {}
        for o in dev_onus:
            base = re.sub(r":\d+$", "", o.pon_port).strip() or o.pon_port
            p = port_map.setdefault(base, {"used": 0, "active": 0, "bound": 0})
            p["used"] += 1
            if o.state.value == "active":
                p["active"] += 1
            if o.bound:
                p["bound"] += 1
        cap = d.port_capacity or 32
        ports = [
            PortUsage(
                port=port,
                used=c["used"],
                capacity=cap,
                remaining=max(cap - c["used"], 0),
                active=c["active"],
                bound=c["bound"],
            )
            for port, c in sorted(port_map.items(), key=lambda kv: kv[0])
        ]
        used_slots = sum(p.used for p in ports)
        total_slots = len(ports) * cap
        olt_usages.append(
            OltUsage(
                id=d.id,
                name=d.name,
                ip=d.ip,
                pon_type=d.pon_type,
                status=d.status,
                port_capacity=cap,
                port_count=len(ports),
                total_slots=total_slots,
                used_slots=used_slots,
                free_slots=max(total_slots - used_slots, 0),
                utilization_pct=round(used_slots / total_slots * 100, 1) if total_slots else 0.0,
                onu_total=len(dev_onus),
                onu_active=sum(1 for o in dev_onus if o.state.value == "active"),
                onu_bound=sum(1 for o in dev_onus if o.bound),
                onu_manual=sum(1 for o in dev_onus if o.source.value == "manual"),
                ports=ports,
            )
        )

    hist_counts = [0] * len(SIGNAL_BUCKETS)
    weakest: list[Onu] = []
    for o in onus:
        if o.rx_power is None:
            continue
        for i, (_, lo, hi) in enumerate(SIGNAL_BUCKETS):
            if lo <= o.rx_power < hi:
                hist_counts[i] += 1
                break
        weakest.append(o)
    weakest.sort(key=lambda o: o.rx_power)
    name_map = {d.id: d.name for d in olts}

    # Router / CPE brand distribution from the ONU last_mac (the customer
    # router's MAC learned on the PON port) resolved to its vendor brand.
    brand_counts: dict[str, int] = {}
    if onus:
        try:
            brand_map = await asyncio.wait_for(
                vendor_map(db, (o.last_mac or o.mac for o in onus)),
                timeout=5.0,
            )
            for o in onus:
                mac = o.last_mac or o.mac
                brand = brand_map.get(mac.lower(), "") if mac else ""
                if brand:
                    brand_counts[brand] = brand_counts.get(brand, 0) + 1
        except (asyncio.TimeoutError, Exception):
            brand_map = {}
            for o in onus:
                mac = o.last_mac or o.mac
                if mac:
                    brand_counts["Unknown"] = brand_counts.get("Unknown", 0) + 1
    brand_total = sum(brand_counts.values())
    router_brands = [
        BrandBucket(
            brand=brand,
            count=count,
            pct=round(count / brand_total * 100, 1) if brand_total else 0.0,
        )
        for brand, count in sorted(brand_counts.items(), key=lambda kv: -kv[1])
    ]

    # Mass-down / power-outage areas: group currently-down ONUs (power-off or
    # wire-down) by (olt, port base) and flag ports with count >= threshold.
    MASS_DOWN_THRESHOLD = 5
    area_labels = {
        (a.olt_id, a.port): a.label
        for a in (await db.execute(select(PortArea))).scalars().all()
    }
    down_by_port: dict[tuple[int, str], dict] = {}
    for o in onus:
        if o.state.value == "active" or o.down_reason not in ("power-off", "wire-down"):
            continue
        base = re.sub(r":\d+$", "", o.pon_port).strip() or o.pon_port
        key = (o.olt_id, base)
        agg = down_by_port.setdefault(key, {"power_off": 0, "wire_down": 0})
        agg["power_off" if o.down_reason == "power-off" else "wire_down"] += 1
    name_map2 = {d.id: d.name for d in olts}
    mass_down_ports: list[MassDownPort] = []
    for (oid, port), agg in down_by_port.items():
        count = agg["power_off"] + agg["wire_down"]
        if count < MASS_DOWN_THRESHOLD:
            continue
        reason = "power-off" if agg["power_off"] >= agg["wire_down"] else "wire-down"
        mass_down_ports.append(
            MassDownPort(
                olt_id=oid,
                olt_name=name_map2.get(oid, ""),
                port=port,
                label=area_labels.get((oid, port), ""),
                count=count,
                power_off_count=agg["power_off"],
                wire_down_count=agg["wire_down"],
                reason=reason,
            )
        )
    mass_down_ports.sort(key=lambda m: -m.count)

    return DashboardSummary(
        olt_count=len(olts),
        olt_reachable=olt_reachable,
        mikrotik_count=mkt_count,
        onu_total=onu_total,
        onu_manual=onu_manual,
        onu_active=onu_active,
        onu_inactive=onu_inactive,
        onu_bound=onu_bound,
        olt_mac_count=mac_count,
        active_mac_count=active_count,
        matched_mac_count=matched,
        total_slots=sum(u.total_slots for u in olt_usages),
        free_slots=sum(u.free_slots for u in olt_usages),
        bound_pct=round(onu_bound / onu_total * 100, 1) if onu_total else 0.0,
        subscriber_total=subscriber_total,
        subscriber_active=subscriber_active,
        signal_hist=[
            SignalBucket(label=SIGNAL_BUCKETS[i][0], count=hist_counts[i])
            for i in range(len(SIGNAL_BUCKETS))
        ],
        weakest_onus=[
            WeakOnu(
                olt_id=o.olt_id,
                pon_port=o.pon_port,
                olt_name=name_map.get(o.olt_id, ""),
                onu_id=o.id,
                name=o.name,
                subscriber=o.subscriber,
                serial=o.serial,
                state=o.state.value,
                rx_power=o.rx_power,
                tx_power=o.tx_power,
            )
            for o in weakest[:8]
        ],
        router_brands=router_brands,
        mass_down_ports=mass_down_ports,
        olts=olt_usages,
        last_scan=last,
    )


@router.get("/dashboard/mass-downs", response_model=list[MassDownPort])
async def live_mass_downs(db: AsyncSession = Depends(get_db)):
    """Live mass-outage areas from the down-detector's onu_outages table.

    Returns unresolved outages sorted by started_at desc (newest first).
    """
    from datetime import timedelta
    since = utcnow() - timedelta(days=7)
    outages = (
        await db.execute(
            select(OnuOutage)
            .where(OnuOutage.resolved.is_(False), OnuOutage.started_at >= since)
            .order_by(OnuOutage.started_at.desc())
        )
    ).scalars().all()

    area_labels = {
        (a.olt_id, a.port): a.label
        for a in (await db.execute(select(PortArea))).scalars().all()
    }

    results: list[MassDownPort] = []
    for o in outages:
        base = o.pon_port
        results.append(
            MassDownPort(
                olt_id=o.olt_id,
                olt_name=o.olt_name,
                port=base,
                label=area_labels.get((o.olt_id, base), ""),
                count=o.onu_count,
                reason="mass-outage",
            )
        )
    return results


@router.get("/scans", response_model=list[ScanLogOut])
async def list_scans(limit: int = 50, db: AsyncSession = Depends(get_db)):
    q = select(ScanLog).order_by(ScanLog.started_at.desc()).limit(min(limit, 500))
    return (await db.execute(q)).scalars().all()


@router.get("/dashboard/optical-averages")
async def optical_averages(db: AsyncSession = Depends(get_db)):
    from datetime import timedelta
    from sqlalchemy import text

    result = {}
    windows = [
        ("1d", timedelta(days=1), "hour"),
        ("1m", timedelta(days=30), "day"),
        ("3m", timedelta(days=90), "day"),
    ]

    for key, delta, trunc in windows:
        since = utcnow() - delta
        rows = (await db.execute(
            text("""
                SELECT
                    date_trunc(:trunc, sampled_at) AS bucket,
                    AVG(rx_power) AS avg_rx,
                    COUNT(*) AS cnt
                FROM onu_telemetry
                WHERE rx_power IS NOT NULL AND sampled_at >= :since
                GROUP BY bucket
                ORDER BY bucket
            """),
            {"trunc": trunc, "since": since},
        )).all()

        sparkline = []
        total_samples = 0
        vals = []
        for r in rows:
            if r.avg_rx is not None:
                sparkline.append([round(float(r.avg_rx), 2), r.bucket.isoformat()])
                vals.append(float(r.avg_rx))
                total_samples += r.cnt

        avg_all = round(sum(vals) / len(vals), 2) if vals else None

        result[key] = {
            "avg_rx": avg_all,
            "samples": total_samples,
            "sparkline": sparkline,
        }

    return result