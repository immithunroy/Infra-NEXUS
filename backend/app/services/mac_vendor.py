"""MAC vendor resolution (OUI -> brand) for display.

Vendors are fetched from free providers (maclookup.app primary, macvendors.com
fallback) and cached in the ``mac_vendors`` table keyed by OUI so the provider
is only contacted once per OUI.

Two distinct paths:

- **Background sync** (:func:`sync_all_vendors`): runs daily via scheduler,
  collects every OUI from the ``onus`` table, fetches any missing/empty ones
  from the external API, and batch-updates the cache.  HTTP happens *only*
  here — never during page loads.

- **Request-time lookup** (:func:`vendor_map`): pure DB read.  Extracts OUIs
  from the caller's MAC list, fetches their brands from ``mac_vendors``, and
  returns a dict.  Zero HTTP, zero flush — fast and pool-safe.
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

from ..models import MacVendor, Onu
from ..utils.mac import normalize_mac
from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.mac_vendor")

FETCH_CONCURRENCY = 5

_MACLOOKUP = "https://api.maclookup.app/v2/macs/{oui}"
_MACVENDORS = "https://api.macvendors.com/{oui}"

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


# ---------------------------------------------------------------------------
# Helpers (shared by sync and fetch)
# ---------------------------------------------------------------------------

def oui_of(mac: str) -> str:
    clean = normalize_mac(mac)
    if len(clean) < 8:
        return ""
    return clean[:8].replace(":", "").upper()


def normalize_brand(vendor: str) -> str:
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


def _http_get_json(url: str, timeout: float = 4.0) -> dict:
    with request.urlopen(request.Request(url, headers={"User-Agent": "olt-commander/1.0"}), timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


def _http_get_text(url: str, timeout: float = 4.0) -> str:
    with request.urlopen(request.Request(url, headers={"User-Agent": "olt-commander/1.0"}), timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace").strip()


async def _fetch_vendor(oui: str) -> tuple[str, str]:
    try:
        data = await asyncio.to_thread(_http_get_json, _MACLOOKUP.format(oui=oui))
        company = (data.get("company") or "").strip()
        if data.get("found") and company:
            return "maclookup", company
    except Exception:
        pass
    try:
        text = await asyncio.to_thread(_http_get_text, _MACVENDORS.format(oui=oui))
        if text and "not found" not in text.lower() and len(text) > 1:
            return "macvendors", text
    except Exception:
        pass
    return "", ""


# ---------------------------------------------------------------------------
# Background sync (called by scheduler — once daily)
# ---------------------------------------------------------------------------

async def sync_all_vendors(session: AsyncSession) -> None:
    """Collect every OUI from the ``onus`` table and populate ``mac_vendors``.

    This is the **only** function that makes HTTP calls.  It runs in the
    background scheduler, completely isolated from page-load requests.
    Unknown OUIs are fetched sequentially (with concurrency cap) and written
    to the DB in a single batch flush.
    """
    # Gather all OUIs from onus (mac + last_mac) in Python for portability
    onu_rows = (
        await session.execute(
            select(Onu.mac, Onu.last_mac)
        )
    ).all()

    all_ouis: set[str] = set()
    for mac, last_mac in onu_rows:
        for m in (mac, last_mac):
            if m:
                oui = oui_of(m)
                if oui:
                    all_ouis.add(oui)

    if not all_ouis:
        logger.info("MAC vendor sync: no OUIs found in onus table")
        return

    # Check which OUIs need fetching (missing or empty brand)
    now = utcnow()
    oui_list = list(all_ouis)
    existing = (
        await session.execute(
            select(MacVendor).where(MacVendor.oui.in_(oui_list))
        )
    ).scalars().all()
    existing_map = {r.oui: r for r in existing}

    to_fetch: list[str] = []
    for oui in oui_list:
        if oui not in existing_map:
            to_fetch.append(oui)
        elif not existing_map[oui].brand:
            to_fetch.append(oui)

    if not to_fetch:
        logger.info("MAC vendor sync: all %d OUIs already cached", len(all_ouis))
        return

    logger.info("MAC vendor sync: fetching %d new/empty OUIs out of %d total", len(to_fetch), len(all_ouis))

    # 3. Fetch sequentially with concurrency cap — no DB session held during HTTP
    sem = asyncio.Semaphore(FETCH_CONCURRENCY)
    results: dict[str, tuple[str, str]] = {}  # oui -> (source, vendor)

    async def _fetch_one(oui: str) -> None:
        async with sem:
            source, vendor = await _fetch_vendor(oui)
            results[oui] = (source, vendor)

    await asyncio.gather(*(_fetch_one(oui) for oui in to_fetch))

    # 4. Batch write to DB
    fetched_count = 0
    for oui, (source, vendor) in results.items():
        brand = normalize_brand(vendor) if vendor else ""
        if oui in existing_map:
            existing_map[oui].vendor = vendor
            existing_map[oui].brand = brand
            existing_map[oui].source = source
            existing_map[oui].updated_at = utcnow()
        else:
            session.add(MacVendor(oui=oui, vendor=vendor, brand=brand, source=source, updated_at=utcnow()))
        fetched_count += 1

    try:
        await session.flush()
    except Exception:
        logger.exception("MAC vendor sync: failed to flush vendor data")

    logger.info("MAC vendor sync complete: %d OUIs fetched, %d total cached", fetched_count, len(all_ouis))


# ---------------------------------------------------------------------------
# Request-time lookup (pure DB — zero HTTP)
# ---------------------------------------------------------------------------

async def vendor_map(session: AsyncSession, macs: Iterable[str]) -> dict[str, str]:
    """Resolve a batch of MACs to brand names from the local cache.

    Returns a dict keyed by lowercased MAC -> brand ("" when unknown/not yet
    synced).  This function **never** makes HTTP calls — it reads only from
    the ``mac_vendors`` table which is populated by :func:`sync_all_vendors`.
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

    rows = (
        await session.execute(select(MacVendor).where(MacVendor.oui.in_(ouis)))
    ).scalars().all()
    brand_by_oui = {r.oui: r.brand for r in rows}

    result: dict[str, str] = {}
    for oui, macs_for_oui in by_oui.items():
        brand = brand_by_oui.get(oui, "")
        for mac in macs_for_oui:
            result[mac.lower()] = brand
    return result
