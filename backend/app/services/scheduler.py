"""Periodic background scheduler for OLT / Mikrotik scans and MAC binding."""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import timedelta, time as dt_time
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from ..config import get_settings
from ..database import SessionLocal
from ..utils.time import utcnow
from . import collector
from .mac_binding import run_bindings
from .mac_vendor import sync_all_vendors

logger = logging.getLogger("olt_commander.scheduler")

_scheduler: AsyncIOScheduler | None = None

# In-memory job execution tracking: job_id -> {last_run, status, error}
_job_status: dict[str, dict[str, Any]] = {}


def _track_job(job_id: str) -> None:
    """Mark a job as currently running."""
    _job_status[job_id] = {"last_run": None, "status": "running", "error": ""}


def _finish_job(job_id: str, success: bool, error: str = "") -> None:
    """Mark a job as finished."""
    _job_status[job_id] = {"last_run": utcnow().isoformat(), "status": "success" if success else "failed", "error": error}


def get_scheduler_status() -> list[dict[str, Any]]:
    """Return status for all scheduled jobs."""
    if _scheduler is None:
        return []
    results = []
    jobs_def = [
        {"id": "scan_olts", "name": "OLT Scan", "desc": "Scan all enabled OLTs for ONU/MAC data"},
        {"id": "scan_mikrotiks", "name": "Mikrotik Scan", "desc": "Scan all enabled Mikrotik devices"},
        {"id": "bind_macs", "name": "MAC Binding", "desc": "Match collected MACs against subscriber database"},
        {"id": "telemetry", "name": "OLT Telemetry", "desc": "Collect optical power readings via SNMP"},
        {"id": "acs_poll", "name": "ACS Poll", "desc": "Queue TR-069 monitoring jobs for online CPEs"},
        {"id": "olt_write_all", "name": "OLT Config Save", "desc": "Persist running config to flash on all OLTs"},
        {"id": "mac_vendor_sync", "name": "MAC Vendor Sync", "desc": "Update MAC vendor OUI database from external API"},
    ]
    for jdef in jobs_def:
        job = _scheduler.get_job(jdef["id"])
        tracked = _job_status.get(jdef["id"], {})
        next_run = job.next_run_time.isoformat() if job and job.next_run_time else None
        results.append({
            "id": jdef["id"],
            "name": jdef["name"],
            "desc": jdef["desc"],
            "enabled": job is not None,
            "next_run": next_run,
            "last_run": tracked.get("last_run"),
            "status": tracked.get("status", "pending"),
            "error": tracked.get("error", ""),
        })
    return results


async def _scan_all_olts() -> None:
    _track_job("scan_olts")
    try:
        async with SessionLocal() as session:
            from sqlalchemy import select

            from ..models import OLTDevice

            devices = (await session.execute(select(OLTDevice).where(OLTDevice.enabled.is_(True)))).scalars().all()
            for device in devices:
                try:
                    await collector.scan_olt(session, device.id)
                except Exception as exc:  # noqa: BLE001
                    logger.exception("OLT scan failed for %s: %s", device.name, exc)
        _finish_job("scan_olts", True)
    except Exception as exc:
        _finish_job("scan_olts", False, str(exc)[:500])


async def _scan_all_mikrotiks() -> None:
    _track_job("scan_mikrotiks")
    try:
        async with SessionLocal() as session:
            from sqlalchemy import select

            from ..models import MikrotikDevice

            devices = (
                await session.execute(select(MikrotikDevice).where(MikrotikDevice.enabled.is_(True)))
            ).scalars().all()
            for device in devices:
                try:
                    await collector.scan_mikrotik(session, device.id)
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Mikrotik scan failed for %s: %s", device.name, exc)
        _finish_job("scan_mikrotiks", True)
    except Exception as exc:
        _finish_job("scan_mikrotiks", False, str(exc)[:500])


