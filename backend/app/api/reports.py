"""Reporting endpoints.

Aggregate data for the Reporting menu: per-OLT / per-port summaries, ONU
state distribution, down-reason breakdown, and GPS coverage.
"""
import re

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import OLTDevice, Onu, OnuDownEvent, PortArea, User
from ..schemas import DownReasonBucket, OltReport, ReportSummary, WeakOnu
from ..security import get_current_user
from ..utils.status import display_status

router = APIRouter(prefix="/api/reports", tags=["reports"], dependencies=[Depends(get_current_user)])

DOWN_REASONS = ("power-off", "wire-down", "mpcp-down", "oam-down", "firmware-download", "illegal-mac", "llid-admin-down", "unknown")


def _port_base(pon_port: str) -> str:
    return pon_port.rsplit(":", 1)[0] if ":" in pon_port else pon_port


@router.get("", response_model=ReportSummary)
async def reports(
    olt_id: int | None = None,
    days: int = Query(default=30, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """High-level report across OLTs, ports, down reasons and GPS coverage."""
    olts = (await db.execute(select(OLTDevice))).scalars().all()
    onus = (await db.execute(select(Onu))).scalars().all()
    if olt_id is not None:
        onus = [o for o in onus if o.olt_id == olt_id]
    olts = [d for d in olts if olt_id is None or d.id == olt_id]

    area_labels = {
        (a.olt_id, a.port): a.label
        for a in (await db.execute(select(PortArea))).scalars().all()
    }
    olt_map = {d.id: d for d in olts}
    name_of = lambda oid: olt_map.get(oid).name if olt_map.get(oid) else ""

    # Per-OLT + per-port aggregation.
    port_totals: dict[tuple[int, str], dict] = {}
    state_total = {"active": 0, "inactive": 0, "offline": 0, "unknown": 0}
    down_reasons: dict[str, int] = {r: 0 for r in DOWN_REASONS}
    gps_tagged = 0

    for o in onus:
        state = o.state.value if hasattr(o.state, "value") else str(o.state)
        state_total[state] = state_total.get(state, 0) + 1
        if o.down_reason and o.state.value != "active":
            down_reasons[o.down_reason] = down_reasons.get(o.down_reason, 0) + 1
        if o.gps_lat is not None and o.gps_lng is not None:
            gps_tagged += 1
        base = _port_base(o.pon_port) or o.pon_port
        agg = port_totals.setdefault(
            (o.olt_id, base),
            {"total": 0, "active": 0, "down": 0, "bound": 0, "gps": 0},
        )
        agg["total"] += 1
        if state == "active":
            agg["active"] += 1
        else:
            agg["down"] += 1
        if o.bound:
            agg["bound"] += 1
        if o.gps_lat is not None and o.gps_lng is not None:
            agg["gps"] += 1

    olt_reports: list[OltReport] = []
    for d in olts:
        dev_ports = [p for (oid, p) in port_totals if oid == d.id]
        ports = []
        for port in sorted(set(dev_ports)):
            agg = port_totals[(d.id, port)]
            ports.append(
                {
                    "port": port,
                    "label": area_labels.get((d.id, port), ""),
                    "total": agg["total"],
                    "active": agg["active"],
                    "down": agg["down"],
                    "bound": agg["bound"],
                    "gps": agg["gps"],
                    "online_pct": round(agg["active"] / agg["total"] * 100, 1) if agg["total"] else 0.0,
                }
            )
        olt_reports.append(
            OltReport(
                olt_id=d.id,
                olt_name=d.name,
                pon_type=d.pon_type,
                port_count=len(ports),
                total=sum(p["total"] for p in ports),
                active=sum(p["active"] for p in ports),
                down=sum(p["down"] for p in ports),
                bound=sum(p["bound"] for p in ports),
                gps=sum(p["gps"] for p in ports),
                online_pct=round(sum(p["active"] for p in ports) / sum(p["total"] for p in ports) * 100, 1)
                if sum(p["total"] for p in ports)
                else 0.0,
                ports=ports,
            )
        )

    # Recent down events (last `days`) for a trends block.
    from ..utils.time import utcnow
    from datetime import timedelta

    since = utcnow() - timedelta(days=days)
    ev = (
        await db.execute(
            select(OnuDownEvent).where(
                OnuDownEvent.detected_at >= since,
                OnuDownEvent.kind.in_(("down", "outage")),
            )
        )
    ).scalars().all()
    events_total = len(ev)
    events_reasons: dict[str, int] = {}
    for e in ev:
        r = e.reason or "unknown"
        events_reasons[r] = events_reasons.get(r, 0) + 1

    return ReportSummary(
        total_onus=len(onus),
        total_active=state_total["active"],
        total_down=len(onus) - state_total["active"],
        total_bound=sum(1 for o in onus if o.bound),
        gps_tagged=gps_tagged,
        gps_coverage_pct=round(gps_tagged / len(onus) * 100, 1) if onus else 0.0,
        state=state_total,
        down_reasons=[
            DownReasonBucket(reason=r, count=c)
            for r, c in sorted(down_reasons.items(), key=lambda kv: -kv[1])
            if c > 0
        ],
        recent_down_events=events_total,
        recent_down_events_by_reason=[
            DownReasonBucket(reason=r, count=c)
            for r, c in sorted(events_reasons.items(), key=lambda kv: -kv[1])
        ],
        olts=olt_reports,
    )


# ---------------------------------------------------------------------------
# Detail report endpoints (Excel/PDF exportable).
# ---------------------------------------------------------------------------

from datetime import timedelta  # noqa: E402

from sqlalchemy import func  # noqa: E402

from ..models import OnuTelemetry  # noqa: E402
from ..schemas import (  # noqa: E402
    DowntimeReport,
    DowntimeReportRow,
    FluctuationReport,
    FluctuationReportRow,
    OpticalReport,
    OpticalReportRow,
    PortReportExport,
    PortReportRow,
    WeakSignalReport,
)
from ..utils.export import pdf_response, xlsx_response  # noqa: E402
from ..utils.time import utcnow  # noqa: E402

_REPORT_DATE_FMT = "%Y-%m-%d %H:%M"


@router.get("/optical", response_model=OpticalReport)
async def optical_report(
    olt_id: int | None = None,
    port: str = "",
    days: int = Query(default=7, ge=1, le=90),
    sort_by: str = Query(default="olt", pattern="^(olt|port|onu_id|subscriber|name|avg_rx|min_rx|max_rx|last_rx|avg_tx|last_tx|samples)$"),
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
    threshold: float | None = Query(default=None, description="Filter ONUs with avg_rx <= threshold"),
    db: AsyncSession = Depends(get_db),
):
    """Weekly optical power list: per-ONU RX/TX statistics over the window.

    Aggregated straight from the telemetry table (one row every few minutes).
    """
    since = utcnow() - timedelta(days=days)

    stmt = (
        select(
            OnuTelemetry.onu_id,
            OnuTelemetry.olt_id,
            OnuTelemetry.pon_port,
            func.count().label("samples"),
            func.avg(OnuTelemetry.rx_power).label("avg_rx"),
            func.min(OnuTelemetry.rx_power).label("min_rx"),
            func.max(OnuTelemetry.rx_power).label("max_rx"),
            func.avg(OnuTelemetry.tx_power).label("avg_tx"),
            func.min(OnuTelemetry.tx_power).label("min_tx"),
            func.max(OnuTelemetry.tx_power).label("max_tx"),
            func.max(OnuTelemetry.sampled_at).label("last_sampled"),
            func.min(OnuTelemetry.sampled_at).label("first_sampled"),
        )
        .where(OnuTelemetry.sampled_at >= since)
        .group_by(OnuTelemetry.onu_id, OnuTelemetry.olt_id, OnuTelemetry.pon_port)
    )
    if olt_id is not None:
        stmt = stmt.where(OnuTelemetry.olt_id == olt_id)
    if port:
        # port may be a base (EPON0/1) or full (EPON0/1:9) pon port.
        port_clean = port.strip()
        stmt = stmt.where(
            (OnuTelemetry.pon_port == port_clean)
            | (OnuTelemetry.pon_port.like(f"{port_clean}:%"))
        )
    aggs = (await db.execute(stmt)).all()

    onu_map = {o.id: o for o in (await db.execute(select(Onu))).scalars().all()}
    olt_map = {d.id: d for d in (await db.execute(select(OLTDevice))).scalars().all()}

    # Latest raw sample per ONU (within window) for "last" RX/TX + current state.
    last_raw: dict[int, OnuTelemetry] = {}
    latest = (
        await db.execute(
            select(OnuTelemetry)
            .where(OnuTelemetry.sampled_at >= since)
            .order_by(OnuTelemetry.sampled_at.desc())
            .limit(20000)
        )
    ).scalars().all()
    for t in latest:
        if t.onu_id not in last_raw:
            last_raw[t.onu_id] = t

    rows: list[OpticalReportRow] = []
    for a in aggs:
        onu = onu_map.get(a.onu_id)
        olt = olt_map.get(a.olt_id)
        state = "unknown"
        bound = False
        if onu is not None:
            state = onu.state.value if hasattr(onu.state, "value") else str(onu.state)
            bound = onu.bound
        last = last_raw.get(a.onu_id)
        last_rx = last.rx_power if last is not None else None
        last_tx = last.tx_power if last is not None else None
        rows.append(
            OpticalReportRow(
                olt_id=a.olt_id,
                olt_name=olt.name if olt else "",
                pon_port=a.pon_port,
                onu_id=a.onu_id,
                subscriber=onu.subscriber if onu else "",
                name=onu.name if onu else "",
                serial=onu.serial if onu else "",
                samples=a.samples,
                avg_rx=round(a.avg_rx, 2) if a.avg_rx is not None else None,
                min_rx=round(a.min_rx, 2) if a.min_rx is not None else None,
                max_rx=round(a.max_rx, 2) if a.max_rx is not None else None,
                last_rx=round(last_rx, 2) if last_rx is not None else None,
                avg_tx=round(a.avg_tx, 2) if a.avg_tx is not None else None,
                min_tx=round(a.min_tx, 2) if a.min_tx is not None else None,
                max_tx=round(a.max_tx, 2) if a.max_tx is not None else None,
                last_tx=round(last_tx, 2) if last_tx is not None else None,
                current_state=state,
                bound=bound,
                first_sampled=a.first_sampled,
                last_sampled=a.last_sampled,
            )
        )

    _SORT_KEYS = {
        "olt": lambda r: (r.olt_name, r.pon_port, r.onu_id),
        "port": lambda r: (r.pon_port, r.onu_id),
        "onu_id": lambda r: (r.onu_id,),
        "subscriber": lambda r: (r.subscriber,),
        "name": lambda r: (r.name,),
        "avg_rx": lambda r: (r.avg_rx is None, r.avg_rx or 0),
        "min_rx": lambda r: (r.min_rx is None, r.min_rx or 0),
        "max_rx": lambda r: (r.max_rx is None, r.max_rx or 0),
        "last_rx": lambda r: (r.last_rx is None, r.last_rx or 0),
        "avg_tx": lambda r: (r.avg_tx is None, r.avg_tx or 0),
        "last_tx": lambda r: (r.last_tx is None, r.last_tx or 0),
        "samples": lambda r: (r.samples,),
    }
    if threshold is not None:
        rows = [r for r in rows if r.avg_rx is not None and r.avg_rx <= threshold]
    rows.sort(key=_SORT_KEYS.get(sort_by, _SORT_KEYS["olt"]), reverse=(order == "desc"))
    return OpticalReport(
        window_days=days,
        olt_filter=olt_id,
        generated_at=utcnow(),
        rows=rows,
    )


def _fmt_dt(v) -> str:
    return v.strftime(_REPORT_DATE_FMT) if v else ""


def _optical_headers() -> list[str]:
    return [
        "OLT",
        "Port",
        "ONU ID",
        "Subscriber",
        "Name",
        "Serial",
        "State",
        "Samples",
        "Avg RX",
        "Min RX",
        "Max RX",
        "Last RX",
        "Avg TX",
        "Min TX",
        "Max TX",
        "Last TX",
        "First Sample",
        "Last Sample",
    ]


def _optical_rows(rows: list[OpticalReportRow]) -> list[list]:
    return [
        [
            r.olt_name,
            r.pon_port,
            r.onu_id,
            r.subscriber,
            r.name,
            r.serial,
            r.current_state,
            r.samples,
            r.avg_rx,
            r.min_rx,
            r.max_rx,
            r.last_rx,
            r.avg_tx,
            r.min_tx,
            r.max_tx,
            r.last_tx,
            _fmt_dt(r.first_sampled),
            _fmt_dt(r.last_sampled),
        ]
        for r in rows
    ]


@router.get("/optical/export")
async def optical_export(
    format: str = Query(default="xlsx", pattern="^(xlsx|pdf)$"),
    olt_id: int | None = None,
    port: str = "",
    days: int = Query(default=7, ge=1, le=90),
    sort_by: str = Query(default="olt", pattern="^(olt|port|onu_id|subscriber|name|avg_rx|min_rx|max_rx|last_rx|avg_tx|last_tx|samples)$"),
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
    threshold: float | None = Query(default=None, description="Filter ONUs with avg_rx <= threshold"),
    db: AsyncSession = Depends(get_db),
):
    """Excel or PDF export of the weekly optical power list."""
    rep = await optical_report(olt_id=olt_id, port=port, days=days, sort_by=sort_by, order=order, threshold=threshold, db=db)
    title = "Optical Power Report (Last %d days)" % days
    if threshold is not None:
        title += f" (RX <= {threshold} dBm)"
    if format == "pdf":
        return pdf_response(title, f"optical-power-{days}d.pdf", _optical_headers(), _optical_rows(rep.rows))
    return xlsx_response(title, f"optical-power-{days}d.xlsx", _optical_headers(), _optical_rows(rep.rows))


@router.get("/fluctuation", response_model=FluctuationReport)
async def fluctuation_report(
    olt_id: int | None = None,
    port: str = "",
    days: int = Query(default=7, ge=1, le=90),
    threshold: float = Query(default=3.0, description="Min fluctuation (max_rx - min_rx) in dB"),
    db: AsyncSession = Depends(get_db),
):
    """ONUs whose RX power fluctuated more than the threshold (dB)."""
    since = utcnow() - timedelta(days=days)
    stmt = (
        select(
            OnuTelemetry.onu_id,
            OnuTelemetry.olt_id,
            OnuTelemetry.pon_port,
            func.count().label("samples"),
            func.avg(OnuTelemetry.rx_power).label("avg_rx"),
            func.min(OnuTelemetry.rx_power).label("min_rx"),
            func.max(OnuTelemetry.rx_power).label("max_rx"),
            func.avg(OnuTelemetry.tx_power).label("avg_tx"),
            func.max(OnuTelemetry.sampled_at).label("last_sampled"),
        )
        .where(OnuTelemetry.sampled_at >= since)
        .where(OnuTelemetry.rx_power.isnot(None))
        .group_by(OnuTelemetry.onu_id, OnuTelemetry.olt_id, OnuTelemetry.pon_port)
        .having(func.count() >= 2)
    )
    if olt_id is not None:
        stmt = stmt.where(OnuTelemetry.olt_id == olt_id)
    if port:
        port_clean = port.strip()
        stmt = stmt.where(
            (OnuTelemetry.pon_port == port_clean)
            | (OnuTelemetry.pon_port.like(f"{port_clean}:%"))
        )
    aggs = (await db.execute(stmt)).all()

    onu_map = {o.id: o for o in (await db.execute(select(Onu))).scalars().all()}
    olt_map = {d.id: d for d in (await db.execute(select(OLTDevice))).scalars().all()}

    rows: list[FluctuationReportRow] = []
    for a in aggs:
        if a.avg_rx is None or a.min_rx is None or a.max_rx is None:
            continue
        fluct = round(a.max_rx - a.min_rx, 2)
        if fluct < threshold:
            continue
        onu = onu_map.get(a.onu_id)
        olt = olt_map.get(a.olt_id)
        state = "unknown"
        if onu is not None:
            state = onu.state.value if hasattr(onu.state, "value") else str(onu.state)
        rows.append(
            FluctuationReportRow(
                olt_id=a.olt_id,
                olt_name=olt.name if olt else "",
                pon_port=a.pon_port,
                onu_id=a.onu_id,
                subscriber=onu.subscriber if onu else "",
                name=onu.name if onu else "",
                serial=onu.serial if onu else "",
                samples=a.samples,
                avg_rx=round(a.avg_rx, 2),
                min_rx=round(a.min_rx, 2),
                max_rx=round(a.max_rx, 2),
                last_rx=None,
                avg_tx=round(a.avg_tx, 2) if a.avg_tx is not None else None,
                fluctuation=fluct,
                current_state=state,
            )
        )
    rows.sort(key=lambda r: -r.fluctuation)
    return FluctuationReport(
        window_days=days,
        olt_filter=olt_id,
        threshold=threshold,
        generated_at=utcnow(),
        rows=rows,
    )


def _fluct_headers() -> list[str]:
    return [
        "OLT",
        "Port",
        "ONU ID",
        "Subscriber",
        "Name",
        "Serial",
        "State",
        "Samples",
        "Avg RX",
        "Min RX",
        "Max RX",
        "Last RX",
        "Avg TX",
        "Fluctuation (dB)",
    ]


def _fluct_rows(rows: list[FluctuationReportRow]) -> list[list]:
    return [
        [
            r.olt_name,
            r.pon_port,
            r.onu_id,
            r.subscriber,
            r.name,
            r.serial,
            r.current_state,
            r.samples,
            r.avg_rx,
            r.min_rx,
            r.max_rx,
            r.last_rx,
            r.avg_tx,
            r.fluctuation,
        ]
        for r in rows
    ]


@router.get("/fluctuation/export")
async def fluctuation_export(
    format: str = Query(default="xlsx", pattern="^(xlsx|pdf)$"),
    olt_id: int | None = None,
    port: str = "",
    days: int = Query(default=7, ge=1, le=90),
    threshold: float = Query(default=3.0, description="Min fluctuation (max_rx - min_rx) in dB"),
    db: AsyncSession = Depends(get_db),
):
    """Excel or PDF export of the power fluctuation report."""
    rep = await fluctuation_report(olt_id=olt_id, port=port, days=days, threshold=threshold, db=db)
    title = "Power Fluctuation Report (>= %.1f dB, %d days)" % (threshold, days)
    if format == "pdf":
        return pdf_response(title, f"fluctuation-{days}d.pdf", _fluct_headers(), _fluct_rows(rep.rows))
    return xlsx_response(title, f"fluctuation-{days}d.xlsx", _fluct_headers(), _fluct_rows(rep.rows))


@router.get("/downtime", response_model=DowntimeReport)
async def downtime_report(
    olt_id: int | None = None,
    port: str = "",
    days: int = Query(default=7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    """Downtime report: down/outage events aggregated per ONU over the window."""
    since = utcnow() - timedelta(days=days)
    stmt = select(OnuDownEvent).where(
        OnuDownEvent.detected_at >= since,
        OnuDownEvent.kind.in_(("down", "outage")),
    )
    if olt_id is not None:
        stmt = stmt.where(OnuDownEvent.olt_id == olt_id)
    if port:
        base = re.sub(r":\d+$", "", port) if ":" in port else port
        stmt = stmt.where(
            (OnuDownEvent.pon_port == port)
            | (OnuDownEvent.pon_port.like(f"{base}:%"))
        )
    events = (await db.execute(stmt)).scalars().all()

    agg: dict[int, dict] = {}
    for e in events:
        key = e.onu_id if e.onu_id else (e.olt_id, e.pon_port)
        a = agg.setdefault(
            key,
            {
                "olt_id": e.olt_id,
                "olt_name": e.olt_name,
                "pon_port": e.pon_port,
                "onu_id": e.onu_id,
                "serial": e.serial,
                "name": e.name,
                "down": 0,
                "outage": 0,
                "total": 0,
                "max": 0,
                "reason": e.reason or "",
                "first": e.detected_at,
                "last": e.detected_at,
            },
        )
        if e.kind == "outage":
            a["outage"] += 1
        else:
            a["down"] += 1
        a["total"] += e.duration_seconds or 0
        a["max"] = max(a["max"], e.duration_seconds or 0)
        if e.detected_at < a["first"]:
            a["first"] = e.detected_at
        if e.detected_at > a["last"]:
            a["last"] = e.detected_at

    onu_map = {o.id: o for o in (await db.execute(select(Onu))).scalars().all()}
    olt_map = {d.id: d for d in (await db.execute(select(OLTDevice))).scalars().all()}

    rows: list[DowntimeReportRow] = []
    for key, a in agg.items():
        onu = onu_map.get(a["onu_id"]) if a["onu_id"] else None
        rows.append(
            DowntimeReportRow(
                olt_id=a["olt_id"],
                olt_name=a["olt_name"] or (olt_map.get(a["olt_id"]).name if olt_map.get(a["olt_id"]) else ""),
                pon_port=a["pon_port"],
                onu_id=a["onu_id"],
                subscriber=onu.subscriber if onu else "",
                name=a["name"] or (onu.name if onu else ""),
                serial=a["serial"] or (onu.serial if onu else ""),
                down_events=a["down"],
                outage_events=a["outage"],
                total_seconds=a["total"],
                avg_seconds=int(a["total"] / max(1, a["down"] + a["outage"])),
                max_seconds=a["max"],
                reason=a["reason"],
                first_event=a["first"],
                last_event=a["last"],
            )
        )
    rows.sort(key=lambda r: (-r.total_seconds, r.olt_name, r.pon_port))
    return DowntimeReport(
        window_days=days,
        olt_filter=olt_id,
        generated_at=utcnow(),
        rows=rows,
    )


def _downtime_headers() -> list[str]:
    return [
        "OLT",
        "Port",
        "ONU ID",
        "Subscriber",
        "Name",
        "Serial",
        "Down Events",
        "Outage Events",
        "Total Downtime (h)",
        "Avg Duration (min)",
        "Max Duration (min)",
        "Reason",
        "First Event",
        "Last Event",
    ]


def _downtime_rows(rows: list[DowntimeReportRow]) -> list[list]:
    return [
        [
            r.olt_name,
            r.pon_port,
            r.onu_id,
            r.subscriber,
            r.name,
            r.serial,
            r.down_events,
            r.outage_events,
            round(r.total_seconds / 3600, 2),
            round(r.avg_seconds / 60, 1),
            round(r.max_seconds / 60, 1),
            r.reason,
            _fmt_dt(r.first_event),
            _fmt_dt(r.last_event),
        ]
        for r in rows
    ]


@router.get("/downtime/export")
async def downtime_export(
    format: str = Query(default="xlsx", pattern="^(xlsx|pdf)$"),
    olt_id: int | None = None,
    port: str = "",
    days: int = Query(default=7, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
):
    rep = await downtime_report(olt_id=olt_id, port=port, days=days, db=db)
    title = "Downtime Report (Last %d days)" % days
    if format == "pdf":
        return pdf_response(title, f"downtime-{days}d.pdf", _downtime_headers(), _downtime_rows(rep.rows))
    return xlsx_response(title, f"downtime-{days}d.xlsx", _downtime_headers(), _downtime_rows(rep.rows))


@router.get("/ports", response_model=PortReportExport)
async def ports_report(
    olt_id: int | None = None,
    port: str = "",
    db: AsyncSession = Depends(get_db),
):
    """Per-PON-port capacity/utilization report (point-in-time)."""
    olts = (await db.execute(select(OLTDevice))).scalars().all()
    onus = (await db.execute(select(Onu))).scalars().all()
    if olt_id is not None:
        olts = [d for d in olts if d.id == olt_id]
        onus = [o for o in onus if o.olt_id == olt_id]

    rows: list[PortReportRow] = []
    for d in olts:
        dev_onus = [o for o in onus if o.olt_id == d.id]
        bases: dict[str, list] = {}
        for o in dev_onus:
            base = _port_base(o.pon_port) or o.pon_port
            b = bases.setdefault(base, [])
            b.append(o)
        for base, lst in sorted(bases.items()):
            if port and base != port:
                continue
            cap = d.port_capacity or 32
            rows.append(
                PortReportRow(
                    olt_id=d.id,
                    olt_name=d.name,
                    pon_type=d.pon_type,
                    port=base,
                    label="",
                    capacity=cap,
                    used=len(lst),
                    remaining=max(0, cap - len(lst)),
                    active=sum(1 for o in lst if (o.state.value if hasattr(o.state, "value") else str(o.state)) == "active"),
                    down=sum(1 for o in lst if (o.state.value if hasattr(o.state, "value") else str(o.state)) != "active"),
                    bound=sum(1 for o in lst if o.bound),
                    gps=sum(1 for o in lst if o.gps_lat is not None and o.gps_lng is not None),
                    utilization_pct=round(len(lst) / cap * 100, 1) if cap else 0.0,
                )
            )
    rows.sort(key=lambda r: (r.olt_name, r.port))
    return PortReportExport(
        olt_filter=olt_id,
        generated_at=utcnow(),
        rows=rows,
    )


def _port_headers() -> list[str]:
    return [
        "OLT",
        "PON Type",
        "Port",
        "Capacity",
        "Used",
        "Remaining",
        "Active",
        "Down",
        "Bound",
        "GPS",
        "Utilization %",
    ]


def _port_rows(rows: list[PortReportRow]) -> list[list]:
    return [
        [
            r.olt_name,
            r.pon_type,
            r.port,
            r.capacity,
            r.used,
            r.remaining,
            r.active,
            r.down,
            r.bound,
            r.gps,
            r.utilization_pct,
        ]
        for r in rows
    ]


@router.get("/ports/export")
async def ports_export(
    format: str = Query(default="xlsx", pattern="^(xlsx|pdf)$"),
    olt_id: int | None = None,
    port: str = "",
    db: AsyncSession = Depends(get_db),
):
    rep = await ports_report(olt_id=olt_id, port=port, db=db)
    title = "PON Port Utilization Report"
    if format == "pdf":
        return pdf_response(title, "port-utilization.pdf", _port_headers(), _port_rows(rep.rows))
    return xlsx_response(title, "port-utilization.xlsx", _port_headers(), _port_rows(rep.rows))


@router.get("/weakest", response_model=WeakSignalReport)
async def weakest_report(
    olt_id: int | None = None,
    port: str = "",
    limit: int = Query(default=10, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    """Weakest optical signals (lowest current RX power), filtered by OLT/port."""
    onus = (await db.execute(select(Onu))).scalars().all()
    if olt_id is not None:
        onus = [o for o in onus if o.olt_id == olt_id]
    if port:
        base = re.sub(r":\d+$", "", port) if ":" in port else port
        onus = [o for o in onus if o.pon_port == port or (re.sub(r":\d+$", "", o.pon_port) if ":" in o.pon_port else o.pon_port) == base]
    with_rx = [o for o in onus if o.rx_power is not None]
    with_rx.sort(key=lambda o: o.rx_power)
    with_rx = with_rx[:limit]
    name_map = {d.id: d.name for d in (await db.execute(select(OLTDevice))).scalars().all()}
    rows = [
        WeakOnu(
            olt_id=o.olt_id,
            olt_name=name_map.get(o.olt_id, ""),
            pon_port=o.pon_port,
            onu_id=o.id,
            name=o.name,
            subscriber=o.subscriber,
            serial=o.serial,
            state=o.state.value,
            rx_power=o.rx_power,
            tx_power=o.tx_power,
        )
        for o in with_rx
    ]
    return WeakSignalReport(
        olt_filter=olt_id,
        port_filter=port,
        limit=limit,
        generated_at=utcnow(),
        rows=rows,
    )


def _weak_headers() -> list[str]:
    return [
        "OLT",
        "PON Port",
        "ONU ID",
        "Customer",
        "Subscriber ID",
        "Serial",
        "State",
        "RX Power (dBm)",
        "TX Power (dBm)",
    ]


def _weak_rows(rows: list[WeakOnu]) -> list[list]:
    return [
        [
            r.olt_name,
            r.pon_port,
            r.onu_id,
            r.name,
            r.subscriber,
            r.serial,
            r.state,
            r.rx_power,
            r.tx_power,
        ]
        for r in rows
    ]


@router.get("/weakest/export")
async def weakest_export(
    format: str = Query(default="xlsx", pattern="^(xlsx|pdf)$"),
    olt_id: int | None = None,
    port: str = "",
    limit: int = Query(default=10, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
):
    rep = await weakest_report(olt_id=olt_id, port=port, limit=limit, db=db)
    title = "Weakest Optical Signals (Top %d)" % limit
    if format == "pdf":
        return pdf_response(title, "weakest-signals.pdf", _weak_headers(), _weak_rows(rep.rows))
    return xlsx_response(title, "weakest-signals.xlsx", _weak_headers(), _weak_rows(rep.rows))
