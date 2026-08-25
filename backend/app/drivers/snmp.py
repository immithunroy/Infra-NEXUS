"""SNMP helpers built on pysnmp 7.x (async hlapi).

Uses the native asyncio SNMP engine so walks integrate with the FastAPI
event loop without blocking it.
"""
from __future__ import annotations

from pysnmp.hlapi.asyncio import (
    CommunityData,
    ContextData,
    ObjectIdentity,
    ObjectType,
    SnmpEngine,
    UdpTransportTarget,
    next_cmd,
)

from .base import DriverError


def _value_str(value) -> str:
    try:
        return value.prettyPrint()
    except Exception:
        return str(value)


async def snmp_walk(
    host: str, community: str, oid: str, port: int = 161, timeout: float = 5.0
) -> list[tuple[str, str]]:
    """Walk an OID subtree with repeated GETNEXT (pysnmp 7.1 style).

    The SnmpEngine registers UDP transports that keep sockets open; without
    closing the dispatcher every walk leaks a file descriptor, eventually
    exhausting the process ulimit (backlog of 502s). We always close it.
    """
    results: list[tuple[str, str]] = []
    engine = SnmpEngine()
    try:
        target = await UdpTransportTarget.create((host, port), timeout=timeout, retries=1)
        prefix = oid + "."
        cur = oid
        while True:
            iterator = next_cmd(
                engine,
                CommunityData(community, mpModel=1),
                target,
                ContextData(),
                ObjectType(ObjectIdentity(cur)),
                lookupMib=False,
            )
            error_indication, error_status, error_index, var_binds = await iterator
            if error_indication:
                raise DriverError(f"SNMP error: {error_indication}")
            if error_status:
                raise DriverError(
                    f"SNMP error: {error_status.prettyPrint()} at {error_index and var_binds[int(error_index) - 1][0]}"
                )
            name = str(var_binds[0][0])
            if not name.startswith(prefix):
                break
            results.append((name, _value_str(var_binds[0][1])))
            cur = name
    finally:
        try:
            engine.close_dispatcher()
        except Exception:  # noqa: BLE001
            pass
    return results


async def snmp_get(
    host: str, community: str, oid: str, port: int = 161, timeout: float = 5.0
) -> str | None:
    results = await snmp_walk(host, community, oid, port, timeout)
    if results:
        return results[0][1]
    return None