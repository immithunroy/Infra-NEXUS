from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import OLTDevice, Onu, OnuDownEvent, OnuOutage, PortArea, User
from ..schemas import (
    DownEventOut,
    DownStartRequest,
    DownStatusOut,
    OutageOut,
    PortAreaOut,
    PortAreaUpsert,
)
from ..security import get_current_user, require_ops, require_write
from ..services import down_detector

router = APIRouter(
    prefix="/api/downs",
    tags=["down-detection"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/start", response_model=DownStatusOut)
async def start_detection(body: DownStartRequest, user: User = Depends(require_ops)):
    """Start live ONU down detection for an OLT (optionally a single port)."""
    config = down_detector.DownConfig(
        olt_id=body.olt_id,
        port=body.port.strip(),
        interval=body.interval,
        mass_threshold=body.mass_threshold,
    )
    try:
        return await down_detector.start(config)
    except ValueError as exc:
        return down_detector.status()  # keep single-session semantics; start raised


@router.post("/stop")
async def stop_detection(user: User = Depends(require_ops)):
    """Stop the running detection session."""
    stopped = down_detector.stop()
    return {"stopped": stopped}


@router.get("/status", response_model=DownStatusOut)
async def detection_status():
    return down_detector.status()


@router.get("/events", response_model=list[DownEventOut])
async def list_events(
    olt_id: int | None = None,
    port: str | None = None,
    kind: str | None = None,
    limit: int = Query(default=200, le=2000),
    db: AsyncSession = Depends(get_db),
):
    q = select(OnuDownEvent).order_by(OnuDownEvent.detected_at.desc()).limit(limit)
    if olt_id is not None:
        q = q.where(OnuDownEvent.olt_id == olt_id)
    if port:
        q = q.where(OnuDownEvent.pon_port.like(f"{port.strip()}%"))
    if kind:
        q = q.where(OnuDownEvent.kind == kind)
    return (await db.execute(q)).scalars().all()


@router.get("/outages", response_model=list[OutageOut])
async def list_outages(
    resolved: bool | None = None,
    limit: int = Query(default=50, le=500),
    db: AsyncSession = Depends(get_db),
):
    q = select(OnuOutage).order_by(OnuOutage.started_at.desc()).limit(limit)
    if resolved is not None:
        q = q.where(OnuOutage.resolved.is_(resolved))
    return (await db.execute(q)).scalars().all()


@router.get("/ports")
async def list_ports(
    olt_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Distinct PON port bases for an OLT (for the filter dropdown)."""
    rows = (
        await db.execute(
            select(Onu.pon_port)
            .where(Onu.olt_id == olt_id, Onu.pon_port != "")
            .distinct()
            .order_by(Onu.pon_port)
        )
    ).scalars().all()
    seen: set[str] = set()
    ports: list[str] = []
    for p in rows:
        base = p.rsplit(":", 1)[0] if ":" in p else p
        if base not in seen:
            seen.add(base)
            ports.append(base)
    return {"ports": ports}


@router.get("/areas", response_model=list[PortAreaOut])
async def list_areas(
    olt_id: int | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Area labels for ports (optionally for one OLT)."""
    q = select(PortArea).order_by(PortArea.olt_id, PortArea.port)
    if olt_id is not None:
        q = q.where(PortArea.olt_id == olt_id)
    return (await db.execute(q)).scalars().all()


@router.put("/areas", response_model=PortAreaOut)
async def upsert_area(body: PortAreaUpsert, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    """Create or update an area label for an OLT + port base."""
    if not body.port.strip():
        raise HTTPException(status_code=422, detail="port is required")
    olt = await db.get(OLTDevice, body.olt_id)
    if olt is None:
        raise HTTPException(status_code=404, detail="OLT not found")
    res = await db.execute(
        select(PortArea).where(PortArea.olt_id == body.olt_id, PortArea.port == body.port.strip())
    )
    area = res.scalar_one_or_none()
    if area is None:
        area = PortArea(olt_id=body.olt_id, port=body.port.strip(), label=body.label.strip())
        db.add(area)
    else:
        area.label = body.label.strip()
    await db.commit()
    await db.refresh(area)
    return area
