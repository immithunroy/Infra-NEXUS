"""Periodic background scheduler for OLT / Mikrotik scans and MAC binding."""
from __future__ import annotations

import logging
from datetime import timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from ..config import get_settings
from ..database import SessionLocal
from ..utils.time import utcnow
from . import collector
from .mac_binding import run_bindings

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


async def _bind() -> None:
    async with SessionLocal() as session:
        try:
            await run_bindings(session)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Binding run failed: %s", exc)


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
    scheduler.start()
    _scheduler = scheduler
    logger.info(
        "Scheduler started (olt=%ss, mikrotik=%ss, bind=%ss, telemetry=%ss)",
        settings.scan_olt_interval,
        settings.scan_mikrotik_interval,
        settings.bind_interval,
        settings.telemetry_interval,
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
