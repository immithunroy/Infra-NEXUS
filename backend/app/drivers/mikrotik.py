"""Mikrotik RouterOS driver using the RouterOS API (librouteros).

Collects the PPP secrets (the authoritative subscriber list) and PPPoE
active sessions so that client MACs (caller-id) learned on the OLT can be
matched against the customer's IP / subscriber username. The /ppp/active
table is the single authoritative source of subscriber ID + MAC: the
Mikrotik has already validated the PPPoE secret, so the caller-id MAC is
definitely that subscriber's router. DHCP lease and ARP tables are
intentionally NOT used - PPPoE is the only subscriber source.

Also collects BGP session and route data when available.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

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


@dataclass
class BgpSessionInfo:
    name: str = ""
    remote_as: int = 0
    remote_ip: str = ""
    local_ip: str = ""
    local_as: int = 0
    address_family: str = ""
    state: str = "idle"
    uptime: str = ""
    prefix_count: int = 0
    advertised_count: int = 0
    routes: list["BgpRouteInfo"] = field(default_factory=list)


@dataclass
class BgpRouteInfo:
    prefix: str = ""
    nexthop: str = ""
    metric: int = 0
    community: str = ""
    received: bool = True


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

    def _collect_bgp(self) -> tuple[list[dict], list[dict]]:
        api = self._connect()
        try:
            sessions = list(api("/routing/bgp/session/print"))
            advertisements = list(api("/routing/bgp/advertisements/print"))
        finally:
            try:
                api.close()
            except Exception:
                pass
        return sessions, advertisements

    async def collect_bgp(self) -> tuple[list[BgpSessionInfo], int, int]:
        """Return (BGP sessions, total prefix count, established count).

        Handles both RouterOS v6 (flat keys) and v7 (nested keys).
        """
        try:
            raw_sessions, raw_advs = await asyncio.to_thread(self._collect_bgp)
        except Exception as exc:
            raise DriverError(f"BGP collection failed: {exc}") from exc

        adv_by_peer: dict[str, int] = {}
        for adv in raw_advs:
            peer = (
                adv.get("remote.address", "")
                or adv.get("peer", "")
                or adv.get("remote-address", "")
                or _deep_get(adv, "remote.address", "")
                or ""
            )
            if peer:
                adv_by_peer[peer] = adv_by_peer.get(peer, 0) + 1

        sessions: list[BgpSessionInfo] = []
        total_prefixes = 0
        established = 0

        for row in raw_sessions:
            # RouterOS v7 uses flat dotted keys like "remote.address", "remote.as"
            # Try flat key first (dict lookup with full dotted string), then nested
            remote_ip = (
                row.get("remote.address", "")
                or row.get("remote-address", "")
                or row.get("remote.ip", "")
                or _deep_get(row, "remote.address", "")
                or ""
            )
            remote_as = int(
                row.get("remote.as", 0)
                or row.get("remote-as", 0)
                or _deep_get_int(row, "remote.as", 0)
                or 0
            )
            local_ip = (
                row.get("local.address", "")
                or row.get("local-address", "")
                or row.get("local.ip", "")
                or _deep_get(row, "local.address", "")
                or ""
            )
            local_as = int(
                row.get("local.as", 0)
                or row.get("local-as", 0)
                or _deep_get_int(row, "local.as", 0)
                or 0
            )
            name = str(row.get("name", "") or row.get("remote.identity", "") or "")
            address_family = str(
                row.get("remote.afi", "")
                or row.get("local.afi", "")
                or row.get("address-family", "")
                or row.get("af", "")
                or ""
            )
            # RouterOS v7 uses "established" boolean instead of "state" string
            if row.get("established") is True or row.get("established") == "true":
                state = "established"
                established += 1
            else:
                state_raw = str(row.get("state", "") or row.get("status", "")).lower()
                if state_raw in ("established", "estab"):
                    state = "established"
                    established += 1
                elif state_raw in ("active",):
                    state = "active"
                elif state_raw in ("connect",):
                    state = "connect"
                else:
                    state = state_raw or "idle"

            uptime = str(row.get("uptime", ""))
            prefix_count = int(row.get("prefix-count", 0) or row.get("received-prefix-count", 0) or 0)
            advertised_count = adv_by_peer.get(remote_ip, 0)

            total_prefixes += prefix_count

            sessions.append(BgpSessionInfo(
                name=name,
                remote_as=remote_as,
                remote_ip=remote_ip,
                local_ip=local_ip,
                local_as=local_as,
                address_family=address_family,
                state=state,
                uptime=uptime,
                prefix_count=prefix_count,
                advertised_count=advertised_count,
            ))

        return sessions, total_prefixes, established


def _deep_get(d: dict, key: str, default=""):
    """Get a nested key like 'remote.address' from a dict."""
    parts = key.split(".")
    cur = d
    for p in parts:
        if isinstance(cur, dict):
            cur = cur.get(p, default)
        else:
            return default
    return cur or default


def _deep_get_int(d: dict, key: str, default=0):
    val = _deep_get(d, key, default)
    try:
        return int(val)
    except (TypeError, ValueError):
        return default