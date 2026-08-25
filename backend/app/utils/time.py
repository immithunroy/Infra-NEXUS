"""Timezone helpers.

The database stores timestamps as timezone-aware UTC (timestamptz) and the
server's session timezone may be something else (e.g. Asia/Dhaka).  A *naive*
``datetime.utcnow()`` bound to a timestamptz column is interpreted by asyncpg
in the session timezone, silently shifting the value by the UTC offset.  Always
use :func:`utcnow` so the offset is explicit.
"""
from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Return the current time as timezone-aware UTC."""
    return datetime.now(timezone.utc)
