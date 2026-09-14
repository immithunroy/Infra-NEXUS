"""HRM real-time listener — LISTEN/NOTIFY on HRM DB for instant user sync."""
from __future__ import annotations

import asyncio
import json
import logging

import asyncpg

from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.hrm_listener")

_CHANNEL = "hrm_employee_changed"
_DEBOUNCE_SECS = 3


class HrmListener:
    """Maintains a persistent LISTEN connection to HRM DB.

    On notification, debounces and triggers a full sync.
    Auto-reconnects on connection loss.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self._pool: asyncpg.Pool | None = None

    async def start(self) -> None:
        if self._task and not self._task.done():
            logger.warning("HRM listener already running")
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="hrm_listener")
        logger.info("HRM listener starting")

    async def stop(self) -> None:
        self._stop.set()
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._pool:
            await self._pool.close()
            self._pool = None
        logger.info("HRM listener stopped")

    # ── internal ──────────────────────────────────────────────────────────

    async def _get_db_url(self) -> str | None:
        from sqlalchemy import text
        from ..database import SessionLocal
        try:
            async with SessionLocal() as db:
                rows = (await db.execute(
                    text("SELECT key, value FROM settings WHERE key LIKE 'hrm_db_%'")
                )).all()
                cfg = {r[0]: r[1] for r in rows}
                if not cfg.get("hrm_db_host"):
                    return None
                host = cfg["hrm_db_host"]
                port = cfg.get("hrm_db_port", "5432")
                name = cfg.get("hrm_db_name", "zkt_payroll")
                user = cfg.get("hrm_db_user", "postgres")
                password = cfg.get("hrm_db_password", "postgres")
                return f"postgresql://{user}:{password}@{host}:{port}/{name}"
        except Exception as exc:
            logger.warning("HRM listener: cannot read DB config: %s", exc)
            return None

    async def _run(self) -> None:
        backoff = 1
        while not self._stop.is_set():
            url = await self._get_db_url()
            if not url:
                logger.info("HRM listener: no DB config, sleeping 60s")
                await asyncio.sleep(60)
                continue

            try:
                self._pool = await asyncpg.create_pool(url, min_size=1, max_size=2)
                async with self._pool.acquire() as conn:
                    await conn.add_listener(_CHANNEL, self._on_notify)
                    logger.info("HRM listener: connected, listening on '%s'", _CHANNEL)
                    backoff = 1

                    # Keep alive — wait for stop signal
                    while not self._stop.is_set():
                        await asyncio.sleep(5)

            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("HRM listener: connection lost (%s), retrying in %ds", exc, backoff)
                if self._pool:
                    await self._pool.close()
                    self._pool = None
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def _on_notify(self, conn, pid, channel, payload: str) -> None:
        """Called on each NOTIFY. Schedules debounced sync."""
        try:
            data = json.loads(payload)
            logger.info("HRM change: %s employee %s", data.get("op"), data.get("id"))
        except Exception:
            logger.info("HRM change: (invalid payload)")

        # Cancel previous debounce timer, start new one
        if self._debounce_task and not self._debounce_task.done():
            self._debounce_task.cancel()
        self._debounce_task = asyncio.ensure_future(self._debounced_sync())

    _debounce_task: asyncio.Task | None = None

    async def _debounced_sync(self) -> None:
        """Wait _DEBOUNCE_SECS then run a full sync."""
        try:
            await asyncio.sleep(_DEBOUNCE_SECS)
            from .hrm_sync import sync_hrm_users
            from ..database import SessionLocal
            async with SessionLocal() as db:
                result = await sync_hrm_users(db)
                logger.info("HRM real-time sync: %s", result.get("message", ""))
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.exception("HRM real-time sync failed: %s", exc)


_listener: HrmListener | None = None


async def start_hrm_listener() -> None:
    global _listener
    _listener = HrmListener()
    await _listener.start()


async def stop_hrm_listener() -> None:
    global _listener
    if _listener:
        await _listener.stop()
        _listener = None
