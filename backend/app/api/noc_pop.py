"""NOC and POP management endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Noc, Pop, OLTDevice

router = APIRouter(prefix="/api/noc-pop", tags=["noc-pop"])


# --- NOC ---

class NocCreate(BaseModel):
    name: str
    address: str = ""
    gps_lat: float | None = None
    gps_lng: float | None = None
    contact_name: str = ""
    contact_phone: str = ""
    notes: str = ""


class NocUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    gps_lat: float | None = None
    gps_lng: float | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    notes: str | None = None


@router.get("/nocs")
async def list_nocs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Noc).order_by(Noc.name))
    nocs = result.scalars().all()
    items = []
    for n in nocs:
        devices = (await db.execute(
            select(OLTDevice).where(OLTDevice.noc_id == n.id)
        )).scalars().all()
        items.append({
            "id": n.id, "name": n.name, "address": n.address,
            "gps_lat": n.gps_lat, "gps_lng": n.gps_lng,
            "contact_name": n.contact_name, "contact_phone": n.contact_phone,
            "notes": n.notes, "created_at": str(n.created_at) if n.created_at else "",
            "device_count": len(devices),
        })
    return items


@router.post("/nocs")
async def create_noc(data: NocCreate, db: AsyncSession = Depends(get_db)):
    noc = Noc(**data.model_dump())
    db.add(noc)
    await db.commit()
    await db.refresh(noc)
    return {"id": noc.id, "message": "NOC created"}


@router.put("/nocs/{noc_id}")
async def update_noc(noc_id: int, data: NocUpdate, db: AsyncSession = Depends(get_db)):
    noc = (await db.execute(select(Noc).where(Noc.id == noc_id))).scalar_one_or_none()
    if not noc:
        raise HTTPException(404, "NOC not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(noc, k, v)
    await db.commit()
    return {"message": "NOC updated"}


@router.delete("/nocs/{noc_id}")
async def delete_noc(noc_id: int, db: AsyncSession = Depends(get_db)):
    noc = (await db.execute(select(Noc).where(Noc.id == noc_id))).scalar_one_or_none()
    if not noc:
        raise HTTPException(404, "NOC not found")
    await db.delete(noc)
    await db.commit()
    return {"message": "NOC deleted"}


# --- POP ---

class PopCreate(BaseModel):
    name: str
    address: str = ""
    gps_lat: float | None = None
    gps_lng: float | None = None
    contact_name: str = ""
    contact_phone: str = ""
    notes: str = ""


class PopUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    gps_lat: float | None = None
    gps_lng: float | None = None
    contact_name: str | None = None
    contact_phone: str | None = None
    notes: str | None = None


@router.get("/pops")
async def list_pops(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Pop).order_by(Pop.name))
    pops = result.scalars().all()
    items = []
    for p in pops:
        devices = (await db.execute(
            select(OLTDevice).where(OLTDevice.pop_id == p.id)
        )).scalars().all()
        items.append({
            "id": p.id, "name": p.name, "address": p.address,
            "gps_lat": p.gps_lat, "gps_lng": p.gps_lng,
            "contact_name": p.contact_name, "contact_phone": p.contact_phone,
            "notes": p.notes, "created_at": str(p.created_at) if p.created_at else "",
            "device_count": len(devices),
        })
    return items


@router.post("/pops")
async def create_pop(data: PopCreate, db: AsyncSession = Depends(get_db)):
    pop = Pop(**data.model_dump())
    db.add(pop)
    await db.commit()
    await db.refresh(pop)
    return {"id": pop.id, "message": "POP created"}


@router.put("/pops/{pop_id}")
async def update_pop(pop_id: int, data: PopUpdate, db: AsyncSession = Depends(get_db)):
    pop = (await db.execute(select(Pop).where(Pop.id == pop_id))).scalar_one_or_none()
    if not pop:
        raise HTTPException(404, "POP not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(pop, k, v)
    await db.commit()
    return {"message": "POP updated"}


@router.delete("/pops/{pop_id}")
async def delete_pop(pop_id: int, db: AsyncSession = Depends(get_db)):
    pop = (await db.execute(select(Pop).where(Pop.id == pop_id))).scalar_one_or_none()
    if not pop:
        raise HTTPException(404, "POP not found")
    await db.delete(pop)
    await db.commit()
    return {"message": "POP deleted"}


# --- Assign device to NOC/POP ---

class AssignDevice(BaseModel):
    noc_id: int | None = None
    pop_id: int | None = None


@router.put("/assign-device/{device_id}")
async def assign_device(device_id: int, data: AssignDevice, db: AsyncSession = Depends(get_db)):
    olt = (await db.execute(select(OLTDevice).where(OLTDevice.id == device_id))).scalar_one_or_none()
    if not olt:
        raise HTTPException(404, "OLT device not found")
    olt.noc_id = data.noc_id
    olt.pop_id = data.pop_id
    await db.commit()
    return {"message": "Device assigned"}
