from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Binding, MacEntry, MikrotikDevice, OLTDevice, Onu, PppActiveEntry, User
from ..schemas import BindingOut, MacEntryOut, PppActiveOut
from ..security import get_current_user, require_ops
from ..services.mac_binding import run_bindings
from ..services.mac_vendor import vendor_map

router = APIRouter(prefix="/api/bindings", tags=["bindings"], dependencies=[Depends(get_current_user)])


@router.post("/run")
async def trigger_bindings(user: User = Depends(require_ops), db: AsyncSession = Depends(get_db)):
    summary = await run_bindings(db)
    return summary


@router.get("", response_model=list[BindingOut])
async def list_bindings(
    bound: bool | None = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(Binding).order_by(Binding.mac)
    if bound is not None:
        q = q.where(Binding.bound.is_(bound))
    rows = (await db.execute(q)).scalars().all()

    olt_names = {d.id: d.name for d in (await db.execute(select(OLTDevice))).scalars()}
    mkt_names = {d.id: d.name for d in (await db.execute(select(MikrotikDevice))).scalars()}
    onu_names = {o.id: (o.name or o.pon_port) for o in (await db.execute(select(Onu))).scalars()}

    out = []
    for b in rows:
        out.append(
            BindingOut(
                mac=b.mac,
                olt_id=b.olt_id,
                olt_name=olt_names.get(b.olt_id, ""),
                olt_port=b.olt_port,
                mikrotik_id=b.mikrotik_id,
                mikrotik_name=mkt_names.get(b.mikrotik_id or -1, ""),
                mikrotik_ip=b.mikrotik_ip,
                mikrotik_interface=b.mikrotik_interface,
                subscriber=b.subscriber,
                onu_id=b.onu_id,
                onu_name=onu_names.get(b.onu_id or -1, ""),
                bound=b.bound,
                last_checked=b.last_checked,
            )
        )
    vendors = await vendor_map(db, [b.mac for b in rows])
    for b, item in zip(rows, out):
        item.mac_vendor = vendors.get(b.mac.lower(), "")
    return out


@router.get("/olts", response_model=list[MacEntryOut])
async def list_olt_macs(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(MacEntry).order_by(MacEntry.mac))).scalars().all()
    names = {d.id: d.name for d in (await db.execute(select(OLTDevice))).scalars()}
    out = [
        MacEntryOut(
            mac=e.mac,
            port=e.port,
            vlan=e.vlan,
            last_seen=e.last_seen,
            olt_id=e.olt_id,
            olt_name=names.get(e.olt_id, ""),
        )
        for e in rows
    ]
    vendors = await vendor_map(db, [e.mac for e in rows])
    for e, item in zip(rows, out):
        item.mac_vendor = vendors.get(e.mac.lower(), "")
    return out


@router.get("/active", response_model=list[PppActiveOut])
async def list_active_sessions(db: AsyncSession = Depends(get_db)):
    """Live PPPoE sessions from the Mikrotik /ppp/active table.

    The authoritative subscriber ID + MAC (caller-id) source - the Mikrotik
    validated each subscriber's secret when the session came up.
    """
    rows = (await db.execute(select(PppActiveEntry).order_by(PppActiveEntry.mac))).scalars().all()
    names = {d.id: d.name for d in (await db.execute(select(MikrotikDevice))).scalars()}
    out = [
        PppActiveOut(
            mac=e.mac,
            ip=e.ip,
            interface=e.interface,
            subscriber=e.subscriber,
            last_seen=e.last_seen,
            device_id=e.device_id,
            device_name=names.get(e.device_id, ""),
        )
        for e in rows
    ]
    vendors = await vendor_map(db, [e.mac for e in rows])
    for e, item in zip(rows, out):
        item.mac_vendor = vendors.get(e.mac.lower(), "")
    return out