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
from ..utils.time import utcnow, get_app_tz, localize
from . import collector
from .mac_binding import run_bindings
from .mac_vendor import sync_all_vendors

logger = logging.getLogger("olt_commander.scheduler")

_scheduler: AsyncIOScheduler | None = None

# In-memory job execution tracking: job_id -> {last_run, status, error}
_job_status: dict[str, dict[str, Any]] = {}


def _track_job(job_id: str) -> None:
    """Mark a job as currently running, preserving previous last_run."""
    prev = _job_status.get(job_id, {})
    _job_status[job_id] = {"last_run": prev.get("last_run"), "status": "running", "error": ""}


def _finish_job(job_id: str, success: bool, error: str = "") -> None:
    """Mark a job as finished."""
    _job_status[job_id] = {"last_run": utcnow().isoformat(), "status": "success" if success else "failed", "error": error}
    _persist_job_state(job_id)


def _persist_job_state(job_id: str) -> None:
    """Persist a single job's state to the database (fire-and-forget)."""
    import asyncio
    state = _job_status.get(job_id)
    if not state:
        return

    async def _save():
        from ..database import SessionLocal
        from ..models import SchedulerJobState
        try:
            async with SessionLocal() as session:
                row = await session.get(SchedulerJobState, job_id)
                if row is None:
                    row = SchedulerJobState(job_id=job_id)
                    session.add(row)
                row.status = state["status"]
                row.error = state.get("error", "")
                if state.get("last_run"):
                    from ..utils.time import utcnow as _u
                    row.last_run = _u()
                await session.commit()
        except Exception:
            pass

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_save())
    except RuntimeError:
        pass


async def _load_job_states() -> None:
    """Load persisted job states from DB into memory on startup."""
    from ..database import SessionLocal
    from ..models import SchedulerJobState
    try:
        async with SessionLocal() as session:
            from sqlalchemy import select
            rows = (await session.execute(select(SchedulerJobState))).scalars().all()
            for row in rows:
                _job_status[row.job_id] = {
                    "last_run": row.last_run.isoformat() if row.last_run else None,
                    "status": row.status,
                    "error": row.error or "",
                }
    except Exception:
        pass


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
# MAC vendor sync — daily at 10:00 BDT, retry at 11:00 BDT on failure
# ---------------------------------------------------------------------------

async def _sync_mac_vendors() -> None:
    """Sync MAC vendor data from external API.  Runs daily at 10:00 BDT."""
    _track_job("mac_vendor_sync")
    try:
        async with SessionLocal() as session:
            await sync_all_vendors(session)
        _finish_job("mac_vendor_sync", True)
    except Exception as exc:  # noqa: BLE001
        _finish_job("mac_vendor_sync", False, str(exc)[:500])
        logger.exception("MAC vendor sync failed at 10:00 BDT: %s", exc)
        if _scheduler is not None:
                _scheduler.add_job(
                    _sync_mac_vendors_retry,
                    CronTrigger(hour=11, minute=0),
                    id="mac_vendor_sync_retry",
                    replace_existing=True,
                    misfire_grace_time=300,
                )
                logger.info("MAC vendor sync retry scheduled for 11:00 BDT")


async def _sync_mac_vendors_retry() -> None:
    """Retry MAC vendor sync at 11:00 BDT (only if primary at 10:00 BDT failed)."""
    async with SessionLocal() as session:
        try:
            await sync_all_vendors(session)
            logger.info("MAC vendor sync retry at 11:00 BDT succeeded")
        except Exception as exc:  # noqa: BLE001
            logger.exception("MAC vendor sync retry at 11:00 BDT also failed: %s", exc)


# ---------------------------------------------------------------------------
# OLT config save — daily at 03:00 BDT, retry at 04:00 BDT on failure
# ---------------------------------------------------------------------------

async def _write_all_olts() -> None:
    """Connect to each enabled OLT and run ``write all`` to persist config."""
    _track_job("olt_write_all")

    from ..drivers.bdcom import BdcomCliDriver

    try:
        async with SessionLocal() as session:
            from sqlalchemy import select

            from ..models import OLTDevice, OltWriteLog

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
                await asyncio.sleep(20)
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
        if not all_ok and _scheduler is not None:
            _scheduler.add_job(
                _write_all_olts_retry,
                CronTrigger(hour=4, minute=0),
                id="olt_write_all_retry",
                replace_existing=True,
                misfire_grace_time=300,
            )
            logger.info("OLT write all retry scheduled for 04:00 BDT")
    except Exception as exc:
        _finish_job("olt_write_all", False, str(exc)[:500])


async def _write_all_olts_retry() -> None:
    """Retry OLT config save at 04:00 BDT (only if primary at 03:00 BDT failed)."""
    from ..models import OltWriteLog
    from datetime import timedelta

    # Check for failures since today's midnight in the app timezone
    tz = get_app_tz()
    local_now = localize(utcnow())
    today_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    from datetime import timezone as _tz
    today_midnight_utc = today_midnight.astimezone(_tz.utc).replace(tzinfo=None)

    async with SessionLocal() as session:
        from sqlalchemy import func, select as _sel

        failed_count = (
            await session.execute(
                _sel(func.count(OltWriteLog.id)).where(
                    OltWriteLog.status == "failed",
                    OltWriteLog.started_at >= today_midnight_utc,
                )
            )
        ).scalar() or 0

    if failed_count > 0:
        logger.info("Retrying OLT write all (%d failures from 03:00 BDT)", failed_count)
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


async def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    settings = get_settings()
    app_tz = get_app_tz()
    scheduler = AsyncIOScheduler(timezone=app_tz)
    if settings.scan_olt_interval > 0:
        # Offset OLT scan by 2 minutes so telemetry (optical metrics) runs first.
        scheduler.add_job(
            _scan_all_olts,
            IntervalTrigger(seconds=settings.scan_olt_interval),
            id="scan_olts",
            replace_existing=True,
            misfire_grace_time=30,
            next_run_time=utcnow() + timedelta(seconds=120),
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
        # Telemetry is the primary source of optical metrics (rx/tx power,
        # bandwidth).  Run it first each cycle; scan_olts follows ~2 min later.
        scheduler.add_job(
            _collect_all_telemetry,
            IntervalTrigger(seconds=settings.telemetry_interval),
            id="telemetry",
            replace_existing=True,
            misfire_grace_time=30,
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

    # MAC vendor sync — daily at 10:00 BDT (with retry at 11:00 BDT handled inside)
    if settings.mac_vendor_sync_interval > 0:
        scheduler.add_job(
            _sync_mac_vendors,
            CronTrigger(hour=10, minute=0),
            id="mac_vendor_sync",
            replace_existing=True,
            misfire_grace_time=300,
        )

    # OLT config save — daily at 03:00 BDT (with retry at 04:00 BDT handled inside)
    scheduler.add_job(
        _write_all_olts,
        CronTrigger(hour=3, minute=0),
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
        "Scheduler started (tz=%s, olt=%ss, mikrotik=%ss, bind=%ss, telemetry=%ss, acs_poll=%ss, mac_vendor_sync=daily@10:00, olt_write_all=daily@03:00)",
        app_tz.key if hasattr(app_tz, "key") else str(app_tz),
        settings.scan_olt_interval,
        settings.scan_mikrotik_interval,
        settings.bind_interval,
        settings.telemetry_interval,
        settings.acs_poll_interval,
    )
    await _load_job_states()
    return scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None
