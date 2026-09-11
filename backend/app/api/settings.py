from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Setting
from ..security import get_current_user, require_admin
from ..utils.time import set_app_tz

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingOut(BaseModel):
    key: str
    value: str


class SettingUpdate(BaseModel):
    value: str


@router.get("/maps-key")
async def get_maps_key(_user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Setting).where(Setting.key == "google_maps_api_key"))
    s = result.scalar_one_or_none()
    return {"key": "google_maps_api_key", "value": s.value if s else ""}


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
    if key == "timezone":
        set_app_tz(body.value)
    return SettingOut(key=s.key, value=s.value)


TIMEZONES = [
    "Asia/Dhaka", "Asia/Kolkata", "Asia/Karachi", "Asia/Kathmandu",
    "Asia/Colombo", "Asia/Bangkok", "Asia/Ho_Chi_Minh", "Asia/Jakarta",
    "Asia/Singapore", "Asia/Kuala_Lumpur", "Asia/Manila",
    "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Hong_Kong",
    "Asia/Taipei", "Asia/Dubai", "Asia/Riyadh", "Europe/London",
    "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
    "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
    "Pacific/Auckland", "Australia/Sydney", "UTC",
]


@router.get("/timezone/options")
async def get_timezone_options(_user=Depends(get_current_user)):
    return {"timezones": TIMEZONES, "default": "Asia/Dhaka"}
