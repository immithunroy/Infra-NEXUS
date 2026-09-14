"""HRM User Sync — reads employees from HRM PostgreSQL and syncs to Nexus users."""
from __future__ import annotations

import logging

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from ..models import User
from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.hrm_sync")


# ── HRM DB config helpers ────────────────────────────────────────────────

async def _get_hrm_db_url(db: AsyncSession) -> str | None:
    """Read HRM database config from the settings table."""
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

_HRM_ACTIVE_EMPLOYEES = text("""
    SELECT id, "employeeId", username, "firstName", "lastName", email, password
    FROM "Employee"
    WHERE status::text = 'ACTIVE'
""")


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
        # 1. Fetch active employees from HRM (raw SQL to avoid enum type mismatch)
        async with hrm_engine.connect() as hrm_conn:
            result = await hrm_conn.execute(_HRM_ACTIVE_EMPLOYEES)
            hrm_rows = result.all()

        hrm_ids = {row[0] for row in hrm_rows}
        hrm_by_username = {row[2]: row for row in hrm_rows if row[2]}

        # 2. Load existing Nexus users
        existing_users = (await db.execute(select(User))).scalars().all()
        existing_by_hrm_id = {u.hrm_id: u for u in existing_users if u.hrm_id}
        existing_by_username = {u.username: u for u in existing_users}

        # 3. Sync active HRM employees
        for row in hrm_rows:
            emp_id, emp_emp_id, username, first_name, last_name, email, password = row
            if not username:
                continue

            full_name = f"{first_name or ''} {last_name or ''}".strip()
            email = email or ""
            password_hash = password or ""

            # Try to find existing Nexus user
            nexus_user = existing_by_hrm_id.get(emp_id) or existing_by_username.get(username)

            if nexus_user:
                # Update existing user
                nexus_user.full_name = full_name
                nexus_user.email = email
                nexus_user.last_synced_at = now
                if not nexus_user.hrm_id:
                    nexus_user.hrm_id = emp_id
                # Sync password hash from HRM (bcrypt is compatible)
                if password_hash and password_hash != nexus_user.password_hash:
                    nexus_user.password_hash = password_hash
                # Reactivate if was inactive
                if not nexus_user.is_active:
                    nexus_user.is_active = True
                updated += 1
            else:
                # Create new user
                new_user = User(
                    username=username,
                    password_hash=password_hash,
                    role="global_read",
                    is_admin=False,
                    full_name=full_name,
                    email=email,
                    hrm_id=emp_id,
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
