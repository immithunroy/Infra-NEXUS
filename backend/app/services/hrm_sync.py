"""HRM User Sync — reads employees from HRM PostgreSQL and syncs to Nexus users."""
from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from ..models import User
from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.hrm_sync")


# ── HRM database model (read-only) ──────────────────────────────────────

class _HrmBase(DeclarativeBase):
    pass


class HrmEmployee(_HrmBase):
    """Read-only mapping to HRM's Employee table."""
    __tablename__ = "Employee"

    id: Mapped[str] = mapped_column(primary_key=True)
    employeeId: Mapped[str] = mapped_column(default="")
    username: Mapped[str] = mapped_column(default="")
    firstName: Mapped[str] = mapped_column(default="")
    lastName: Mapped[str] = mapped_column(default="")
    email: Mapped[str] = mapped_column(default="")
    password: Mapped[str] = mapped_column(default="")
    status: Mapped[str] = mapped_column(default="ACTIVE")


# ── HRM DB config helpers ────────────────────────────────────────────────

async def _get_hrm_db_url(db: AsyncSession) -> str | None:
    """Read HRM database config from the settings table."""
    from sqlalchemy import text
    try:
        rows = (await db.execute(
            text("SELECT key, value FROM settings WHERE key LIKE 'hrm_db_%'")
        )).all()
        cfg = {row[0]: row[1] for row in rows}
        if not cfg.get("hrm_db_host"):
            return None
        host = cfg["hrm_db_host"]
        port = cfg.get("hrm_db_port", "5432")
        name = cfg.get("hrm_db_name", "zkt_payroll")
        user = cfg.get("hrm_db_user", "postgres")
        password = cfg.get("hrm_db_password", "postgres")
        return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{name}"
    except Exception as exc:
        logger.warning("Failed to read HRM DB config: %s", exc)
        return None


# ── Sync logic ───────────────────────────────────────────────────────────

async def sync_hrm_users(db: AsyncSession) -> dict:
    """Sync employees from HRM to Nexus users.

    Returns {created, updated, deactivated, message}.
    """
    hrm_url = await _get_hrm_db_url(db)
    if not hrm_url:
        return {"created": 0, "updated": 0, "deactivated": 0, "message": "HRM database not configured"}

    hrm_engine = create_async_engine(hrm_url, echo=False, pool_size=2)
    now = utcnow()
    created = 0
    updated = 0
    deactivated = 0

    try:
        # 1. Fetch active employees from HRM
        async with hrm_engine.connect() as hrm_conn:
            result = await hrm_conn.execute(
                select(HrmEmployee).where(HrmEmployee.status == "ACTIVE")
            )
            hrm_employees = result.scalars().all()

        hrm_ids = {emp.id for emp in hrm_employees}
        hrm_by_username = {emp.username: emp for emp in hrm_employees if emp.username}

        # 2. Load existing Nexus users
        existing_users = (await db.execute(select(User))).scalars().all()
        existing_by_hrm_id = {u.hrm_id: u for u in existing_users if u.hrm_id}
        existing_by_username = {u.username: u for u in existing_users}

        # 3. Sync active HRM employees
        for emp in hrm_employees:
            if not emp.username:
                continue

            full_name = f"{emp.firstName} {emp.lastName}".strip()

            # Try to find existing Nexus user
            nexus_user = existing_by_hrm_id.get(emp.id) or existing_by_username.get(emp.username)

            if nexus_user:
                # Update existing user
                nexus_user.full_name = full_name
                nexus_user.email = emp.email or ""
                nexus_user.last_synced_at = now
                if not nexus_user.hrm_id:
                    nexus_user.hrm_id = emp.id
                # Sync password hash from HRM (bcrypt is compatible)
                if emp.password and emp.password != nexus_user.password_hash:
                    nexus_user.password_hash = emp.password
                # Reactivate if was inactive
                if not nexus_user.is_active:
                    nexus_user.is_active = True
                updated += 1
            else:
                # Create new user
                new_user = User(
                    username=emp.username,
                    password_hash=emp.password or "",
                    role="global_read",
                    is_admin=False,
                    full_name=full_name,
                    email=emp.email or "",
                    hrm_id=emp.id,
                    last_synced_at=now,
                    is_active=True,
                )
                db.add(new_user)
                created += 1

        # 4. Deactivate Nexus users with hrm_id but not in active HRM list
        for u in existing_users:
            if u.hrm_id and u.hrm_id not in hrm_ids and u.is_active:
                u.is_active = False
                deactivated += 1

        await db.commit()

        msg = f"Sync complete: {created} created, {updated} updated, {deactivated} deactivated"
        logger.info("HRM sync: %s", msg)
        return {"created": created, "updated": updated, "deactivated": deactivated, "message": msg}

    except Exception as exc:
        await db.rollback()
        logger.exception("HRM sync failed: %s", exc)
        return {"created": 0, "updated": 0, "deactivated": 0, "message": f"Sync failed: {exc}"}
    finally:
        await hrm_engine.dispose()
