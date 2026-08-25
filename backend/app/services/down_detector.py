"""Live ONU down detection engine.

Polling an OLT's onu-information output every few seconds (via the fast CLI
state poll) and diffing consecutive snapshots to detect ONUs going down, with
the dereg reason the OLT reports. Down events and recoveries are persisted;
a burst of >=N down events on the same port within one poll is flagged as a
mass outage (feeder/cable cut) instead of individual power-offs.

One session runs at a time; starting a new one replaces the current session.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from sqlalchemy import select

from ..database import SessionLocal
from ..drivers.bdcom import build_driver
from ..drivers.base import DriverError, OnuInfo
from ..models import Onu, OnuDownEvent, OnuOutage
from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.downs")

# Default poll cadence and mass-outage threshold.
DEFAULT_INTERVAL = 30
DEFAULT_MASS_THRESHOLD = 5

# One poll may momentarily report an ONU down then up (flap) - only flag a
# mass outage when the port was healthy in the previous poll too.
_MASS_WINDOW_SECONDS = 120


@dataclass
class DownConfig:
    olt_id: int
    port: str = ""  # PON base like "EPON0/1"; empty = all ports
    interval: int = DEFAULT_INTERVAL
    mass_threshold: int = DEFAULT_MASS_THRESHOLD


@dataclass
class _Session:
    config: DownConfig
    olt_name: str = ""
    running: bool = False
    last_poll_at: object | None = None
    last_error: str = ""
    current_down: list[dict] = field(default_factory=list)
    prev: dict[tuple[str, int], OnuInfo] = field(default_factory=dict)
    seen_up: dict[tuple[str, int], bool] = field(default_factory=dict)
    down_since: dict[tuple[str, int], object] = field(default_factory=dict)
    task: asyncio.Task | None = None
    started_at: object | None = None


_session: _Session | None = None
_lock = asyncio.Lock()


def _port_base(pon_port: str) -> str:
    return pon_port.rsplit(":", 1)[0] if ":" in pon_port else pon_port


def _is_up(info: OnuInfo) -> bool:
    s = (info.state or "unknown").lower()
    return s in ("active", "auto-configured", "registered", "online", "authorized")


def _is_down(info: OnuInfo) -> bool:
    s = (info.state or "unknown").lower()
    return s in ("deregistered", "inactive", "offline", "off-line", "auth-fail", "lost")


def _matches_port(pon_port: str, port_filter: str) -> bool:
    if not port_filter:
        return True
    return _port_base(pon_port).upper() == port_filter.strip().upper()


def _onu_info_to_dict(olt_name: str, info: OnuInfo, reason: str, detected_at) -> dict:
    return {
        "pon_port": info.pon_port,
        "onu_id": info.onu_id,
        "serial": info.serial,
        "name": info.description,
        "reason": reason,
        "detected_at": detected_at,
    }


def status() -> dict:
    """Public read-only snapshot of the current session."""
    if _session is None:
        return {"running": False, "config": None, "current_down": [], "last_error": ""}
    s = _session
    cfg = s.config
    return {
        "running": s.running,
        "olt_id": cfg.olt_id,
        "olt_name": s.olt_name,
        "port": cfg.port,
        "interval": cfg.interval,
        "mass_threshold": cfg.mass_threshold,
        "last_poll_at": s.last_poll_at,
        "started_at": s.started_at,
        "last_error": s.last_error,
        "current_down_count": len(s.current_down),
        "current_down": s.current_down,
    }


def stop() -> bool:
    """Stop the running session (if any). Returns True if one was stopped."""
    global _session
    if _session is None or not _session.running:
        return False
    if _session.task is not None:
        _session.task.cancel()
    _session.running = False
    _session = None
    logger.info("Down detector stopped")
    return True


async def start(config: DownConfig) -> dict:
    """Start (or replace) a live down-detection session."""
    global _session
    async with _lock:
        if _session is not None and _session.running:
            await _cancel_task(_session)
        _session = _Session(config=config)
        _session.started_at = utcnow()

        async with SessionLocal() as session:
            from ..models import OLTDevice

            dev = await session.get(OLTDevice, config.olt_id)
            if dev is None:
                raise ValueError(f"OLT {config.olt_id} not found")
            _session.olt_name = dev.name

        _session.running = True
        _session.task = asyncio.create_task(_poll_loop(_session))
        logger.info(
            "Down detector started: olt=%s port=%r interval=%ss threshold=%s",
            _session.olt_name,
            config.port,
            config.interval,
            config.mass_threshold,
        )
        return status()


async def _cancel_task(s: _Session) -> None:
    if s.task is not None:
        s.task.cancel()
        try:
            await s.task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        s.task = None


async def _poll_loop(s: _Session) -> None:
    while True:
        try:
            await _poll_once(s)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            s.last_error = str(exc)[:500]
            logger.exception("Down detector poll failed: %s", exc)
        await asyncio.sleep(max(s.config.interval, 5))


async def _poll_once(s: _Session) -> None:
    from ..models import OLTDevice

    async with SessionLocal() as session:
        dev = await session.get(OLTDevice, s.config.olt_id)
        if dev is None or not dev.enabled:
            s.last_error = "OLT missing or disabled"
            return
        try:
            infos = await build_driver(dev).get_onu_states()
        except DriverError as exc:
            s.last_error = str(exc)[:500]
            return
        s.last_error = ""

        snapshot: dict[tuple[str, int], OnuInfo] = {}
        for info in infos:
            if _matches_port(info.pon_port, s.config.port):
                snapshot[(info.pon_port, info.onu_id)] = info

        now = utcnow()
        newly_down: list[tuple[OnuInfo, str]] = []
        for key, info in snapshot.items():
            prev = s.prev.get(key)
            was_up = s.seen_up.get(key, False)
            if _is_down(info):
                if was_up:
                    reason = info.dereg_reason or "unknown"
                    newly_down.append((info, reason))
                    s.down_since[key] = now
                else:
                    # First time (or already-down): baseline so no spurious
                    # event, but track since when for the live table.
                    s.seen_up[key] = False
                    if key not in s.down_since:
                        s.down_since[key] = now
            elif _is_up(info):
                s.seen_up[key] = True
                since = s.down_since.pop(key, None)
                if since is not None:
                    await _mark_recovered(session, s, key, now)

        s.prev = snapshot

        for info, reason in newly_down:
            await _record_down(session, s, info, reason, now)

        # Live "currently down" list for the UI.
        s.current_down = [
            _onu_info_to_dict(
                s.olt_name,
                info,
                info.dereg_reason or "unknown",
                s.down_since.get(key, now),
            )
            for key, info in sorted(snapshot.items())
            if _is_down(info)
        ]

        await _detect_mass_outage(session, s, newly_down, now)
        await _resolve_outages(session, s, snapshot, now)
        await session.commit()
        s.last_poll_at = now
        logger.info("Down poll: %d ONUs seen, %d down", len(snapshot), len(s.current_down))


async def _record_down(session, s: _Session, info: OnuInfo, reason: str, now) -> None:
    session.add(
        OnuDownEvent(
            olt_id=s.config.olt_id,
            olt_name=s.olt_name,
            pon_port=info.pon_port,
            onu_id=info.onu_id,
            serial=info.serial,
            name=info.description,
            kind="down",
            reason=reason,
            detected_at=now,
        )
    )
    logger.info(
        "DOWN  %s %s:%s reason=%s", s.olt_name, info.pon_port, info.onu_id, reason
    )


async def _mark_recovered(session, s: _Session, key: tuple[str, int], now) -> None:
    pon_port, onu_id = key
    res = await session.execute(
        select(OnuDownEvent)
        .where(
            OnuDownEvent.olt_id == s.config.olt_id,
            OnuDownEvent.pon_port == pon_port,
            OnuDownEvent.onu_id == onu_id,
            OnuDownEvent.kind == "down",
            OnuDownEvent.duration_seconds.is_(None),
        )
        .order_by(OnuDownEvent.detected_at.desc())
        .limit(1)
    )
    ev = res.scalar_one_or_none()
    if ev is not None:
        duration = int((now - ev.detected_at).total_seconds())
        ev.kind = "recovery"
        ev.duration_seconds = duration
        ev.detected_at = now
        logger.info("RECOV %s %s:%s duration=%ss", s.olt_name, pon_port, onu_id, duration)


async def _detect_mass_outage(session, s: _Session, newly_down, now) -> None:
    """Flag a burst of NEW downs on one port as a feeder/cable cut.

    Only ONUs that transitioned up->down in this poll count - a pre-existing
    down (baseline at session start) is not an outage signature.
    """
    threshold = max(s.config.mass_threshold, 2)
    down_by_port: dict[str, int] = {}
    for info, _reason in newly_down:
        down_by_port[_port_base(info.pon_port)] = down_by_port.get(_port_base(info.pon_port), 0) + 1

    for port, count in down_by_port.items():
        if count < threshold:
            continue
        # Is there already an open outage on this port/OLT?
        res = await session.execute(
            select(OnuOutage)
            .where(
                OnuOutage.olt_id == s.config.olt_id,
                OnuOutage.pon_port == port,
                OnuOutage.resolved.is_(False),
            )
            .order_by(OnuOutage.started_at.desc())
            .limit(1)
        )
        outage = res.scalar_one_or_none()
        if outage is None:
            outage = OnuOutage(
                olt_id=s.config.olt_id,
                olt_name=s.olt_name,
                pon_port=port,
                started_at=now,
                onu_count=count,
            )
            session.add(outage)
            await session.flush()
            session.add(
                OnuDownEvent(
                    olt_id=s.config.olt_id,
                    olt_name=s.olt_name,
                    pon_port=port,
                    kind="outage",
                    reason=f"mass outage ({count} ONUs down)",
                    detected_at=now,
                    outage_id=outage.id,
                )
            )
            logger.warning("MASS OUTAGE %s %s: %d ONUs down", s.olt_name, port, count)
        else:
            outage.onu_count = max(outage.onu_count, count)


async def _resolve_outages(session, s: _Session, snapshot, now) -> None:
    """Resolve open outages on ports whose down count dropped below threshold."""
    threshold = max(s.config.mass_threshold, 2)
    down_by_port: dict[str, int] = {}
    for info in snapshot.values():
        if _is_down(info):
            down_by_port[_port_base(info.pon_port)] = down_by_port.get(_port_base(info.pon_port), 0) + 1

    rows = (
        await session.execute(
            select(OnuOutage).where(
                OnuOutage.olt_id == s.config.olt_id,
                OnuOutage.resolved.is_(False),
            )
        )
    ).scalars().all()
    for outage in rows:
        if down_by_port.get(outage.pon_port, 0) < threshold:
            outage.resolved = True
            outage.resolved_at = now
            logger.info("OUTAGE RESOLVED %s %s", s.olt_name, outage.pon_port)
