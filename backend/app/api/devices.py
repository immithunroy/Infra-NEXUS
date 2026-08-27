from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import OLTDevice, Onu, User, MikrotikDevice, SwitchDevice, BgpSession, BgpRoute, BgpPrefixSnapshot
from ..schemas import (
    BgpSessionOut,
    BgpPrefixSnapshotOut,
    MikrotikCreate,
    MikrotikOut,
    MikrotikUpdate,
    OLTDeviceCreate,
    OLTDeviceOut,
    OLTDeviceUpdate,
    OnuBandwidthRequest,
    SwitchCreate,
    SwitchOut,
    SwitchUpdate,
    ScanResult,
    TestResult,
)
from ..security import get_current_user, require_ops, require_write
from ..services import collector

router = APIRouter(prefix="/api/devices", tags=["devices"], dependencies=[Depends(get_current_user)])


# ------------------------------------------------------------------ OLTs
@router.get("/olts", response_model=list[OLTDeviceOut])
async def list_olts(db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(OLTDevice, func.count(Onu.id), func.string_agg(func.distinct(Onu.pon_port), ","))
        .outerjoin(Onu, Onu.olt_id == OLTDevice.id)
        .group_by(OLTDevice.id)
        .order_by(OLTDevice.id)
    )
    out = []
    for device, count, portstr in res.all():
        item = OLTDeviceOut.model_validate(device)
        item.onu_count = count
        if portstr:
            bases = set()
            for p in portstr.split(","):
                if p:
                    base = p.rsplit(":", 1)[0] if ":" in p else p
                    bases.add(base)
            item.ports = sorted(bases)
        out.append(item)
    return out


