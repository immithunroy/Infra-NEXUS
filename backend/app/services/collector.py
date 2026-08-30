"""Collection service.

Drives OLT and Mikrotik scans, persists ONUs / MAC tables / ARP tables and
keeps device health status up to date.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..drivers.bdcom import build_driver
from ..drivers.base import DriverError
from ..drivers.mikrotik import MikrotikDriver
from ..utils.time import utcnow
from ..models import (
    BgpRoute,
    BgpSession,
    MacEntry,
    MikrotikDevice,
    OLTDevice,
    Onu,
    OnuSource,
    OnuState,
    OnuTelemetry,
    PppActiveEntry,
    ScanLog,
    ScanStatus,
    ScanType,
)

logger = logging.getLogger("olt_commander.collector")


def _normalize_port(port: str) -> str:
    """Return a canonical upper-case PON/ONU port token for matching."""
    if not port:
        return ""
    return port.upper().replace(" ", "")


async def _start_log(session: AsyncSession, scan_type: ScanType, device_id: int, device_name: str) -> ScanLog:
    log = ScanLog(scan_type=scan_type, device_id=device_id, device_name=device_name)
    session.add(log)
    await session.commit()
    await session.refresh(log)
    return log


async def _finish_log(session: AsyncSession, log: ScanLog, status: ScanStatus, message: str) -> None:
    log.status = status
    log.message = message[:4000]
    log.finished_at = utcnow()
    await session.commit()


def _map_state(state: str) -> OnuState:
    """Map a device state word to the OnuState enum.

    Order matters: "inactive" contains "active" and "deregistered" contains
    "registered" as substrings, so the down words must be checked first.
    """
    state = (state or "unknown").lower()
    if "off-line" in state or "offline" in state or "lost" in state:
        return OnuState.offline
    if "inactive" in state or "deregistered" in state or "auth-fail" in state:
        return OnuState.inactive
    if "active" in state or "authorized" in state or "registered" in state or "auto-configured" in state or "online" in state:
        return OnuState.active
    return OnuState.unknown


async def _upsert_onu(
    session: AsyncSession,
    olt_id: int,
    pon_port: str,
    onu_id: int,
    serial: str,
    state: OnuState,
    rx: float | None,
    tx: float | None,
    description: str = "",
    down_reason: str = "",
    mac: str = "",
    distance: float | None = None,
) -> Onu:
    key = (_normalize_port(pon_port), onu_id)
    res = await session.execute(
        select(Onu).where(Onu.olt_id == olt_id, Onu.pon_port == key[0], Onu.onu_id == key[1])
    )
    onu = res.scalar_one_or_none()
    if onu is None and serial:
        res = await session.execute(select(Onu).where(Onu.olt_id == olt_id, Onu.serial == serial))
        onu = res.scalar_one_or_none()
    if onu is None:
        onu = Onu(
            olt_id=olt_id,
            source=OnuSource.auto,
            pon_port=key[0],
            onu_id=key[1],
            serial=serial or "",
        )
        session.add(onu)
    onu.state = state
    onu.serial = serial or onu.serial
    if mac:
        onu.mac = mac
    if distance is not None:
        onu.distance = distance
    # Clear down_reason when ONU is active; otherwise keep the latest reason.
    if state == OnuState.active:
        onu.down_reason = ""
    elif down_reason:
        onu.down_reason = down_reason
    if description and description.strip() and onu.name != description.strip():
        onu.name = description.strip()[:256]
    # Only overwrite optics with a real reading; a None here would wipe the
    # freshest value a telemetry sample just stored.
    if rx is not None:
        onu.rx_power = rx
    if tx is not None:
        onu.tx_power = tx
    onu.last_seen = utcnow()
    await session.flush()
    return onu


async def _upsert_mac(session: AsyncSession, olt_id: int, mac: str, port: str, vlan: int) -> None:
    res = await session.execute(select(MacEntry).where(MacEntry.olt_id == olt_id, MacEntry.mac == mac))
    entry = res.scalar_one_or_none()
    now = utcnow()
    if entry is None:
        session.add(MacEntry(olt_id=olt_id, mac=mac, port=_normalize_port(port), vlan=vlan, last_seen=now))
    else:
        entry.port = _normalize_port(port) or entry.port
        entry.vlan = vlan or entry.vlan
        entry.last_seen = now


async def scan_olt(session: AsyncSession, olt_id: int) -> ScanLog:
    device = await session.get(OLTDevice, olt_id)
    if device is None:
        raise ValueError(f"OLT device {olt_id} not found")
    log = await _start_log(session, ScanType.olt, olt_id, device.name)
    if not device.enabled:
        await _finish_log(session, log, ScanStatus.failed, "Device disabled")
        return log

    driver = build_driver(device)
    try:
        onus = await driver.get_onus()
        macs = await driver.get_macs()
    except DriverError as exc:
        device.status = "unreachable"
        device.last_message = str(exc)[:1000]
        device.last_scan_at = utcnow()
        await _finish_log(session, log, ScanStatus.failed, str(exc))
        await session.commit()
        return log
    except Exception as exc:
        device.status = "unreachable"
        device.last_message = str(exc)[:1000]
        device.last_scan_at = utcnow()
        await _finish_log(session, log, ScanStatus.failed, f"Unexpected error: {exc}")
        await session.commit()
        return log

    seen_macs: set[str] = set()
    for onu_info in onus:
        await _upsert_onu(
            session,
            olt_id,
            onu_info.pon_port,
            onu_info.onu_id,
            onu_info.serial,
            _map_state(onu_info.state),
            onu_info.rx,
            onu_info.tx,
            onu_info.description,
            onu_info.dereg_reason,
            mac=onu_info.extra.get("mac", ""),
            distance=onu_info.extra.get("distance"),
        )
    for mac_info in macs:
        seen_macs.add(mac_info.mac)
        await _upsert_mac(session, olt_id, mac_info.mac, mac_info.port, mac_info.vlan)

    if macs:
        # Purge MACs no longer present on the device (client disconnected).
        await session.execute(
            delete(MacEntry).where(MacEntry.olt_id == olt_id, MacEntry.mac.notin_(seen_macs))
        )

    await session.flush()
    device.status = "reachable"
    device.last_scan_at = utcnow()

    # Collect PON port descriptions (best-effort)
    try:
        port_descs = await driver.get_port_descriptions()
        if port_descs:
            import json
            device.port_descriptions = json.dumps(port_descs)
    except Exception as exc:
        logger.debug("Port description collection skipped for %s: %s", device.name, exc)

    device.last_message = f"Collected {len(onus)} ONUs, {len(macs)} MACs"
    await _finish_log(session, log, ScanStatus.success, device.last_message)
    await session.commit()
    return log


async def scan_mikrotik(session: AsyncSession, device_id: int) -> ScanLog:
    device = await session.get(MikrotikDevice, device_id)
    if device is None:
        raise ValueError(f"Mikrotik device {device_id} not found")
    log = await _start_log(session, ScanType.mikrotik, device_id, device.name)
    if not device.enabled:
        await _finish_log(session, log, ScanStatus.failed, "Device disabled")
        return log

    driver = MikrotikDriver(device)
    try:
        entries, secret_count, active_count = await driver.collect()
    except DriverError as exc:
        device.status = "unreachable"
        device.last_message = str(exc)[:1000]
        device.last_scan_at = utcnow()
        await _finish_log(session, log, ScanStatus.failed, str(exc))
        await session.commit()
        return log
    except Exception as exc:
        device.status = "unreachable"
        device.last_message = str(exc)[:1000]
        device.last_scan_at = utcnow()
        await _finish_log(session, log, ScanStatus.failed, f"Unexpected error: {exc}")
        await session.commit()
        return log

    seen_macs: set[str] = set()
    for e in entries:
        seen_macs.add(e.mac)
        res = await session.execute(
            select(PppActiveEntry).where(PppActiveEntry.device_id == device_id, PppActiveEntry.mac == e.mac)
        )
        entry = res.scalar_one_or_none()
        now = utcnow()
        if entry is None:
            session.add(
                PppActiveEntry(
                    device_id=device_id,
                    mac=e.mac,
                    ip=e.ip,
                    interface=e.interface,
                    subscriber=e.subscriber_id,
                    last_seen=now,
                )
            )
        else:
            entry.ip = e.ip or entry.ip
            entry.interface = e.interface or entry.interface
            if e.subscriber_id:
                entry.subscriber = e.subscriber_id
            entry.last_seen = now

    if entries:
        await session.execute(
            delete(PppActiveEntry).where(PppActiveEntry.device_id == device_id, PppActiveEntry.mac.notin_(seen_macs))
        )

    device.subscriber_count = secret_count
    device.active_count = active_count
    await session.flush()
    device.status = "reachable"
    device.last_scan_at = utcnow()

    # Collect BGP data (best-effort, non-fatal if unsupported)
    bgp_msg = ""
    try:
        from ..models import BgpPrefixSnapshot

        bgp_sessions, bgp_prefixes, bgp_established = await driver.collect_bgp()
        now = utcnow()

        # Upsert BGP sessions
        existing = (
            await session.execute(select(BgpSession).where(BgpSession.device_id == device_id))
        ).scalars().all()
        existing_map = {s.remote_ip: s for s in existing}
        seen_ips: set[str] = set()

        for bs in bgp_sessions:
            seen_ips.add(bs.remote_ip)
            row = existing_map.get(bs.remote_ip)
            if row is None:
                row = BgpSession(
                    device_id=device_id,
                    name=bs.name,
                    remote_as=bs.remote_as,
                    remote_ip=bs.remote_ip,
                    local_ip=bs.local_ip,
                    local_as=bs.local_as,
                    address_family=bs.address_family,
                    state=bs.state,
                    uptime=bs.uptime,
                    prefix_count=bs.prefix_count,
                    advertised_count=bs.advertised_count,
                    last_scan_at=now,
                )
                session.add(row)
                await session.flush()
            else:
                row.name = bs.name or row.name
                row.remote_as = bs.remote_as or row.remote_as
                row.local_ip = bs.local_ip or row.local_ip
                row.local_as = bs.local_as or row.local_as
                row.address_family = bs.address_family or row.address_family
                row.state = bs.state
                row.uptime = bs.uptime
                row.prefix_count = bs.prefix_count
                row.advertised_count = bs.advertised_count
                row.last_scan_at = now

            # Store prefix snapshot for graphing
            session.add(BgpPrefixSnapshot(
                session_id=row.id,
                prefix_count=bs.prefix_count,
                advertised_count=bs.advertised_count,
                recorded_at=now,
            ))

        # Remove stale sessions
        for ip, row in existing_map.items():
            if ip not in seen_ips:
                await session.delete(row)

        # Prune old snapshots (> 365 days)
        from datetime import timedelta
        cutoff = now - timedelta(days=365)
        await session.execute(
            delete(BgpPrefixSnapshot).where(BgpPrefixSnapshot.recorded_at < cutoff)
        )

        if bgp_sessions:
            bgp_msg = f" / BGP: {bgp_established} established, {bgp_prefixes} prefixes"
    except Exception as exc:
        logger.debug("BGP collection skipped for %s: %s", device.name, exc)

    device.last_message = (
        f"{len(entries)} PPPoE active / {secret_count} PPP secrets{bgp_msg}"
    )
    await _finish_log(session, log, ScanStatus.success, device.last_message)
    await session.commit()
    return log


async def collect_telemetry(session: AsyncSession, olt_id: int) -> int:
    """Sample ONU optical power via SNMP and append to the telemetry table.

    Cheap enough to run every few minutes: three SNMP walks, no CLI. Returns
    the number of readings stored.
    """
    device = await session.get(OLTDevice, olt_id)
    if device is None or not device.enabled:
        return 0
    driver = build_driver(device)
    try:
        readings = await driver.get_telemetry()
    except DriverError:
        device.status = "unreachable"
        device.last_message = "Telemetry SNMP failed"
        device.last_scan_at = utcnow()
        await session.commit()
        return 0

    now = utcnow()
    stored = 0
    for pon_port, sample in readings.items():
        res = await session.execute(
            select(Onu).where(Onu.olt_id == olt_id, Onu.pon_port == pon_port)
        )
        onu = res.scalars().first()
        if onu is None:
            continue
        session.add(
            OnuTelemetry(
                onu_id=onu.id,
                olt_id=olt_id,
                pon_port=onu.pon_port,
                rx_power=sample.rx,
                tx_power=sample.tx,
                in_octets=sample.in_octets,
                out_octets=sample.out_octets,
                sampled_at=now,
            )
        )
        onu.rx_power = sample.rx
        onu.tx_power = sample.tx
        stored += 1

    if stored:
        # Keep the profile graph manageable (~90 days of 5-minute samples).
        await session.execute(
            delete(OnuTelemetry).where(OnuTelemetry.sampled_at < utcnow() - timedelta(days=90))
        )

    device.status = "reachable"
    device.last_scan_at = now
    device.last_message = f"Telemetry: {stored} ONUs sampled"
    await session.commit()
    return stored


async def test_olt(session: AsyncSession, olt_id: int) -> str:
    device = await session.get(OLTDevice, olt_id)
    if device is None:
        raise ValueError(f"OLT device {olt_id} not found")
    driver = build_driver(device)
    try:
        message = await driver.test()
    except DriverError as exc:
        device.status = "unreachable"
        device.last_message = str(exc)[:1000]
        await session.commit()
        raise
    device.status = "reachable"
    device.last_message = message[:1000]
    await session.commit()
    return message


async def test_mikrotik(session: AsyncSession, device_id: int) -> str:
    device = await session.get(MikrotikDevice, device_id)
    if device is None:
        raise ValueError(f"Mikrotik device {device_id} not found")
    driver = MikrotikDriver(device)
    try:
        message = await driver.test()
    except DriverError as exc:
        device.status = "unreachable"
        device.last_message = str(exc)[:1000]
        await session.commit()
        raise
    device.status = "reachable"
    device.last_message = message[:1000]
    await session.commit()
    return message
