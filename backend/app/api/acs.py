import json
import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("olt_commander.acs")

from ..database import get_db
from ..models import AcsDevice, AcsJob, AcsMetric, AcsParameter, User
from ..schemas import (
    AcsDeviceOut,
    AcsJobOut,
    AcsMetricOut,
    AcsParameterOut,
    AcsWifiStatusOut,
    FirmwareRequest,
    WanConfigRequest,
    WifiChangeRequest,
)
from ..security import get_current_user, require_ops
from ..services import acs
from ..utils.time import utcnow

router = APIRouter(prefix="/api/acs", tags=["acs"])


# The raw CWMP endpoint is public (CPEs POST without a bearer token) and lives
# at /api/acs/cwmp (admin router has no auth dependency of its own). All other
# routes require an authenticated user.
@router.post("/cwmp", response_class=None)
async def cwmp_endpoint(request: Request, db: AsyncSession = Depends(get_db)):
    """TR-069 (CWMP) endpoint called by CPE home routers."""
    body = await request.body()
    ip = request.client.host if request.client else ""
    xml = await acs.handle_cwmp(db, body, ip)
    if not xml:
        # TR-069 expects a 204 No Content for empty responses.
        return Response(status_code=204)
    return Response(content=xml, media_type="text/xml")


@router.get("/devices", response_model=list[AcsDeviceOut])
async def list_devices(
    online: bool | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(AcsDevice).order_by(AcsDevice.last_inform.desc().nullslast())
    if online is not None:
        q = q.where(AcsDevice.online.is_(online))
    return (await db.execute(q)).scalars().all()


@router.get("/devices/{device_id}", response_model=AcsDeviceOut)
async def get_device(device_id: int, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    device = await db.get(AcsDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.get("/devices/{device_id}/parameters", response_model=list[AcsParameterOut])
async def device_parameters(
    device_id: int,
    search: str = "",
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    device = await db.get(AcsDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    q = select(AcsParameter).where(AcsParameter.device_id == device_id).order_by(AcsParameter.name)
    if search:
        like = f"%{search.lower()}%"
        rows = (await db.execute(q)).scalars().all()
        rows = [r for r in rows if like.strip("%") in r.name.lower()]
        return rows
    return (await db.execute(q)).scalars().all()


@router.get("/devices/{device_id}/wifi", response_model=AcsWifiStatusOut)
async def device_wifi(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Current WiFi config per band, read from the params the device reported."""
    device = await db.get(AcsDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    rows = (
        await db.execute(
            select(AcsParameter)
            .where(
                AcsParameter.device_id == device_id,
                AcsParameter.name.like("InternetGatewayDevice.LANDevice.1.WLANConfiguration.%"),
            )
            .order_by(AcsParameter.name)
        )
    ).scalars().all()
    if not rows:
        summary = (
            await db.execute(
                select(AcsParameter).where(
                    AcsParameter.device_id == device_id,
                    AcsParameter.name == "InternetGatewayDevice.DeviceSummary",
                )
            )
        ).scalar_one_or_none()
        return AcsWifiStatusOut(
            supported=False,
            summary=(summary.value if summary and summary.value else "No WiFi (WLANConfiguration) parameters reported by this device."),
        )

    return acs.build_wifi_status(rows)


@router.get("/devices/{device_id}/metrics", response_model=list[AcsMetricOut])
async def device_metrics(
    device_id: int,
    hours: int = Query(default=24, le=168),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    device = await db.get(AcsDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    since = utcnow() - timedelta(hours=hours)
    return (
        await db.execute(
            select(AcsMetric)
            .where(AcsMetric.device_id == device_id, AcsMetric.sampled_at >= since)
            .order_by(AcsMetric.sampled_at)
        )
    ).scalars().all()


@router.get("/devices/{device_id}/jobs", response_model=list[AcsJobOut])
async def device_jobs(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return (
        await db.execute(
            select(AcsJob).where(AcsJob.device_id == device_id).order_by(AcsJob.created_at.desc()).limit(50)
        )
    ).scalars().all()


async def _enqueue_job(db: AsyncSession, device_id: int, action: str, payload: dict) -> AcsJob:
    device = await db.get(AcsDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    job = AcsJob(
        device_id=device_id,
        action=action,
        payload=json.dumps(payload),
        command_key=f"{action}-{utcnow().strftime('%Y%m%d%H%M%S')}-{device_id}",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


@router.post("/devices/{device_id}/wifi", response_model=AcsJobOut)
async def change_wifi(
    device_id: int,
    body: WifiChangeRequest,
    user: User = Depends(require_ops),
    db: AsyncSession = Depends(get_db),
):
    if len(body.passphrase) < 8:
        raise HTTPException(status_code=422, detail="WiFi passphrase must be at least 8 characters")
    if body.band not in ("2.4g", "5g", "5g2", "all"):
        raise HTTPException(status_code=422, detail="band must be one of: 2.4g, 5g, 5g2, all")
    return await _enqueue_job(db, device_id, "wifi", {
        "ssid": body.ssid,
        "passphrase": body.passphrase,
        "enable": body.enable,
        "band": body.band,
    })


@router.post("/devices/{device_id}/wan", response_model=AcsJobOut)
async def push_wan_config(
    device_id: int,
    body: WanConfigRequest,
    user: User = Depends(require_ops),
    db: AsyncSession = Depends(get_db),
):
    payload = {
        "AddressingType": body.addressing_type,
        "IPAddress": body.ip_address,
        "SubnetMask": body.subnet_mask,
        "DefaultGateway": body.default_gateway,
        "DNSServers": body.dns_servers,
        "Username": body.username,
        "Password": body.password,
    }
    payload = {k: v for k, v in payload.items() if v}
    if not payload:
        raise HTTPException(status_code=422, detail="Provide at least one WAN setting to push")
    return await _enqueue_job(db, device_id, "wan", payload)


@router.post("/devices/{device_id}/firmware", response_model=AcsJobOut)
async def update_firmware(
    device_id: int,
    body: FirmwareRequest,
    user: User = Depends(require_ops),
    db: AsyncSession = Depends(get_db),
):
    if not body.url.startswith(("http://", "https://")):
        raise HTTPException(status_code=422, detail="Firmware URL must start with http(s)://")
    return await _enqueue_job(db, device_id, "firmware", {"url": body.url})


@router.post("/devices/{device_id}/reboot", response_model=AcsJobOut)
async def reboot_device(
    device_id: int,
    user: User = Depends(require_ops),
    db: AsyncSession = Depends(get_db),
):
    return await _enqueue_job(db, device_id, "reboot", {})
