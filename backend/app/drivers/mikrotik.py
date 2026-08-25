"""Mikrotik RouterOS driver using the RouterOS API (librouteros).

Collects the PPP secrets (the authoritative subscriber list) and PPPoE
active sessions so that client MACs (caller-id) learned on the OLT can be
matched against the customer's IP / subscriber username. The /ppp/active
table is the single authoritative source of subscriber ID + MAC: the
Mikrotik has already validated the PPPoE secret, so the caller-id MAC is
definitely that subscriber's router. DHCP lease and ARP tables are
intentionally NOT used - PPPoE is the only subscriber source.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from librouteros import connect

from ..models import MikrotikDevice
from ..utils.mac import normalize_mac
from .base import DriverError


@dataclass
class ActiveSession:
    mac: str
    ip: str
    interface: str
    subscriber_id: str = ""


class MikrotikDriver:
    def __init__(self, device: MikrotikDevice):
        self.device = device

    def _connect(self):
        kwargs = {
            "host": self.device.ip,
            "username": self.device.username,
            "password": self.device.password,
            "port": self.device.api_port,
            "ssl": self.device.use_ssl,
            "timeout": 15,
        }
        try:
            kwargs["login_method"] = "routeros" if self.device.routeros_version >= 7 else "legacy"
        except TypeError:
            pass
        try:
            return connect(**kwargs)
        except TypeError:
            kwargs.pop("login_method", None)
            return connect(**kwargs)

    def _collect(self) -> tuple[list[dict], list[dict]]:
        api = self._connect()
        try:
            secrets = list(api("/ppp/secret/print"))
            ppp_active = list(api("/ppp/active/print"))
        finally:
            try:
                api.close()
            except Exception:
                pass
        return secrets, ppp_active

    async def test(self) -> str:
        try:
            secrets, ppp_active = await asyncio.to_thread(self._collect)
            return (
                f"RouterOS OK ({len(secrets)} PPP secrets, "
                f"{len(ppp_active)} PPP active)"
            )
        except Exception as exc:
            raise DriverError(f"Mikrotik connection failed: {exc}") from exc

    async def collect(self) -> tuple[list[ActiveSession], int, int]:
        """Return (PPPoE active sessions, PPP secret count, active count).

        The secret table is the total subscriber population; the active
        table carries the client's MAC (caller-id), IP and PPPoE username.
        """
        try:
            secrets, ppp_active = await asyncio.to_thread(self._collect)
        except Exception as exc:
            raise DriverError(f"Mikrotik collection failed: {exc}") from exc

        sessions: list[ActiveSession] = []
        for row in ppp_active:
            mac = normalize_mac(row.get("caller-id") or row.get("calling-station-id", ""))
            if not mac:
                continue
            sessions.append(
                ActiveSession(
                    mac=mac,
                    ip=row.get("address", ""),
                    interface=row.get("interface", ""),
                    subscriber_id=str(row.get("name", "")),
                )
            )
        return sessions, len(secrets), len(ppp_active)