@router.post("/olts", response_model=OLTDeviceOut)
async def create_olt(body: OLTDeviceCreate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    data = body.model_dump()
    data["port_capacity"] = 128 if data.get("pon_type", "gpon") == "gpon" else 64
    device = OLTDevice(**data)
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


@router.put("/olts/{olt_id}", response_model=OLTDeviceOut)
async def update_olt(olt_id: int, body: OLTDeviceUpdate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    device = await db.get(OLTDevice, olt_id)
    if device is None:
        raise HTTPException(status_code=404, detail="OLT not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(device, field, value)
    if body.pon_type is not None:
        device.port_capacity = 128 if body.pon_type == "gpon" else 64
    await db.commit()
    await db.refresh(device)
    return device


@router.delete("/olts/{olt_id}", status_code=204)
async def delete_olt(olt_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    device = await db.get(OLTDevice, olt_id)
    if device is None:
        raise HTTPException(status_code=404, detail="OLT not found")
    await db.delete(device)
    await db.commit()


@router.post("/olts/{olt_id}/test", response_model=TestResult)
async def test_olt(olt_id: int, user: User = Depends(require_ops), db: AsyncSession = Depends(get_db)):
    try:
        message = await collector.test_olt(db, olt_id)
        return TestResult(success=True, message=message)
    except Exception as exc:
        return TestResult(success=False, message=str(exc))


@router.post("/olts/{olt_id}/scan", response_model=ScanResult)
async def scan_olt(olt_id: int, user: User = Depends(require_ops), db: AsyncSession = Depends(get_db)):
    try:
        log = await collector.scan_olt(db, olt_id)
        return ScanResult(success=log.status.value == "success", message=log.message, log_id=log.id)
    except Exception as exc:
        return ScanResult(success=False, message=str(exc))


# ------------------------------------------------------------- Mikrotiks
@router.get("/mikrotiks", response_model=list[MikrotikOut])
async def list_mikrotiks(db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(MikrotikDevice).order_by(MikrotikDevice.id))
    return res.scalars().all()


@router.post("/mikrotiks", response_model=MikrotikOut)
async def create_mikrotik(body: MikrotikCreate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    device = MikrotikDevice(**body.model_dump())
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


@router.put("/mikrotiks/{device_id}", response_model=MikrotikOut)
async def update_mikrotik(device_id: int, body: MikrotikUpdate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    device = await db.get(MikrotikDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Mikrotik not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(device, field, value)
    await db.commit()
    await db.refresh(device)
    return device


@router.delete("/mikrotiks/{device_id}", status_code=204)
async def delete_mikrotik(device_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    device = await db.get(MikrotikDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Mikrotik not found")
    await db.delete(device)
    await db.commit()


@router.post("/mikrotiks/{device_id}/test", response_model=TestResult)
async def test_mikrotik(device_id: int, user: User = Depends(require_ops), db: AsyncSession = Depends(get_db)):
    try:
        message = await collector.test_mikrotik(db, device_id)
        return TestResult(success=True, message=message)
    except Exception as exc:
        return TestResult(success=False, message=str(exc))


@router.post("/mikrotiks/{device_id}/scan", response_model=ScanResult)
async def scan_mikrotik(device_id: int, user: User = Depends(require_ops), db: AsyncSession = Depends(get_db)):
    try:
        log = await collector.scan_mikrotik(db, device_id)
        return ScanResult(success=log.status.value == "success", message=log.message, log_id=log.id)
    except Exception as exc:
        return ScanResult(success=False, message=str(exc))


# --------------------------------------------------------- Rejected ONUs

from ..drivers.bdcom import BdcomCliDriver  # noqa: E402
from ..schemas import OnuAuthorizeRequest, OnuDeleteRequest, OnuAddRequest, OnuDescriptionRequest, RejectedOnu  # noqa: E402


@router.get("/olts/{olt_id}/rejected", response_model=list[RejectedOnu])
async def list_rejected_onus(olt_id: int, user: User = Depends(require_ops), db: AsyncSession = Depends(get_db)):
    """Discover rejected/unauthorized ONUs on an OLT."""
    device = await db.get(OLTDevice, olt_id)
    if device is None:
        raise HTTPException(status_code=404, detail="OLT not found")
    driver = BdcomCliDriver(device)
    try:
        rejected = await driver.get_rejected_onus()
        return [
            RejectedOnu(
                olt_id=olt_id,
                pon_port=r["pon_port"],
                onu_id=r["onu_id"],
                serial=r["serial"],
                reason=r["reason"],
                raw_line=r["raw_line"],
                description=r.get("description", ""),
            )
            for r in rejected
        ]
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/olts/{olt_id}/authorize-onu")
async def authorize_rejected_onu(
    olt_id: int,
    body: OnuAuthorizeRequest,
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    """Authorize/add a rejected ONU on the OLT and add it to the application."""
    device = await db.get(OLTDevice, olt_id)
    if device is None:
        raise HTTPException(status_code=404, detail="OLT not found")

    # First authorize on the OLT via CLI
    driver = BdcomCliDriver(device)
    try:
        msg = await driver.authorize_onu(
            pon_port=body.pon_port,
            onu_id=body.onu_id,
            serial=body.serial,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OLT authorization failed: {exc}")

    # Then add to the application inventory
    base = body.pon_port.rsplit(":", 1)[0] if ":" in body.pon_port else body.pon_port
    from ..models import Onu as OnuModel, OnuSource, OnuState  # noqa: E402

    onu = OnuModel(
        olt_id=olt_id,
        source=OnuSource.manual,
        pon_port=base + f":{body.onu_id}",
        onu_id=body.onu_id,
        serial=body.serial,
        name=body.name,
    )
    db.add(onu)
    await db.commit()
    return {"ok": True, "message": msg}


@router.post("/olts/{olt_id}/delete-onu")
async def delete_onu_from_olt(
    olt_id: int,
    body: OnuDeleteRequest,
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    """Delete/deregister an ONU from the OLT."""
    device = await db.get(OLTDevice, olt_id)
    if device is None:
        raise HTTPException(status_code=404, detail="OLT not found")
    driver = BdcomCliDriver(device)
    try:
        msg = await driver.delete_onu(pon_port=body.pon_port, onu_id=body.onu_id)
        return {"ok": True, "message": msg}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/olts/{olt_id}/add-onu")
async def add_onu_to_olt(
    olt_id: int,
    body: OnuAddRequest,
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    """Add/register an ONU on the OLT and add to application inventory."""
    device = await db.get(OLTDevice, olt_id)
    if device is None:
        raise HTTPException(status_code=404, detail="OLT not found")
    driver = BdcomCliDriver(device)
    try:
        result = await driver.add_onu(pon_port=body.pon_port, identifier=body.identifier, description=body.description, sequence=body.sequence)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OLT add failed: {exc}")

    # Determine pon_port with sequence for inventory
    pon_type = "gpon" if "gpon" in body.pon_port.lower() else "epon"
    from ..models import Onu as OnuModel, OnuSource
    onu = OnuModel(
        olt_id=olt_id,
        source=OnuSource.manual,
        pon_port=result["pon_port"],
        onu_id=result["onu_id"],
        serial=body.identifier if pon_type == "gpon" else "",
        mac=body.identifier if pon_type == "epon" else "",
        name=body.description,
    )
    db.add(onu)
    await db.commit()
    return {"ok": True, "message": result["message"], "pon_port": result["pon_port"], "onu_id": result["onu_id"]}


@router.post("/olts/{olt_id}/set-description")
async def set_onu_description_on_olt(
    olt_id: int,
    body: OnuDescriptionRequest,
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    """Set ONU description on the OLT."""
    device = await db.get(OLTDevice, olt_id)
    if device is None:
        raise HTTPException(status_code=404, detail="OLT not found")
    driver = BdcomCliDriver(device)
    try:
        msg = await driver.set_onu_description(pon_port=body.pon_port, onu_id=body.onu_id, description=body.description)
        return {"ok": True, "message": msg}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/olts/{olt_id}/set-bandwidth")
async def set_onu_bandwidth_on_olt(
    olt_id: int,
    body: OnuBandwidthRequest,
    user: User = Depends(require_write),
    db: AsyncSession = Depends(get_db),
):
    """Set EPON ONU bandwidth (SLA) on the OLT."""
    device = await db.get(OLTDevice, olt_id)
    if device is None:
        raise HTTPException(status_code=404, detail="OLT not found")
    if device.pon_type.lower() != "epon":
        raise HTTPException(status_code=400, detail="Bandwidth setting is only supported for EPON OLTs")
    driver = BdcomCliDriver(device)
    try:
        msg = await driver.set_bandwidth(pon_port=body.pon_port, onu_id=body.onu_id, mode=body.mode)
        # Update DB
        res = await db.execute(
            select(Onu).where(Onu.olt_id == olt_id, Onu.pon_port == body.pon_port, Onu.onu_id == body.onu_id)
        )
        onu = res.scalar_one_or_none()
        if onu:
            onu.bandwidth_mode = body.mode
            await db.commit()
        return {"ok": True, "message": msg}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


# ------------------------------------------------------------------ Switches
@router.get("/switches", response_model=list[SwitchOut])
async def list_switches(db: AsyncSession = Depends(get_db)):
    from ..models import SwitchPort
    res = await db.execute(select(SwitchDevice).order_by(SwitchDevice.id))
    devices = res.scalars().all()
    result = []
    for d in devices:
        port_res = await db.execute(select(SwitchPort).where(SwitchPort.switch_id == d.id))
        d.ports = port_res.scalars().all()
        result.append(d)
    return result


@router.post("/switches", response_model=SwitchOut)
async def create_switch(body: SwitchCreate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    device = SwitchDevice(**body.model_dump())
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return device


@router.put("/switches/{switch_id}", response_model=SwitchOut)
async def update_switch(switch_id: int, body: SwitchUpdate, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    device = await db.get(SwitchDevice, switch_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Switch not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(device, field, value)
    await db.commit()
    await db.refresh(device)
    return device


@router.delete("/switches/{switch_id}", status_code=204)
async def delete_switch(switch_id: int, user: User = Depends(require_write), db: AsyncSession = Depends(get_db)):
    device = await db.get(SwitchDevice, switch_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Switch not found")
    await db.delete(device)
    await db.commit()


@router.post("/switches/{switch_id}/test", response_model=TestResult)
async def test_switch(switch_id: int, user: User = Depends(require_ops), db: AsyncSession = Depends(get_db)):
    device = await db.get(SwitchDevice, switch_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Switch not found")
    try:
        from ..drivers.bdcom import BdcomCliDriver
        cli = BdcomCliDriver.__new__(BdcomCliDriver)
        cli.device = type("D", (), {
            "ip": device.ip, "port": device.port, "username": device.username,
            "password": device.password, "enable_password": device.enable_password,
            "access_method": type("M", (), {"value": device.access_method})(),
        })()
        cli.method = device.access_method
        cli.timeout = 15.0
        cli._telnet = None
        cli._ssh = None
        cli._reader = None
        cli._writer = None
        cli.prompt_line = ""
        await cli.connect()
        version = await cli._exec("show version", timeout=12)
        cli.close()
        msg = version.strip().splitlines()[0] if version.strip() else "OK"
        device.status = "reachable"
        device.last_message = msg[:1000]
        await db.commit()
        return TestResult(success=True, message=f"Connected. {msg}")
    except Exception as exc:
        device.status = "unreachable"
        device.last_message = str(exc)[:1000]
        await db.commit()
        return TestResult(success=False, message=str(exc))


@router.post("/switches/{switch_id}/scan", response_model=TestResult)
async def scan_switch(switch_id: int, user: User = Depends(require_ops), db: AsyncSession = Depends(get_db)):
    device = await db.get(SwitchDevice, switch_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Switch not found")
    try:
        from ..drivers.bdcom import BdcomCliDriver
        from ..models import SwitchPort
        from datetime import datetime, timezone

        cli = BdcomCliDriver.__new__(BdcomCliDriver)
        cli.device = type("D", (), {
            "ip": device.ip, "port": device.port, "username": device.username,
            "password": device.password, "enable_password": device.enable_password,
            "access_method": type("M", (), {"value": device.access_method})(),
        })()
        cli.method = device.access_method
        cli.timeout = 15.0
        cli._telnet = None
        cli._ssh = None
        cli._reader = None
        cli._writer = None
        cli.prompt_line = ""
        await cli.connect()

        # Discover ports
        output = await cli._exec("show interface status", timeout=30)
        cli.close()

        now = datetime.now(timezone.utc)
        discovered = []
        for line in output.splitlines():
            parts = line.split()
            if len(parts) < 2:
                continue
            pname = parts[0]
            # Skip header/separator lines
            if pname.startswith("Port") or pname.startswith("---") or pname.startswith("Gi") is False and pname.startswith("Fa") is False and pname.startswith("Eth") is False and pname.startswith("Te") is False and pname.startswith("Tw") is False:
                continue
            # Try to parse: Port Status Vlan Duplex Speed Type
            pstatus = parts[1] if len(parts) > 1 else "unknown"
            pstatus = pstatus.lower()
            if pstatus not in ("connected", "notconnect", "up", "down", "disabled"):
                pstatus = "unknown"
            pstatus = "up" if pstatus in ("connected", "up") else "down"
            pvl = parts[2] if len(parts) > 2 else ""
            pspeed = parts[4] if len(parts) > 4 else ""
            # Find or create port in DB
            port_res = await db.execute(
                select(SwitchPort).where(SwitchPort.switch_id == device.id, SwitchPort.name == pname)
            )
            port = port_res.scalars().first()
            if port is None:
                port = SwitchPort(switch_id=device.id, name=pname)
                db.add(port)
            port.status = pstatus
            port.vlan = pvl if pvl.isdigit() else ""
            port.speed = pspeed
            port.last_scan_at = now
            discovered.append(pname)

        device.status = "reachable"
        device.last_message = f"Discovered {len(discovered)} ports"
        device.last_scan_at = now
        device.port_count = len(discovered) or device.port_count
        await db.commit()
        return TestResult(success=True, message=f"Scan complete. Discovered {len(discovered)} ports.")
    except Exception as exc:
        device.status = "unreachable"
        device.last_message = str(exc)[:1000]
        await db.commit()
        return TestResult(success=False, message=str(exc))


# ---------------------------------------------------------------------------
# BGP endpoints
# ---------------------------------------------------------------------------

@router.get("/mikrotiks/{mikrotik_id}/bgp", response_model=list[BgpSessionOut])
async def list_bgp_sessions(mikrotik_id: int, db: AsyncSession = Depends(get_db)):
    device = await db.get(MikrotikDevice, mikrotik_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Mikrotik device not found")
    result = await db.execute(
        select(BgpSession).where(BgpSession.device_id == mikrotik_id).order_by(BgpSession.state.desc(), BgpSession.remote_ip)
    )
    return result.scalars().all()


@router.get("/mikrotiks/{mikrotik_id}/bgp/{session_id}/routes")
async def list_bgp_routes(mikrotik_id: int, session_id: int, db: AsyncSession = Depends(get_db)):
    device = await db.get(MikrotikDevice, mikrotik_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Mikrotik device not found")
    bgp_session = await db.get(BgpSession, session_id)
    if bgp_session is None or bgp_session.device_id != mikrotik_id:
        raise HTTPException(status_code=404, detail="BGP session not found")
    result = await db.execute(
        select(BgpRoute).where(BgpRoute.session_id == session_id).order_by(BgpRoute.prefix)
    )
    return result.scalars().all()


@router.get("/mikrotiks/{mikrotik_id}/bgp/{session_id}/snapshots", response_model=list[BgpPrefixSnapshotOut])
async def list_bgp_snapshots(mikrotik_id: int, session_id: int, hours: int = 168, db: AsyncSession = Depends(get_db)):
    """Return prefix count history for graphing (default 7 days, max 8760 = 1 year)."""
    from datetime import timedelta
    device = await db.get(MikrotikDevice, mikrotik_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Mikrotik device not found")
    bgp_session = await db.get(BgpSession, session_id)
    if bgp_session is None or bgp_session.device_id != mikrotik_id:
        raise HTTPException(status_code=404, detail="BGP session not found")
    since = utcnow() - timedelta(hours=min(hours, 8760))
    result = await db.execute(
        select(BgpPrefixSnapshot)
        .where(BgpPrefixSnapshot.session_id == session_id, BgpPrefixSnapshot.recorded_at >= since)
        .order_by(BgpPrefixSnapshot.recorded_at)
    )
    return result.scalars().all()


@router.get("/bgp/all-sessions")
async def list_all_bgp_sessions(db: AsyncSession = Depends(get_db)):
    """Return all BGP sessions across all Mikrotik devices with device name."""
    from ..models import MikrotikDevice
    devices = (await db.execute(select(MikrotikDevice))).scalars().all()
    device_map = {d.id: d.name for d in devices}
    result = await db.execute(
        select(BgpSession).order_by(BgpSession.is_upstream.desc(), BgpSession.device_id, BgpSession.state.desc(), BgpSession.remote_ip)
    )
    sessions = result.scalars().all()
    out = []
    for s in sessions:
        d = {
            "id": s.id, "device_id": s.device_id, "device_name": device_map.get(s.device_id, "?"),
            "name": s.name, "remote_as": s.remote_as, "remote_ip": s.remote_ip,
            "local_ip": s.local_ip, "local_as": s.local_as, "address_family": s.address_family,
            "state": s.state, "uptime": s.uptime, "prefix_count": s.prefix_count,
            "advertised_count": s.advertised_count, "is_upstream": s.is_upstream,
            "last_scan_at": s.last_scan_at,
        }
        out.append(d)
    return out


@router.put("/bgp/sessions/{session_id}/toggle-upstream")
async def toggle_upstream(session_id: int, db: AsyncSession = Depends(get_db)):
    """Toggle is_upstream flag on a BGP session."""
    from fastapi.responses import JSONResponse
    res = await db.execute(select(BgpSession).where(BgpSession.id == session_id))
    session = res.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "BGP session not found")
    session.is_upstream = not session.is_upstream
    await db.commit()
    return {"id": session.id, "is_upstream": session.is_upstream}


@router.get("/bgp/snapshots-all", response_model=list[BgpPrefixSnapshotOut])
async def list_all_bgp_snapshots(hours: int = 168, db: AsyncSession = Depends(get_db)):
    """Return all prefix snapshots across all sessions (for total graph)."""
    from datetime import timedelta
    since = utcnow() - timedelta(hours=min(hours, 8760))
    result = await db.execute(
        select(BgpPrefixSnapshot)
        .where(BgpPrefixSnapshot.recorded_at >= since)
        .order_by(BgpPrefixSnapshot.recorded_at)
    )
    return result.scalars().all()