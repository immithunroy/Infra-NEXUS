from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import MikrotikDevice, OLTDevice, Onu, User
from ..schemas import SearchDevice, SearchOnu, SearchResult
from ..security import get_current_user
from ..services.mac_vendor import vendor_map
from ..utils.status import display_status

router = APIRouter(prefix="/api/search", tags=["search"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=SearchResult)
async def search(q: str = Query(default="", max_length=80), db: AsyncSession = Depends(get_db)):
    term = q.strip()
    if len(term) < 2:
        return SearchResult(onus=[], olts=[], mikrotiks=[])
    like = f"%{term}%"

    onus = []
    for o, d in (
        await db.execute(
            select(Onu, OLTDevice)
            .join(OLTDevice, OLTDevice.id == Onu.olt_id)
            .where(
                or_(
                    Onu.name.ilike(like),
                    Onu.serial.ilike(like),
                    Onu.mac.ilike(like),
                    Onu.last_mac.ilike(like),
                    Onu.subscriber.ilike(like),
                    Onu.pon_port.ilike(like),
                )
            )
            .order_by(Onu.olt_id, Onu.pon_port)
            .limit(50)
        )
    ).all():
        state = o.state.value
        down_reason = o.down_reason or ""
        onus.append(
            SearchOnu(
                id=o.id,
                olt_id=o.olt_id,
                olt_name=d.name,
                pon_port=o.pon_port,
                name=o.name,
                serial=o.serial,
                subscriber=o.subscriber,
                last_mac=o.last_mac or o.mac,
                state=state,
                bound=o.bound,
                down_reason=down_reason,
                status=display_status(state, o.bound, down_reason),
            )
        )
    vendors = await vendor_map(db, [o.last_mac or o.mac for o in onus])
    for o in onus:
        o.mac_vendor = vendors.get((o.last_mac or o.mac).lower(), "")

    olts = [
        SearchDevice(id=d.id, name=d.name, ip=d.ip, kind="olt")
        for d in (
            await db.execute(
                select(OLTDevice).where(or_(OLTDevice.name.ilike(like), OLTDevice.ip.ilike(like))).limit(10)
            )
        ).scalars()
    ]

    mikrotiks = [
        SearchDevice(id=d.id, name=d.name, ip=d.ip, kind="mikrotik")
        for d in (
            await db.execute(
                select(MikrotikDevice)
                .where(or_(MikrotikDevice.name.ilike(like), MikrotikDevice.ip.ilike(like)))
                .limit(10)
            )
        ).scalars()
    ]

    return SearchResult(onus=onus, olts=olts, mikrotiks=mikrotiks)