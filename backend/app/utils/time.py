"""Timezone helpers.

All database timestamps are stored as timezone-aware UTC (TIMESTAMPTZ).
The application timezone defaults to Asia/Dhaka and is configurable via
the ``settings`` table (key: ``timezone``).

- ``utcnow()`` — always UTC, for DB writes
- ``get_app_tz()`` — the configured IANA timezone (cached 60 s)
- ``local_now()`` — current time in the application timezone
- ``localize(dt)`` — convert a UTC datetime to the app timezone
"""
from __future__ import annotations

import time as _time
from datetime import datetime, timezone, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from zoneinfo import ZoneInfo

# ---------------------------------------------------------------------------
# Cache for the app timezone — avoids a DB round-trip on every call.
# ---------------------------------------------------------------------------
_cached_tz: str = ""
_cached_tz_obj: ZoneInfo | None = None
_cached_tz_expires: float = 0.0
_CACHE_TTL = 60  # seconds


def utcnow() -> datetime:
    """Return the current time as timezone-aware UTC."""
    return datetime.now(timezone.utc)


async def _fetch_tz_from_db() -> str:
    """Read the timezone setting from the DB."""
    try:
        from ..database import SessionLocal
        from ..models import Setting
        from sqlalchemy import select

        async with SessionLocal() as session:
            result = await session.execute(
                select(Setting.value).where(Setting.key == "timezone")
            )
            row = result.scalar_one_or_none()
            if row and row.strip():
                return row.strip()
    except Exception:
        pass
    return "Asia/Dhaka"  # safe default


def get_app_tz() -> "ZoneInfo":
    """Return the application timezone as a ``ZoneInfo`` object.

    The value is read from the ``settings`` table (key ``timezone``) and
    cached for 60 seconds to avoid hitting the DB on every call.
    """
    from zoneinfo import ZoneInfo

    global _cached_tz, _cached_tz_obj, _cached_tz_expires  # noqa: PLW0603

    now = _time.monotonic()
    if _cached_tz_obj is not None and now < _cached_tz_expires:
        return _cached_tz_obj

    # If the cache expired but we can't do async I/O, try the sync shortcut
    # (the value is also loaded at startup via ``refresh_app_tz``).
    tz_name = _cached_tz or "Asia/Dhaka"
    try:
        _cached_tz_obj = ZoneInfo(tz_name)
    except Exception:
        _cached_tz_obj = ZoneInfo("Asia/Dhaka")
    _cached_tz_expires = now + _CACHE_TTL
    return _cached_tz_obj


def set_app_tz(tz_name: str) -> None:
    """Immediately update the cached timezone (call after a DB write)."""
    from zoneinfo import ZoneInfo

    global _cached_tz, _cached_tz_obj, _cached_tz_expires  # noqa: PLW0603
    _cached_tz = tz_name
    try:
        _cached_tz_obj = ZoneInfo(tz_name)
    except Exception:
        _cached_tz_obj = ZoneInfo("Asia/Dhaka")
    _cached_tz_expires = _time.monotonic() + _CACHE_TTL


def localize(dt: datetime | None) -> datetime | None:
    """Convert a UTC-aware datetime to the application timezone.

    If *dt* is naive it is assumed to be UTC.  Returns ``None`` for ``None``.
    """
    if dt is None:
        return None
    tz = get_app_tz()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz)


def local_now() -> datetime:
    """Current time in the application timezone."""
    return utcnow().astimezone(get_app_tz())