async def _collect_all_telemetry() -> None:
    _track_job("telemetry")
    try:
        async with SessionLocal() as session:
            from sqlalchemy import select

            from ..models import OLTDevice

            devices = (await session.execute(select(OLTDevice).where(OLTDevice.enabled.is_(True)))).scalars().all()
            for device in devices:
                try:
                    await collector.collect_telemetry(session, device.id)
                except Exception as exc:  # noqa: BLE001
                    logger.exception("Telemetry failed for %s: %s", device.name, exc)
        _finish_job("telemetry", True)
    except Exception as exc:
        _finish_job("telemetry", False, str(exc)[:500])


async def _poll_acs_metrics() -> None:
    """Queue a monitoring poll for online ACS devices."""
    _track_job("acs_poll")
    try:
        async with SessionLocal() as session:
            from sqlalchemy import func, select

            from ..models import AcsDevice, AcsJob, AcsParameter
            from ..utils.time import utcnow

            devices = (await session.execute(select(AcsDevice).where(AcsDevice.online.is_(True)))).scalars().all()
            now = utcnow()
            for device in devices:
                try:
                    count = (
                        await session.execute(
                            select(func.count(AcsParameter.id)).where(
                                AcsParameter.device_id == device.id,
                                AcsParameter.name.like("InternetGatewayDevice.WANDevice.%TotalBytesReceived%")
                                | AcsParameter.name.like("InternetGatewayDevice.WANDevice.%TotalBytesSent%")
                                | AcsParameter.name.like("InternetGatewayDevice.LANDevice.1.WLANConfiguration.%")
                                | AcsParameter.name.like("InternetGatewayDevice.DeviceInfo.CPUUsage%")
                                | AcsParameter.name.like("InternetGatewayDevice.DeviceInfo.MemoryStatus.%")
                            )
                        )
                    ).scalar() or 0
                    if count == 0:
                        continue

                    pending = (
                        await session.execute(
                            select(func.count(AcsJob.id)).where(
                                AcsJob.device_id == device.id,
                                AcsJob.action == "monitor",
                                AcsJob.status.in_(["queued", "sent"]),
                            )
                        )
                    ).scalar() or 0
                    if pending > 0:
                        continue

                    job = AcsJob(
                        device_id=device.id,
                        action="monitor",
                        payload="{}",
                        command_key=f"monitor-{now.strftime('%Y%m%d%H%M%S')}-{device.id}",
                    )
                    session.add(job)
                except Exception as exc:  # noqa: BLE001
                    logger.exception("ACS metric poll failed for device %s: %s", device.id, exc)
            await session.commit()
        _finish_job("acs_poll", True)
    except Exception as exc:
        _finish_job("acs_poll", False, str(exc)[:500])


async def _bind() -> None:
    _track_job("bind_macs")
    try:
        async with SessionLocal() as session:
            try:
                await run_bindings(session)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Binding run failed: %s", exc)
        _finish_job("bind_macs", True)
    except Exception as exc:
        _finish_job("bind_macs", False, str(exc)[:500])


# ---------------------------------------------------------------------------
# MAC vendor sync — daily at 04:00, retry at 05:00 on failure
# ---------------------------------------------------------------------------

async def _sync_mac_vendors() -> None:
    """Sync MAC vendor data from external API.  Runs daily at 04:00."""
    _track_job("mac_vendor_sync")
    try:
        async with SessionLocal() as session:
            await sync_all_vendors(session)
        _finish_job("mac_vendor_sync", True)
    except Exception as exc:  # noqa: BLE001
        _finish_job("mac_vendor_sync", False, str(exc)[:500])
        logger.exception("MAC vendor sync failed at 04:00: %s", exc)
        if _scheduler is not None:
                _scheduler.add_job(
                    _sync_mac_vendors_retry,
                    CronTrigger(hour=5, minute=0),
                    id="mac_vendor_sync_retry",
                    replace_existing=True,
                    misfire_grace_time=300,
                )
                logger.info("MAC vendor sync retry scheduled for 05:00")


