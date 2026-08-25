import re

_MAC_RE = re.compile(
    r"(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}"
    r"|(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}"
    r"|[0-9A-Fa-f]{12}"
)

_PARTIAL_RE = re.compile(r"[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\s*[:|-]?\s*[0-9A-Fa-f]{1,4}")

_COMPACT_RE = re.compile(r"[^0-9A-Fa-f]")


def normalize_mac(raw: str) -> str:
    """Normalize any common MAC notation to lowercase colon form.

    Handles aa:bb:cc:dd:ee:ff, aa-bb-cc-dd-ee-ff, aabb.ccdd.eeff,
    AABBCCDDEEFF and dotted forms with a trailing LLID id.
    """
    if not raw:
        return ""
    value = raw.strip()
    if not value:
        return ""

    m = _PARTIAL_RE.match(value)
    if m:
        token = _COMPACT_RE.sub("", m.group(1))
        if len(token) >= 12:
            value = token[:12]
        else:
            value = token[:12]

    compact = _COMPACT_RE.sub("", value)
    compact = compact.lower()
    if len(compact) < 12:
        return ""
    compact = compact[:12]
    return ":".join(compact[i : i + 2] for i in range(0, 12, 2))


def find_mac(text: str) -> str:
    """Extract the first valid MAC address from arbitrary text."""
    if not text:
        return ""
    m = _MAC_RE.search(text)
    if m:
        return normalize_mac(m.group(0))
    return ""


def find_macs(text: str) -> list[str]:
    """Extract all valid MAC addresses from arbitrary text."""
    if not text:
        return []
    return [normalize_mac(m.group(0)) for m in _MAC_RE.finditer(text)]