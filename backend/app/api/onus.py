from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..drivers.bdcom import BdcomCliDriver
from ..models import OLTDevice, Onu, OnuSource, Ticket, TicketStatus, User
from ..schemas import OnuCreate, OnuOut, OnuPortControl, OnuUpdate
from ..security import get_current_user, require_gps_write, require_write, user_role
from ..services.mac_vendor import vendor_map
from ..utils.status import display_status

router = APIRouter(prefix="/api/onus", tags=["onus"], dependencies=[Depends(get_current_user)])


async def _load_onu(db: AsyncSession, onu_id: int) -> Onu:
    res = await db.execute(select(Onu).options(selectinload(Onu.olt)).where(Onu.id == onu_id))
    onu = res.scalar_one_or_none()
    if onu is None:
        raise HTTPException(status_code=404, detail="ONU not found")
    return onu


@router.get("", response_model=list[OnuOut])
async def list_onus(
    olt_id: int | None = Query(default=None),
    pon_port: str | None = Query(default=None),
    state: str | None = Query(default=None),
    source: str | None = Query(default=None),
    search: str | None = Query(default=None),
    bound: bool | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    q = select(Onu).options(selectinload(Onu.olt)).order_by(Onu.olt_id, Onu.pon_port, Onu.onu_id)
    if olt_id is not None:
        q = q.where(Onu.olt_id == olt_id)
    if pon_port:
        base = pon_port.strip().rstrip(":")
        q = q.where(
            (Onu.pon_port == pon_port)
            | (Onu.pon_port.like(f"{base}:%"))
        )
    if state:
        q = q.where(Onu.state == state)
    if source:
        q = q.where(Onu.source == source)
    if bound is not None:
        q = q.where(Onu.bound.is_(bound))
    if search:
        like = f"%{search}%"
        id_filter = None
        try:
            id_filter = int(search)
        except ValueError:
            pass
        cond = (
            Onu.name.ilike(like)
            | Onu.serial.ilike(like)
            | Onu.mac.ilike(like)
            | Onu.pon_port.ilike(like)
            | Onu.last_mac.ilike(like)
            | Onu.subscriber.ilike(like)
        )
        if id_filter is not None:
            cond = cond | (Onu.onu_id == id_filter)
        q = q.where(cond)
    res = await db.execute(q)
    rows = res.scalars().all()
    vendors = await vendor_map(db, [onu.last_mac or onu.mac for onu in rows])
    out = [_to_out(onu) for onu in rows]
    for onu, item in zip(rows, out):
        item.mac_vendor = vendors.get((onu.last_mac or onu.mac).lower(), "")
    return out


def _to_out(onu: Onu) -> OnuOut:
    out = OnuOut.model_validate(onu)
    out.olt_name = onu.olt.name if onu.olt else ""
    out.down_reason = onu.down_reason or ""
    out.status = display_status(out.state, out.bound, out.down_reason)
    return out


@router.get("/{onu_id}", response_model=OnuOut)
async def get_onu(onu_id: int, db: AsyncSession = Depends(get_db)):
    onu = await _load_onu(db, onu_id)
    return _to_out(onu)


@router.post("/{onu_id}/check-status")
async def check_onu_status(onu_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    """Real-time ONU check via OLT CLI: optical power, status, last up time."""
    onu = await _load_onu(db, onu_id)
    if not onu.olt:
        raise HTTPException(status_code=400, detail="OLT not associated with this ONU")
    driver = BdcomCliDriver(onu.olt)
    try:
        result = await driver.check_onu_realtime(pon_port=onu.pon_port, onu_id=onu.onu_id)
        return result
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("", response_model=OnuOut)
async def create_onu(body: OnuCreate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    """Add an ONU/ONT to the application inventory.

    This is application-only bookkeeping and never talks to the Mikrotik
    or the OLT.
    """
    olt = await db.get(OLTDevice, body.olt_id)
    if olt is None:
        raise HTTPException(status_code=404, detail="OLT not found")
    onu = Onu(olt_id=body.olt_id, source=OnuSource.manual, **body.model_dump(exclude={"olt_id"}))
    db.add(onu)
    await db.commit()
    await db.refresh(onu, attribute_names=["olt"])
    return _to_out(onu)


@router.put("/{onu_id}", response_model=OnuOut)
async def update_onu(
    onu_id: int,
    body: OnuUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    onu = await _load_onu(db, onu_id)
    data = body.model_dump(exclude_unset=True)

    # Role check: GPS/address/contact fields need GPS-write (field team);
    # network bookkeeping fields need global write. A user who has an open
    # ticket assigned to them for this ONU may also edit its GPS/address.
    gps_fields = {"gps_lat", "gps_lng", "gps_accuracy", "address", "phone", "email"}
    net_fields = {"name", "serial", "mac", "pon_port", "onu_id", "vlan", "note"}
    touch_gps = bool(gps_fields & set(data))
    touch_net = bool(net_fields & set(data))
    role = user_role(user)
    # Only admin/global-write edit GPS freely; everyone else (field team,
    # NOC, ...) may edit GPS/address ONLY for subscribers with an open ticket
    # assigned to them.
    gps_allowed = role in ("admin", "global_write")
    if touch_gps and not gps_allowed:
        assigned = (
            await db.execute(
                select(Ticket).where(
                    Ticket.assigned_to == user.id,
                    Ticket.onu_id == onu_id,
                    Ticket.status.in_((TicketStatus.open, TicketStatus.in_progress)),
                )
            )
        ).scalar_one_or_none()
        if assigned is None:
            raise HTTPException(status_code=403, detail="You can only update GPS/address for a subscriber assigned to you via an open ticket")
    if touch_net and role not in ("admin", "global_write"):
        raise HTTPException(status_code=403, detail="Your role cannot edit ONU settings")

    # GPS captured by a mobile phone is only trusted when the reported
    # accuracy is below 9 meters. Reject a save that violates that.
    accuracy = data.get("gps_accuracy")
    if accuracy is not None and accuracy >= 9:
        raise HTTPException(
            status_code=422,
            detail="GPS accuracy must be less than 9 meters (got {:.1f}m). Move to an open area and re-capture.".format(accuracy),
        )
    for field, value in data.items():
        setattr(onu, field, value)
    await db.commit()
    await db.refresh(onu, attribute_names=["olt"])
    return _to_out(onu)


@router.delete("/{onu_id}", status_code=204)
async def delete_onu(onu_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    """Remove an ONU/ONT from the application.

    Application-only removal; nothing is changed on the Mikrotik or OLT.
    """
    onu = await _load_onu(db, onu_id)
    await db.delete(onu)
    await db.commit()


@router.post("/port-control")
async def onu_port_control(
    body: OnuPortControl,
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    """Enable or disable an ONU Ethernet/UNI port on the OLT via CLI."""
    olt = await db.get(OLTDevice, body.olt_id)
    if olt is None:
        raise HTTPException(status_code=404, detail="OLT not found")

    driver = BdcomCliDriver(olt)
    try:
        msg = await driver.set_onu_eth_port(
            pon_port=body.pon_port,
            onu_id=body.onu_id,
            port_id=body.port_id,
            enable=body.enable,
        )
        return {"ok": True, "message": msg}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))