async def _sync_mac_vendors_retry() -> None:
    """Retry MAC vendor sync at 05:00 (only if primary at 04:00 failed)."""
    async with SessionLocal() as session:
        try:
            await sync_all_vendors(session)
            logger.info("MAC vendor sync retry at 05:00 succeeded")
        except Exception as exc:  # noqa: BLE001
            logger.exception("MAC vendor sync retry at 05:00 also failed: %s", exc)


# ---------------------------------------------------------------------------
# OLT config save — daily at 01:00, retry at 02:00 on failure
# ---------------------------------------------------------------------------

async def _write_all_olts() -> None:
    """Connect to each enabled OLT and run ``write all`` to persist config."""
    _track_job("olt_write_all")
    from datetime import datetime as _dt

    from ..drivers.bdcom import BdcomCliDriver
    from ..models import OLTDevice, OltWriteLog

    try:
        async with SessionLocal() as session:
            devices = (await session.execute(select(OLTDevice).where(OLTDevice.enabled.is_(True)))).scalars().all()
        all_ok = True
        for device in devices:
            started = utcnow()
            log = OltWriteLog(olt_id=device.id, olt_name=device.name, status="running", started_at=started)
            async with SessionLocal() as session:
                session.add(log)
                await session.commit()
                log_id = log.id

            driver = BdcomCliDriver(device)
            try:
                await driver.connect()
                await driver._exec("enable", timeout=10)
                await driver._sendline("write all")
                await asyncio.sleep(15)
                await driver._read_until_prompt(timeout=30)
                finished = utcnow()
                async with SessionLocal() as session:
                    row = await session.get(OltWriteLog, log_id)
                    if row:
                        row.status = "success"
                        row.message = "Config saved successfully"
                        row.finished_at = finished
                        await session.commit()
                logger.info("OLT write all succeeded for %s", device.name)
            except Exception as exc:  # noqa: BLE001
                all_ok = False
                finished = utcnow()
                async with SessionLocal() as session:
                    row = await session.get(OltWriteLog, log_id)
                    if row:
                        row.status = "failed"
                        row.message = str(exc)[:500]
                        row.finished_at = finished
                        await session.commit()
                logger.exception("OLT write all failed for %s: %s", device.name, exc)
            finally:
                driver.close()
        _finish_job("olt_write_all", all_ok)
    except Exception as exc:
        _finish_job("olt_write_all", False, str(exc)[:500])


async def _write_all_olts_retry() -> None:
    """Retry OLT config save at 02:00 (only if primary at 01:00 failed)."""
    from ..models import OltWriteLog

    async with SessionLocal() as session:
        from sqlalchemy import func, select as _sel

        failed_count = (
            await session.execute(
                _sel(func.count(OltWriteLog.id)).where(
                    OltWriteLog.status == "failed",
                    OltWriteLog.started_at >= utcnow().replace(hour=1, minute=0, second=0, microsecond=0),
                )
            )
        ).scalar() or 0

    if failed_count > 0:
        logger.info("Retrying OLT write all (%d failures from 01:00)", failed_count)
        await _write_all_olts()
    else:
        logger.info("OLT write all retry skipped — no failures at 01:00")


