"""Remote router/CPE access probe.

Subscriber routers expose their management page on the PPPoE-assigned IP on
one of a few common ports (8080/80/443/8443). This service cheaply TCP-probes
those ports (with a short timeout) and returns the best URL for one-click
access, caching results briefly so list pages do not re-probe every render.
"""
from __future__ import annotations

import asyncio
import time

# (scheme, port) in preference order (8080 is the most common management port).
REMOTE_PORTS: list[tuple[str, int]] = [
    ("http", 8080),
    ("http", 80),
    ("https", 443),
    ("https", 8443),
]
PROBE_TIMEOUT = 1.5
CACHE_TTL_SECONDS = 60.0
_MAX_CONCURRENT = 32

_cache: dict[str, tuple[float, dict]] = {}


async def _tcp_open(ip: str, port: int) -> bool:
    try:
        await asyncio.wait_for(asyncio.open_connection(ip, port), timeout=PROBE_TIMEOUT)
        return True
    except (OSError, asyncio.TimeoutError):
        return False


def _host(ip: str) -> str:
    return f"[{ip}]" if ":" in ip else ip


def _result(ip: str, checked_at: float) -> dict:
    ports = [{"port": p, "scheme": s, "open": False} for s, p in REMOTE_PORTS]
    return {"ip": ip, "reachable": False, "url": "", "ports": ports, "checked_at": checked_at}


async def probe_ip(ip: str, force: bool = False) -> dict:
    """Probe one IP across the remote-access ports (cached)."""
    now = time.time()
    if not force and ip in _cache and now - _cache[ip][0] < CACHE_TTL_SECONDS:
        return _cache[ip][1]

    ports = [{"port": p, "scheme": s, "open": False} for s, p in REMOTE_PORTS]
    open_flags = await asyncio.gather(*(_tcp_open(ip, p) for _, p in REMOTE_PORTS))
    for entry, open_ in zip(ports, open_flags):
        entry["open"] = open_

    url = ""
    for entry in ports:
        if entry["open"]:
            url = f"{entry['scheme']}://{_host(ip)}:{entry['port']}"
            break
    result = {
        "ip": ip,
        "reachable": bool(url),
        "url": url,
        "ports": ports,
        "checked_at": now,
    }
    _cache[ip] = (now, result)
    return result


async def probe_ips(ips: list[str], force: bool = False) -> dict[str, dict]:
    """Probe several IPs concurrently, keyed by IP."""
    sem = asyncio.Semaphore(_MAX_CONCURRENT)

    async def guarded(ip: str) -> dict:
        async with sem:
            return await probe_ip(ip, force=force)

    results = await asyncio.gather(*(guarded(ip) for ip in dict.fromkeys(ips)))
    return {ip: res for ip, res in zip(dict.fromkeys(ips), results)}
