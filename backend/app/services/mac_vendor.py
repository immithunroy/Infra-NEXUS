"""MAC vendor resolution (OUI -> brand) for display.

Vendors are fetched from free providers (maclookup.app primary, macvendors.com
fallback) and cached in the ``mac_vendors`` table keyed by OUI so the provider
is only contacted once per OUI. Every list endpoint resolves its MACs through
:func:`vendor_map`, which batches DB lookups and only fetches unknown OUIs.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from collections.abc import Iterable
from urllib import request

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import MacVendor
from ..utils.mac import normalize_mac
from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.mac_vendor")

# One failed lookup stays "known-empty" this long before we hit the provider
# again (avoids hammering the free APIs when the network is down).
REFETCH_COOLDOWN_SECONDS = 86400
# Max unknown OUIs resolved per API call, to keep list endpoints responsive.
MAX_FETCH_PER_CALL = 20
# Concurrent provider requests.
FETCH_CONCURRENCY = 5

_MACLOOKUP = "https://api.maclookup.app/v2/macs/{oui}"
_MACVENDORS = "https://api.macvendors.com/{oui}"

# Well-known CPE brands mapped from the full legal vendor name the providers
# return. Checked first so "TP-LINK TECHNOLOGIES CO.,LTD." -> "TP-Link".
_BRAND_ALIASES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)\btp[- ]?link\b"), "TP-Link"),
    (re.compile(r"(?i)\bdeco\b"), "Deco"),
    (re.compile(r"(?i)\btenda\b"), "Tenda"),
    (re.compile(r"(?i)\bruijie\b"), "Ruijie"),
    (re.compile(r"(?i)\bnetgear\b"), "Netgear"),
    (re.compile(r"(?i)\basus(?:tek)?\b"), "Asus"),
    (re.compile(r"(?i)\bd[- ]?link\b"), "D-Link"),
    (re.compile(r"(?i)\bcudy\b"), "Cudy"),
    (re.compile(r"(?i)\bnetis\b"), "Netis"),
    (re.compile(r"(?i)\bmercucys\b"), "Mercusys"),
    (re.compile(r"(?i)\btotolink\b"), "TOTOLINK"),
    (re.compile(r"(?i)\bzte\b"), "ZTE"),
    (re.compile(r"(?i)\bhuawei\b"), "Huawei"),
    (re.compile(r"(?i)\bnokia\b"), "Nokia"),
    (re.compile(r"(?i)\bv[- ]?solution\b"), "V-Solution"),
    (re.compile(r"(?i)\bfiberhome\b"), "FiberHome"),
    (re.compile(r"(?i)\bgpon\b"), "GPON"),
    (re.compile(r"(?i)\bsagem\b"), "Sagemcom"),
    (re.compile(r"(?i)\bexplay\b"), "Explay"),
]

# Tokens stripped from the vendor name when no brand alias matched. The first
# surviving word becomes the brand.
_DROP_TOKENS = {
    "CO", "LTD", "LTD.", "LIMITED", "INC", "INC.", "INCORPORATED", "CORP", "CORP.",
    "CORPORATION", "LLC", "L.L.C.", "PVT", "PRIVATE", "COMPANY", "COMPANIES",
    "TECHNOLOGIES", "TECHNOLOGY", "TECHNOLOGICAL", "ELECTRONIC", "ELECTRONICS",
    "NETWORK", "NETWORKS", "COMMUNICATION", "COMMUNICATIONS", "SYSTEMS", "SYSTEM",
    "INTERNATIONAL", "INFORMATION", "IT", "GROUP", "ENTERPRISE", "ENTERPRISES",
    "INDUSTRIAL", "INDUSTRY", "INDUSTRIES", "SHENZHEN", "GUANGZHOU", "DONGGUAN",
    "BEIJING", "SHANGHAI", "HANGZHOU", "CHENGDU", "CHINA", "BRANCH", "FACTORY",
    "DIVISION", "MANUFACTURING", "MANUFACTURE", "MANUFACTURER", "OPTOELECTRONICS",
    "PHOTOELECTRIC", "OPTICAL", "OPTOELECTRONIC", "HOLDINGS", "HOLDING", "PLATFORM",
    "UNIVERSAL", "GLOBAL", "TELECOM", "TELECOMMUNICATION", "TELECOMMUNICATIONS",
    "EQUIPMENT", "SOLUTION", "SOLUTIONS", "S&T", "R&D", "DEVELOPMENT", "SCIENCE",
    "TECH", "SUPPLY", "CHAIN", "NET",
}


def oui_of(mac: str) -> str:
    """First three MAC bytes as uppercase hex without separators."""
    clean = normalize_mac(mac)
    if len(clean) < 8:
        return ""
    return clean[:8].replace(":", "").upper()


def normalize_brand(vendor: str) -> str:
    """Shorten a full vendor name to its prime brand (TP-Link, Tenda, ...)."""
    if not vendor:
        return ""
    for pattern, brand in _BRAND_ALIASES:
        if pattern.search(vendor):
            return brand
    words = re.split(r"[\s,.&/\\()]+", vendor)
    for w in words:
        token = w.strip().upper()
        if token and token not in _DROP_TOKENS:
            return _title_brand(w)
    return ""


def _title_brand(word: str) -> str:
    if word.isupper() and len(word) > 1:
        return word[:1] + word[1:].lower()
    return word


def _http_get_json(url: str, timeout: float = 8.0) -> dict:
    with request.urlopen(request.Request(url, headers={"User-Agent": "olt-commander/1.0"}), timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _http_get_text(url: str, timeout: float = 8.0) -> str:
    with request.urlopen(request.Request(url, headers={"User-Agent": "olt-commander/1.0"}), timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace").strip()


async def _fetch_vendor(oui: str) -> tuple[str, str]:
    """Return (source, vendor) for an OUI, or ("", "") when unknown/offline."""
    try:
        data = await asyncio.to_thread(_http_get_json, _MACLOOKUP.format(oui=oui))
        company = (data.get("company") or "").strip()
        if data.get("found") and company:
            return "maclookup", company
    except Exception:  # noqa: BLE001
        pass
    try:
        text = await asyncio.to_thread(_http_get_text, _MACVENDORS.format(oui=oui))
        if text and "not found" not in text.lower() and len(text) > 1:
            return "macvendors", text
    except Exception:  # noqa: BLE001
        pass
    return "", ""


async def _resolve(session: AsyncSession, oui: str) -> str:
    """Ensure a cached row exists for the OUI and return its brand."""
    row = await session.get(MacVendor, oui)
    if row is not None and row.brand:
        return row.brand
    if row is not None and (utcnow() - row.updated_at).total_seconds() < REFETCH_COOLDOWN_SECONDS:
        return ""
    source, vendor = await _fetch_vendor(oui)
    brand = normalize_brand(vendor) if vendor else ""
    if row is None:
        session.add(MacVendor(oui=oui, vendor=vendor, brand=brand, source=source, updated_at=utcnow()))
    else:
        row.vendor = vendor
        row.brand = brand
        row.source = source
        row.updated_at = utcnow()
    await session.flush()
    return brand


async def vendor_map(session: AsyncSession, macs: Iterable[str]) -> dict[str, str]:
    """Resolve a batch of MACs to brand names.

    Returns a dict keyed by lowercased MAC -> brand ("" when unknown). Unknown
    OUIs are fetched from the provider, capped to keep requests fast.
    """
    by_oui: dict[str, list[str]] = {}
    for mac in macs:
        if not mac:
            continue
        oui = oui_of(mac)
        if oui:
            by_oui.setdefault(oui, []).append(mac)
    if not by_oui:
        return {}

    ouis = list(by_oui)
    rows = (await session.execute(select(MacVendor).where(MacVendor.oui.in_(ouis)))).scalars().all()
    known: dict[str, MacVendor] = {r.oui: r for r in rows}
    now = utcnow()

    to_fetch = [
        oui
        for oui in ouis
        if oui not in known or not known[oui].brand and (now - known[oui].updated_at).total_seconds() >= REFETCH_COOLDOWN_SECONDS
    ][:MAX_FETCH_PER_CALL]
    if to_fetch:
        sem = asyncio.Semaphore(FETCH_CONCURRENCY)

        async def guarded(oui: str) -> None:
            async with sem:
                try:
                    await _resolve(session, oui)
                except Exception:  # noqa: BLE001
                    logger.exception("MAC vendor fetch failed for %s", oui)

        await asyncio.gather(*(guarded(oui) for oui in to_fetch))
        await session.flush()

    rows = (await session.execute(select(MacVendor).where(MacVendor.oui.in_(ouis)))).scalars().all()
    brand_by_oui = {r.oui: r.brand for r in rows}
    result: dict[str, str] = {}
    for oui, macs_for_oui in by_oui.items():
        brand = brand_by_oui.get(oui, "")
        for mac in macs_for_oui:
            result[mac.lower()] = brand
    return result