async def _cleanup_tj_reservations():
    """Expire old TJ ID reservations and delete stale records."""
    from sqlalchemy import update, delete
    from ..models import TjIdReservation
    now = utcnow()
    try:
        async with SessionLocal() as db:
            result = await db.execute(
                update(TjIdReservation)
                .where(TjIdReservation.status == "active")
                .where(TjIdReservation.expires_at < now)
                .values(status="expired")
            )
            if result.rowcount > 0:
                logger.info("Expired %d TJ ID reservations", result.rowcount)

            # Delete old consumed/expired reservations older than 2 hours
            from datetime import timedelta
            cutoff = now - timedelta(hours=2)
            del_result = await db.execute(
                delete(TjIdReservation)
                .where(TjIdReservation.status.in_(["consumed", "expired"]))
                .where(TjIdReservation.reserved_at < cutoff)
            )
            if del_result.rowcount > 0:
                logger.info("Deleted %d old TJ ID reservations", del_result.rowcount)

            await db.commit()
    except Exception as e:
        logger.error("TJ reservation cleanup failed: %s", e)


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    settings = get_settings()
    scheduler = AsyncIOScheduler()
    if settings.scan_olt_interval > 0:
        scheduler.add_job(
            _scan_all_olts,
            IntervalTrigger(seconds=settings.scan_olt_interval),
            id="scan_olts",
            replace_existing=True,
            misfire_grace_time=30,
        )
    if settings.scan_mikrotik_interval > 0:
        scheduler.add_job(
            _scan_all_mikrotiks,
            IntervalTrigger(seconds=settings.scan_mikrotik_interval),
            id="scan_mikrotiks",
            replace_existing=True,
            misfire_grace_time=30,
        )
    if settings.bind_interval > 0:
        scheduler.add_job(
            _bind,
            IntervalTrigger(seconds=settings.bind_interval),
            id="bind_macs",
            replace_existing=True,
            misfire_grace_time=30,
        )
    if settings.telemetry_interval > 0:
        # Offset the first run so SNMP telemetry doesn't collide with the
        # startup burst of OLT/Mikrotik scans (sporadic SNMP timeouts).
        scheduler.add_job(
            _collect_all_telemetry,
            IntervalTrigger(seconds=settings.telemetry_interval),
            id="telemetry",
            replace_existing=True,
            misfire_grace_time=30,
            next_run_time=utcnow() + timedelta(seconds=90),
        )

    if settings.acs_poll_interval > 0:
        scheduler.add_job(
            _poll_acs_metrics,
            IntervalTrigger(seconds=settings.acs_poll_interval),
            id="acs_poll",
            replace_existing=True,
            misfire_grace_time=30,
            next_run_time=utcnow() + timedelta(seconds=120),
        )

    # MAC vendor sync — daily at 04:00 (with retry at 05:00 handled inside)
    if settings.mac_vendor_sync_interval > 0:
        scheduler.add_job(
            _sync_mac_vendors,
            CronTrigger(hour=4, minute=0),
            id="mac_vendor_sync",
            replace_existing=True,
            misfire_grace_time=300,
        )

    # OLT config save — daily at 01:00 (with retry at 02:00 handled inside)
    scheduler.add_job(
        _write_all_olts,
        CronTrigger(hour=1, minute=0),
        id="olt_write_all",
        replace_existing=True,
        misfire_grace_time=300,
    )

    # TJ ID reservation cleanup — every 5 minutes
    scheduler.add_job(
        _cleanup_tj_reservations,
        IntervalTrigger(minutes=5),
        id="cleanup_tj_reservations",
        replace_existing=True,
        misfire_grace_time=30,
    )

    scheduler.start()
    _scheduler = scheduler

    # Run first sync immediately on startup (delayed 30s to avoid startup burst)
    if settings.mac_vendor_sync_interval > 0:
        scheduler.add_job(
            _sync_mac_vendors,
            trigger="date",
            run_date=utcnow() + timedelta(seconds=30),
            id="mac_vendor_sync_initial",
            replace_existing=True,
            misfire_grace_time=600,
        )

    logger.info(
        "Scheduler started (olt=%ss, mikrotik=%ss, bind=%ss, telemetry=%ss, acs_poll=%ss, mac_vendor_sync=daily@04:00, olt_write_all=daily@01:00)",
        settings.scan_olt_interval,
        settings.scan_mikrotik_interval,
        settings.bind_interval,
        settings.telemetry_interval,
        settings.acs_poll_interval,
    )
    return scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None
