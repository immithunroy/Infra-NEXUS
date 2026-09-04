"""MAC binding engine.

Subscriber identity (subscriber ID + client MAC) is taken exclusively from
the Mikrotik /ppp/active table - the Mikrotik validated the PPPoE secret, so
the caller-id MAC belongs to that subscriber. The OLT MAC table is only used
to locate which ONU a session's MAC is physically connected to. Writing a
binding only ever touches our own database - it never changes the Mikrotik
or the OLT.
"""
from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Binding, MacEntry, MikrotikDevice, OLTDevice, Onu, OnuMacHistory, PppActiveEntry
from ..utils.mac import normalize_mac
from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.binding")


async def _get_binding(session: AsyncSession, mac: str, olt_id: int) -> Binding:
    res = await session.execute(select(Binding).where(Binding.mac == mac, Binding.olt_id == olt_id))
    binding = res.scalar_one_or_none()
    if binding is None:
        binding = Binding(mac=mac, olt_id=olt_id)
        session.add(binding)
    return binding


async def _find_onu_id(session: AsyncSession, olt_id: int, mac: str, port: str) -> int | None:
    mac_norm = normalize_mac(mac)
    if mac_norm:
        res = await session.execute(select(Onu.id).where(Onu.olt_id == olt_id, Onu.last_mac == mac_norm))
        onu_id = res.scalar_one_or_none()
        if onu_id is not None:
            return onu_id
    if port:
        res = await session.execute(
            select(Onu.id).where(Onu.olt_id == olt_id, Onu.pon_port == port.upper())
        )
        onu_id = res.scalars().first()
        if onu_id is not None:
            return onu_id
    return None


async def run_bindings(session: AsyncSession) -> dict:
    """Match Mikrotik PPPoE active sessions against OLT learned MACs.

    The /ppp/active table is the authoritative source of subscriber ID +
    MAC (caller-id). Each session whose MAC appears in an OLT MAC table is
    bound to the ONU on that PON port. Returns a summary dict.
    """
    now = utcnow()

    mac_rows = (
        await session.execute(select(MacEntry, OLTDevice).join(OLTDevice, OLTDevice.id == MacEntry.olt_id))
    ).all()
    active_rows = (
        await session.execute(
            select(PppActiveEntry, MikrotikDevice).join(MikrotikDevice, MikrotikDevice.id == PppActiveEntry.device_id)
        )
    ).all()

    # Authoritative subscriber sessions: MAC -> (session, mikrotik).
    active_by_mac: dict[str, tuple[PppActiveEntry, MikrotikDevice]] = {}
    for act, mkt in active_rows:
        mac_norm = normalize_mac(act.mac)
        if mac_norm and mac_norm not in active_by_mac:
            active_by_mac[mac_norm] = (act, mkt)

    # The OLT only locates the ONU for each MAC (PON port -> ONU).
    onu_by_mac: dict[tuple[int, str], int] = {}
    for mac_entry, _ in mac_rows:
        onu_id = await _find_onu_id(session, mac_entry.olt_id, mac_entry.mac, mac_entry.port)
        if onu_id is not None:
            onu_by_mac[(mac_entry.olt_id, mac_entry.mac)] = onu_id

    matched = 0
    unmatched = 0

    for mac_entry, olt in mac_rows:
        mac_norm = normalize_mac(mac_entry.mac)
        hit = active_by_mac.get(mac_norm)
        if hit is not None:
            act, mkt = hit
            matched += 1
        else:
            act, mkt = None, None

        binding = await _get_binding(session, mac_norm, olt.id)
        binding.mac = mac_norm
        binding.olt_id = olt.id
        binding.olt_port = mac_entry.port
        binding.mikrotik_id = mkt.id if mkt else None
        binding.mikrotik_ip = act.ip if act else ""
        binding.mikrotik_interface = act.interface if act else ""
        binding.subscriber = act.subscriber if act else ""
        binding.bound = hit is not None
        binding.onu_id = onu_by_mac.get((olt.id, mac_norm))
        binding.last_checked = now

        # Mirror the result onto the linked ONU record (if any). Only a MAC
        # that is actually a verified PPPoE session (from /ppp/active) may
        # drive the ONU's bound state and last_mac - arbitrary LAN MACs
        # learned on the same PON port must never overwrite the subscriber's
        # device or spawn MAC-change history.
        if binding.onu_id is not None and hit is not None:
            onu = await session.get(Onu, binding.onu_id)
            if onu is not None:
                onu_mac_norm = normalize_mac(onu.last_mac)
                if onu.last_mac and onu_mac_norm != mac_norm:
                    # Switch CPE/router only when the current MAC is no longer
                    # matched anymore; otherwise another bound MAC exists on
                    # this port and we keep the existing one to avoid flapping.
                    if active_by_mac.get(onu_mac_norm) is None:
                        session.add(
                            OnuMacHistory(onu_id=onu.id, mac=onu.last_mac, changed_at=now)
                        )
                        onu.last_mac = mac_norm
                else:
                    onu.last_mac = mac_norm
                onu.bound = True
                onu.mikrotik_ip = act.ip
                onu.subscriber = act.subscriber

    # Any ONU whose last MAC no longer matches a live PPPoE session is
    # unbound now (also clears stale bound/subscriber left with no MAC).
    bound_macs = {normalize_mac(e.mac) for e, _ in mac_rows if normalize_mac(e.mac) in active_by_mac}
    onus = (await session.execute(select(Onu))).scalars().all()
    for onu in onus:
        onu_mac_norm = normalize_mac(onu.last_mac)
        if onu.bound and (not onu.last_mac or onu_mac_norm not in bound_macs):
            onu.bound = False
            onu.mikrotik_ip = ""
            onu.subscriber = ""

    # Record the first connected MAC in history: every bound ONU with a MAC but
    # no history row gets its current (first) MAC written, so the profile shows
    # the initial CPE alongside later switches.
    first_time = [o for o in onus if o.bound and o.last_mac]
    if first_time:
        hist_onu_ids = (
            await session.execute(
                select(OnuMacHistory.onu_id).where(
                    OnuMacHistory.onu_id.in_([o.id for o in first_time])
                )
            )
        ).scalars().all()
        with_history = set(hist_onu_ids)
        for onu in first_time:
            if onu.id not in with_history:
                session.add(OnuMacHistory(onu_id=onu.id, mac=onu.last_mac, changed_at=now))

    await session.commit()
    summary = {
        "matched": matched,
        "unmatched": unmatched,
        "total_macs": len(mac_rows),
        "total_active": len(active_rows),
    }
    logger.info("Binding run finished: %s", summary)
    return summary