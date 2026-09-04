"""Sync PPPoE secrets from MikroTik into the Subscriber table.

Called after each successful MikroTik scan.  Handles:
- Upserting secrets as Subscriber records
- Marking disabled secrets (billing-expired)
- Soft-deleting secrets confirmed absent from a successful sync
"""

import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..drivers.mikrotik import SecretInfo
from ..models import Subscriber
from ..utils.time import utcnow

log = logging.getLogger(__name__)

_GRACE_PERIOD = timedelta(hours=24)


async def sync_subscribers(
    session: AsyncSession,
    device_id: int,
    secrets: list[SecretInfo],
) -> dict:
    """Sync PPPoE secrets into the subscribers table.

    Returns summary dict: {synced, disabled, soft_deleted}.
    """
    now = utcnow()
    seen_usernames: set[str] = set()
    synced = 0
    disabled = 0

    for secret in secrets:
        username = secret.name.strip()
        if not username:
            continue
        seen_usernames.add(username)

        result = await session.execute(
            select(Subscriber).where(Subscriber.pppoe_username == username)
        )
        sub = result.scalar_one_or_none()

        if sub is None:
            sub = Subscriber(
                pppoe_username=username,
                mikrotik_device_id=device_id,
                disabled=secret.disabled,
                service=secret.service,
                profile=secret.profile,
                last_synced_at=now,
                first_seen_at=now,
                last_seen_at=now,
            )
            session.add(sub)
            synced += 1
        else:
            sub.mikrotik_device_id = device_id
            sub.disabled = secret.disabled
            sub.service = secret.service
            sub.profile = secret.profile
            sub.last_synced_at = now
            sub.last_seen_at = now
            if sub.is_deleted:
                sub.is_deleted = False
                sub.deleted_at = None
            synced += 1

        if secret.disabled:
            disabled += 1

    # Soft-delete subscribers absent from this successful sync
    soft_deleted = 0
    if seen_usernames:
        result = await session.execute(
            select(Subscriber).where(
                Subscriber.mikrotik_device_id == device_id,
                Subscriber.is_deleted == False,  # noqa: E712
            )
        )
        existing = result.scalars().all()
        for sub in existing:
            if sub.pppoe_username not in seen_usernames:
                if sub.last_synced_at and (now - sub.last_synced_at) > _GRACE_PERIOD:
                    sub.is_deleted = True
                    sub.deleted_at = now
                    soft_deleted += 1

    await session.flush()
    log.info(
        "Subscriber sync device=%d: synced=%d disabled=%d soft_deleted=%d",
        device_id, synced, disabled, soft_deleted,
    )
    return {"synced": synced, "disabled": disabled, "soft_deleted": soft_deleted}
