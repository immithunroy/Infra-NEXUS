"""Periodic background scheduler for OLT / Mikrotik scans and MAC binding."""
from __future__ import annotations

import logging
from datetime import timedelta, time as dt_time

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


async def _scan_all_olts() -> None:
    async with SessionLocal() as session:
        from sqlalchemy import select

        from ..models import OLTDevice

        devices = (await session.execute(select(OLTDevice).where(OLTDevice.enabled.is_(True)))).scalars().all()
        for device in devices:
            try:
                await collector.scan_olt(session, device.id)
            except Exception as exc:  # noqa: BLE001
                logger.exception("OLT scan failed for %s: %s", device.name, exc)


async def _scan_all_mikrotiks() -> None:
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


async def _collect_all_telemetry() -> None:
    async with SessionLocal() as session:
        from sqlalchemy import select

        from ..models import OLTDevice

        devices = (await session.execute(select(OLTDevice).where(OLTDevice.enabled.is_(True)))).scalars().all()
        for device in devices:
            try:
                await collector.collect_telemetry(session, device.id)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Telemetry failed for %s: %s", device.name, exc)


async def _poll_acs_metrics() -> None:
    """Queue a monitoring poll for online ACS devices.

    Creates a lightweight ``monitor`` job for each online device that supports
    monitoring parameters.  When the CPE next sends a GetRPC, the handler
    dispatches a GetParameterValues RPC and the response is stored as metrics.
    """
    async with SessionLocal() as session:
        from sqlalchemy import func, select

        from ..models import AcsDevice, AcsJob, AcsParameter
        from ..utils.time import utcnow

        devices = (await session.execute(select(AcsDevice).where(AcsDevice.online.is_(True)))).scalars().all()
        now = utcnow()
        for device in devices:
            try:
                # Only poll devices that have previously reported monitoring params
                # (avoids Fault 9814 on basic CPEs).
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

                # Skip if a monitor job is already queued or sent (avoid flooding)
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


async def _bind() -> None:
    async with SessionLocal() as session:
        try:
            await run_bindings(session)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Binding run failed: %s", exc)


# ---------------------------------------------------------------------------
# MAC vendor sync — daily at 04:00, retry at 05:00 on failure
# ---------------------------------------------------------------------------

async def _sync_mac_vendors() -> None:
    """Sync MAC vendor data from external API.  Runs daily at 04:00."""
    async with SessionLocal() as session:
        try:
            await sync_all_vendors(session)
        except Exception as exc:  # noqa: BLE001
            logger.exception("MAC vendor sync failed at 04:00: %s", exc)
            # Schedule retry at 05:00
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
        "Scheduler started (olt=%ss, mikrotik=%ss, bind=%ss, telemetry=%ss, acs_poll=%ss, mac_vendor_sync=daily@04:00)",
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
