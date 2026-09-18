"""Subscriber tag collection from MikroTik firewall address-lists.

Reads 'multi' and 'suspect' address lists from all enabled MikroTik devices,
matches IPs to active PPPoE sessions, and tags the corresponding subscribers.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..drivers.mikrotik import FirewallAddressList, MikrotikDriver
from ..models import MikrotikDevice, PppActiveEntry, Subscriber

logger = logging.getLogger("subscriber_tag")

# Address list names to collect (case-sensitive — must match MikroTik list names exactly)
TAG_LISTS = ("Multi-Router", "suspect")
TAG_LISTS_PREFIX = ("suspect",)  # Also match list names starting with "suspect" (e.g. ipv4-mid-range-suspect)


@dataclass
class TagResult:
    device_name: str
    multi_ips: int
    suspect_ips: int
    tagged_multi: int
    tagged_suspect: int
    errors: list[str]


async def collect_and_tag(session: AsyncSession) -> list[TagResult]:
    """Fetch firewall address-lists from all MikroTik devices and tag subscribers.

    Steps:
    1. For each enabled MikroTik device, fetch /ip/firewall/address-list
    2. Collect all IPs from 'multi' and 'suspect' lists
    3. Match IPs to active PPPoE sessions (ppp_active_entries)
    4. Tag matching subscribers in the subscribers table
    5. Clear tags for subscribers no longer in any list
    """
    devices = (
        await session.execute(
            select(MikrotikDevice).where(MikrotikDevice.enabled == True)  # noqa: E712
        )
    ).scalars().all()

    if not devices:
        return []

    results: list[TagResult] = []

    # Collect all IPs from all devices
    all_multi_ips: set[str] = set()
    all_suspect_ips: set[str] = set()

    for device in devices:
        try:
            driver = MikrotikDriver(device)
            # Fetch ALL address-list entries, then filter locally by name/prefix
            all_entries = await driver.collect_firewall_address_lists([])
            multi_count = 0
            suspect_count = 0
            for entry in all_entries:
                # Normalize IP: strip CIDR notation if present
                ip = entry.address.split("/")[0].strip()
                if not ip:
                    continue
                if entry.list_name in TAG_LISTS or any(entry.list_name.startswith(p) for p in TAG_LISTS_PREFIX):
                    if entry.list_name == "Multi-Router":
                        all_multi_ips.add(ip)
                        multi_count += 1
                    else:
                        all_suspect_ips.add(ip)
                        suspect_count += 1
            results.append(TagResult(
                device_name=device.name,
                multi_ips=multi_count,
                suspect_ips=suspect_count,
                tagged_multi=0,
                tagged_suspect=0,
                errors=[],
            ))
        except Exception as exc:
            logger.warning("Failed to collect address-list from %s: %s", device.name, exc)
            results.append(TagResult(
                device_name=device.name,
                multi_ips=0,
                suspect_ips=0,
                tagged_multi=0,
                tagged_suspect=0,
                errors=[str(exc)],
            ))

    # Match IPs to active PPPoE sessions
    ip_to_subscriber: dict[str, str] = {}
    if all_multi_ips or all_suspect_ips:
        active_sessions = (
            await session.execute(
                select(PppActiveEntry.subscriber, PppActiveEntry.ip)
                .where(PppActiveEntry.ip != "")
            )
        ).all()
        for row in active_sessions:
            ip_to_subscriber[row.ip] = row.subscriber

    # Tag subscribers
    tagged_multi: set[str] = set()
    tagged_suspect: set[str] = set()

    for ip in all_multi_ips:
        sub = ip_to_subscriber.get(ip)
        if sub:
            tagged_multi.add(sub)

    for ip in all_suspect_ips:
        sub = ip_to_subscriber.get(ip)
        if sub:
            tagged_suspect.add(sub)

    # Update subscriber tags
    all_subscribers = (
        await session.execute(
            select(Subscriber).where(Subscriber.is_deleted == False)  # noqa: E712
        )
    ).scalars().all()

    for sub in all_subscribers:
        tags: list[str] = []
        if sub.pppoe_username in tagged_multi:
            tags.append("multi")
        if sub.pppoe_username in tagged_suspect:
            tags.append("suspect")
        new_tag = ",".join(tags)
        if sub.tag != new_tag:
            sub.tag = new_tag

    await session.commit()

    # Update result counts
    for r in results:
        r.tagged_multi = len(tagged_multi)
        r.tagged_suspect = len(tagged_suspect)

    logger.info(
        "Tag collection done: %d multi IPs, %d suspect IPs → %d multi subs, %d suspect subs",
        len(all_multi_ips), len(all_suspect_ips), len(tagged_multi), len(tagged_suspect),
    )

    return results
