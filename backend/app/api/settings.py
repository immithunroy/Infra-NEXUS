from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Setting
from ..security import require_admin

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingOut(BaseModel):
    key: str
    value: str


class SettingUpdate(BaseModel):
    value: str


@router.get("", response_model=list[SettingOut])
async def list_settings(_user=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Setting))
    return [SettingOut(key=s.key, value=s.value) for s in result.scalars().all()]


@router.get("/{key}", response_model=SettingOut)
async def get_setting(key: str, _user=Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Setting).where(Setting.key == key))
    s = result.scalar_one_or_none()
    if s is None:
        raise HTTPException(status_code=404, detail="Setting not found")
    return SettingOut(key=s.key, value=s.value)


@router.put("/{key}", response_model=SettingOut)
async def upsert_setting(
    key: str,
    body: SettingUpdate,
    _user=Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Setting).where(Setting.key == key))
    s = result.scalar_one_or_none()
    if s is None:
        s = Setting(key=key, value=body.value)
        db.add(s)
    else:
        s.value = body.value
    await db.commit()
    return SettingOut(key=s.key, value=s.value)
