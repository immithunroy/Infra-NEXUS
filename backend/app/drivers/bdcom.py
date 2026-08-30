"""BDCOM OLT driver (P3310 / P3608 family).

Supports three access methods:
  * telnet  - BDCOM CLI over Telnet (our dependency-free client)
  * ssh     - BDCOM CLI over SSH (asyncssh)
  * snmp    - GPON MIB walks (enterprises.3320) via pysnmp

The CLI path is preferred for MAC collection because `show mac
address-table` carries the PON port the MAC was learned on.
"""
from __future__ import annotations

import asyncio
import re
import time
from typing import NamedTuple

import asyncssh

from ..config import get_settings
from ..models import OLTDevice
from ..utils.mac import find_mac, normalize_mac
from ..utils.telnet import TelnetClient, TelnetError
from .base import BaseDriver, DriverError, MacInfo, OnuInfo
from .snmp import snmp_walk

# GPON MIB (1.3.6.1.4.1.3320.10.x)
GPON_ONU_STATUS_OID = "1.3.6.1.4.1.3320.10.3.3.1.4"
GPON_ONU_RX_OID = "1.3.6.1.4.1.3320.10.3.4.1.2"
GPON_ONU_TX_OID = "1.3.6.1.4.1.3320.10.3.4.1.3"

# IF-MIB interface counters (per-ONU ports appear in ifDescr).
IF_HC_IN_OCTETS = "1.3.6.1.2.1.31.1.1.1.6"
IF_HC_OUT_OCTETS = "1.3.6.1.2.1.31.1.1.1.10"
IF_IN_OCTETS = "1.3.6.1.2.1.2.2.1.10"
IF_OUT_OCTETS = "1.3.6.1.2.1.2.2.1.16"

# Optical walks tolerate a busy OLT (a CLI scan often overlaps the scheduled
# telemetry run), so allow generous timeouts and retries per GETNEXT.
OPTICAL_SNMP_TIMEOUT = 10.0

# 32-bit Counter32 wrap point (used when only the legacy counters exist).
COUNTER32_WRAP = 1 << 32

ONU_STATUS_MAP = {"0": "inactive", "1": "inactive", "2": "offline", "3": "active"}

_PORT_RE = re.compile(
    r"(?i)(?:gpon|epon)\s*(\d+/\d+):(\d+)"
)
_PON_RE = re.compile(r"(?i)\b(?:gpon|epon)\s*(\d+/\d+)")
_SN_RE = re.compile(r"\b([A-Z0-9]{8,16})\b")
_STATUS_RE = re.compile(
    r"(?i)\b(active|inactive|offline|off-line|deregistered|registered|online|auto-configured|authenticated|auth-fail|authorized)\b"
)
# EPON continuation line carries the dereg reason: "static deregistered power-off".
_DEREG_RE = re.compile(
    r"(?i)\b(power-off|wire-down|mpcp-down|oam-down|firmware-download|illegal-mac|llid-admin-down|normal|unknown)\b"
)
_LLID_RE = re.compile(r"llid\s*[:=]?\s*(\d+)", re.I)

# optical diagnosis row: IntfName  Temp Volt Bias Rx Tx
_OPTICAL_RE = re.compile(
    r"(?i)(?:gpon|epon)\s*(\d+/\d+):(\d+)\s+"
    r"([-\d.]+|--)\s+([-\d.]+|--)\s+([-\d.]+|--)\s+([-\d.]+|--)\s+([-\d.]+|--)"
)


def _num(v: str) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _dbm(value: str) -> float | None:
    """Convert a 0.1 dBm integer SNMP reading to dBm; drop the -65535 sentinel."""
    if not value.lstrip("-").isdigit():
        return None
    val = int(value)
    if val <= -6000:  # -65535 sentinel: ONU not reporting optics
        return None
    return val / 10.0


class OpticalSample(NamedTuple):
    """One ONU's optical powers plus byte counters for bandwidth computation."""

    rx: float | None
    tx: float | None
    in_octets: int | None
    out_octets: int | None


def _counter(value: str) -> int | None:
    if value.lstrip("-").isdigit():
        return int(value)
    return None


async def _snmp_octets(
    ip: str, community: str, port: int
) -> tuple[dict[int, int], dict[int, int]]:
    """64-bit HC byte counters keyed by ifIndex, falling back to 32-bit."""
    for in_oid, out_oid in (
        (IF_HC_IN_OCTETS, IF_HC_OUT_OCTETS),
        (IF_IN_OCTETS, IF_OUT_OCTETS),
    ):
        try:
            in_walk = await snmp_walk(ip, community, in_oid, port, timeout=OPTICAL_SNMP_TIMEOUT)
            out_walk = await snmp_walk(ip, community, out_oid, port, timeout=OPTICAL_SNMP_TIMEOUT)
        except DriverError:
            continue
        in_rows: dict[int, int] = {}
        for oid, v in in_walk:
            c = _counter(v)
            if c is not None:
                in_rows[int(oid.split(".")[-1])] = c
        out_rows: dict[int, int] = {}
        for oid, v in out_walk:
            c = _counter(v)
            if c is not None:
                out_rows[int(oid.split(".")[-1])] = c
        if in_rows or out_rows:
            return in_rows, out_rows
    return {}, {}


async def _snmp_optical(device: OLTDevice, rx_oid: str, tx_oid: str) -> dict[str, OpticalSample]:
    """Per-ONU RX/TX power and byte counters via SNMP.

    All tables (ifDescr, rx/tx power, if*Octets) are keyed by the same ifIndex,
    and ifDescr carries the "epon0/1:5" ONU port name used for matching.
    """
    community = device.snmp_community or ""
    if not community:
        return {}
    port = device.snmp_port or 161
    ip = device.ip
    try:
        ifnames = {
            int(oid.split(".")[-1]): name
            for oid, name in await snmp_walk(ip, community, "1.3.6.1.2.1.2.2.1.2", port, timeout=OPTICAL_SNMP_TIMEOUT)
        }
    except DriverError:
        ifnames = {}
    try:
        rx_rows = await snmp_walk(ip, community, rx_oid, port, timeout=OPTICAL_SNMP_TIMEOUT)
    except DriverError:
        rx_rows = []
    try:
        tx_rows = await snmp_walk(ip, community, tx_oid, port, timeout=OPTICAL_SNMP_TIMEOUT)
    except DriverError:
        tx_rows = []
    if not ifnames or (not rx_rows and not tx_rows):
        return {}

    rx = {int(oid.split(".")[-1]): d for oid, v in rx_rows if (d := _dbm(v)) is not None}
    tx = {int(oid.split(".")[-1]): d for oid, v in tx_rows if (d := _dbm(v)) is not None}
    in_octets, out_octets = await _snmp_octets(ip, community, port)

    result: dict[str, OpticalSample] = {}
    for ifindex, name in ifnames.items():
        low = name.lower()
        if ("epon" not in low and "gpon" not in low) or ":" not in name:
            continue
        if ifindex in rx or ifindex in tx or ifindex in in_octets:
            result[name.upper().replace(" ", "")] = OpticalSample(
                rx.get(ifindex),
                tx.get(ifindex),
                in_octets.get(ifindex),
                out_octets.get(ifindex),
            )
    return result


async def _snmp_optical_epon(device: OLTDevice) -> dict[str, OpticalSample]:
    return await _snmp_optical(
        device,
        "1.3.6.1.4.1.3320.101.10.10.1.5",  # eponOnuOpticalRxPower (ONU RX)
        "1.3.6.1.4.1.3320.101.10.10.1.6",   # eponOnuOpticalTxPower (ONU TX)
    )


async def _snmp_optical_gpon(device: OLTDevice) -> dict[str, OpticalSample]:
    return await _snmp_optical(device, GPON_ONU_RX_OID, GPON_ONU_TX_OID)


class BdcomCliDriver(BaseDriver):
    def __init__(self, device: OLTDevice):
        self.device = device
        self.method = device.access_method.value
        self.timeout = 15.0
        self._telnet: TelnetClient | None = None
        self._ssh: asyncssh.SSHClientConnection | None = None
        self._reader = None
        self._writer = None
        self.prompt_line: str = ""

    # -------------------------------------------------------------- connect
    async def _read_char(self) -> bytes:
        if self._telnet is not None:
            return await self._telnet.read_byte()
        if self._reader is not None:
            chunk = await self._reader.read(1)
            if not chunk:
                raise TelnetError("SSH session closed by remote host")
            return chunk.encode("utf-8", errors="replace")
        raise DriverError("Not connected")

    async def _sendline(self, data: str) -> None:
        if self._telnet is not None:
            await self._telnet.sendline(data)
        elif self._writer is not None:
            self._writer.write(data + "\r")
            await self._writer.drain()
        else:
            raise DriverError("Not connected")

    async def _expect(self, patterns: list[str], timeout: float | None = None) -> str:
        timeout = timeout or self.timeout
        patterns = [p.decode() if isinstance(p, bytes) else p for p in patterns]
        buf = ""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                c = (await self._read_char()).decode("utf-8", errors="replace")
            except asyncio.TimeoutError:
                continue
            except TelnetError:
                raise
            buf += c
            for pat in patterns:
                if pat in buf:
                    return buf
        raise TelnetError(f"Timeout waiting for {patterns!r}, received: {buf[-200:]!r}")

    @staticmethod
    def _looks_like_prompt(text: str) -> bool:
        for line in reversed(text.splitlines()):
            s = line.strip()
            if s and (s.endswith(">") or s.endswith("#") or s.endswith("$")):
                return True
        return False

    async def _read_until_prompt(self, timeout: float | None = None) -> str:
        timeout = timeout or self.timeout
        buf = ""
        deadline = time.monotonic() + timeout
        prompt = self.prompt_line
        while time.monotonic() < deadline:
            try:
                c = (await self._read_char()).decode("utf-8", errors="replace")
            except asyncio.TimeoutError:
                continue
            except TelnetError:
                break
            buf += c
            lower = buf.lower()
            if "--more--" in lower or "press any key" in lower:
                await self._sendline(" ")
                continue
            if prompt and len(buf) > len(prompt) and buf.endswith(prompt):
                return buf
            if self._looks_like_prompt(buf):
                return buf
        return buf

    def _detect_prompt(self, text: str) -> None:
        for line in reversed(text.splitlines()):
            s = line.strip()
            if s and (s.endswith(">") or s.endswith("#") or s.endswith("$")):
                self.prompt_line = s
                return
        raise TelnetError(f"Could not detect device prompt in: {text[-300:]!r}")

    async def connect(self) -> None:
        try:
            if self.method == "telnet":
                self._telnet = TelnetClient(self.device.ip, self.device.port, self.timeout)
                await self._telnet.connect()
            elif self.method == "both":
                # Try SSH first (port 22), fall back to telnet
                try:
                    self._ssh = await asyncio.wait_for(
                        asyncssh.connect(
                            self.device.ip,
                            port=22,
                            username=self.device.username,
                            password=self.device.password,
                            known_hosts=None,
                            client_keys=None,
                        ),
                        timeout=self.timeout,
                    )
                    self._writer, self._reader, _ = await self._ssh.open_session()
                except (OSError, asyncio.TimeoutError, asyncssh.Error):
                    self._ssh = None
                    self._telnet = TelnetClient(self.device.ip, 23, self.timeout)
                    await self._telnet.connect()
            else:  # ssh
                self._ssh = await asyncio.wait_for(
                    asyncssh.connect(
                        self.device.ip,
                        port=self.device.port,
                        username=self.device.username,
                        password=self.device.password,
                        known_hosts=None,
                        client_keys=None,
                    ),
                    timeout=self.timeout,
                )
                self._writer, self._reader, _ = await self._ssh.open_session()
        except (OSError, asyncio.TimeoutError, asyncssh.Error) as exc:
            raise DriverError(f"Connection to {self.device.ip} failed: {exc}") from exc
        await self._login()

    async def _login(self) -> None:
        try:
            if self._telnet is not None:
                await self._expect(["Username:", "login:"], timeout=10)
                await self._sendline(self.device.username)
                await self._expect(["Password:", "password:"], timeout=10)
                await self._sendline(self.device.password)
            out = await self._expect([">", "#", "$", "Username:", "Password:"], timeout=12)
            if "Username:" in out or "Password:" in out:
                raise DriverError("Login failed (bad username or password)")
            self._detect_prompt(out)
        except TelnetError as exc:
            raise DriverError(f"Login to {self.device.ip} failed: {exc}") from exc

        if self.prompt_line.endswith(">"):
            # BDCOM consoles often require `enable` with no password; always
            # attempt it so show commands are available in privileged mode.
            await self._sendline("enable")
            try:
                out = await self._expect(["Password:", "#", ">"], timeout=8)
            except TelnetError:
                return
            if "Password:" in out:
                await self._sendline(self.device.enable_password or "")
                try:
                    out = await self._expect(["#", ">", "Password:"], timeout=8)
                except TelnetError:
                    return
            try:
                self._detect_prompt(out)
            except TelnetError:
                pass

        for cmd in ("terminal length 0", "terminal paging disable"):
            try:
                await self._exec(cmd, timeout=6)
            except Exception:
                pass

    async def _exec(self, cmd: str, timeout: float | None = None) -> str:
        await self._sendline(cmd)
        out = await self._read_until_prompt(timeout)
        self._detect_prompt(out)
        return out

    def close(self) -> None:
        if self._telnet is not None:
            self._telnet.close()
            self._telnet = None
        if self._ssh is not None:
            try:
                self._ssh.close()
            except Exception:
                pass
            self._ssh = None
        self._reader = None
        self._writer = None

    async def check_onu_realtime(self, pon_port: str, onu_id: int) -> dict:
        """Real-time CLI check: optical power, status, last up time."""
        try:
            await self.connect()
        except DriverError:
            raise
        try:
            pon_type = self.device.pon_type.lower()
            base_port = pon_port.split(":")[0] if ":" in pon_port else pon_port
            pon_num = base_port.replace("EPON", "").replace("GPON", "").replace("epon", "").replace("gpon", "")

            # Optical power
            rx_power = None
            try:
                if pon_type == "gpon":
                    cmd = f"show gpon optical-transceiver-diagnosis interface gpon {pon_num}:{onu_id}"
                else:
                    cmd = f"show epon optical-transceiver-diagnosis interface epon {pon_num}:{onu_id}"
                optical = await self._exec(cmd, timeout=15)
                for line in optical.splitlines():
                    stripped = line.strip()
                    parts = stripped.split()
                    if len(parts) >= 2 and ":" in parts[0]:
                        try:
                            rx_power = float(parts[-1])
                        except ValueError:
                            pass
            except Exception:
                pass

            # Interface status + last up time
            status = None
            last_transition = None
            try:
                if pon_type == "gpon":
                    cmd2 = f"show interface gpon {pon_num}:{onu_id}"
                else:
                    cmd2 = f"show interface epon {pon_num}:{onu_id}"
                iface_out = await self._exec(cmd2, timeout=10)
                for line in iface_out.splitlines():
                    low = line.strip().lower()
                    if "is up" in low or "is down" in low:
                        status = "up" if "is up" in low else "down"
                    if "last transition" in low:
                        idx = low.index("last transition")
                        last_transition = line.strip()[idx + len("last transition"):].strip()
            except Exception:
                pass

            return {
                "ok": True,
                "pon_port": pon_port,
                "onu_id": onu_id,
                "status": status,
                "rx_power": rx_power,
                "last_transition": last_transition,
            }
        except (DriverError, TelnetError) as exc:
            raise DriverError(str(exc)) from exc
        finally:
            self.close()

    # ------------------------------------------------------------ interface
    async def test(self) -> str:
        try:
            await self.connect()
            version = await self._exec("show version", timeout=12)
            self.close()
            return f"Connected. {version.strip().splitlines()[0] if version.strip() else 'OK'}"
        except (DriverError, TelnetError) as exc:
            self.close()
            raise DriverError(str(exc)) from exc

    def _parse_onu_info(self, output: str) -> dict[tuple[str, int], OnuInfo]:
        onus: dict[tuple[str, int], OnuInfo] = {}
        lines = output.splitlines()
        for i, line in enumerate(lines):
            m = _PORT_RE.search(line)
            if not m:
                continue
            pon_prefix = "GPON" if "gpon" in line.lower() else "EPON"
            pon_port = f"{pon_prefix}{m.group(1)}:{m.group(2)}"
            pon_base = f"{pon_prefix}{m.group(1)}"
            onu_id = int(m.group(2))
            info = OnuInfo(pon_port=pon_port, onu_id=onu_id)

            mobj = re.search(r"\b(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}\b", line)
            if mobj:
                info.extra["mac"] = normalize_mac(mobj.group(0))
                info.description = line[mobj.end() :].strip()
            sm = _SN_RE.search(line)
            if sm:
                info.serial = sm.group(1)

            # Status can sit on the same line (GPON) or the continuation
            # line (EPON: "static   auto-configured   N/A"). The dereg reason
            # lives on the same continuation line as the status.
            next_line = lines[i + 1] if i + 1 < len(lines) else ""
            for ln in (line, next_line):
                st = _STATUS_RE.search(ln)
                if st:
                    info.state = st.group(1).lower()
                    break
            dr = _DEREG_RE.search(next_line)
            if dr:
                info.dereg_reason = dr.group(1).lower()
            onus[(pon_base, onu_id)] = info
        return onus

    def _parse_optical(self, output: str) -> dict[tuple[str, int], tuple[float | None, float | None]]:
        result: dict[tuple[str, int], tuple[float | None, float | None]] = {}
        for line in output.splitlines():
            m = _OPTICAL_RE.search(line)
            if not m:
                continue
            pon_base = f"GPON{m.group(1)}" if "gpon" in line.lower() else f"EPON{m.group(1)}"
            onu_id = int(m.group(2))
            rx = _num(m.group(6))
            tx = _num(m.group(7))
            result[(pon_base, onu_id)] = (rx, tx)
        return result

    def _parse_distance(self, output: str) -> dict[tuple[str, int], float]:
        """Parse 'show gpon onu-distance' output. Returns {(pon_base, onu_id): km}."""
        result: dict[tuple[str, int], float] = {}
        for line in output.splitlines():
            m = _PORT_RE.search(line)
            if not m:
                continue
            pon_base = f"GPON{m.group(1)}"
            onu_id = int(m.group(2))
            # Look for distance value like "12.34 km" or "5.6 km"
            dm = re.search(r"(\d+(?:\.\d+)?)\s*(?:km|m)", line, re.I)
            if dm:
                dist = float(dm.group(1))
                # If value looks like meters (>100), convert to km
                if dist > 100:
                    dist = dist / 1000
                result[(pon_base, onu_id)] = round(dist, 2)
        return result

    def _parse_macs(self, output: str) -> list[MacInfo]:
        macs: list[MacInfo] = []
        seen: set[str] = set()
        for line in output.splitlines():
            mac = find_mac(line)
            if not mac or mac in seen:
                continue
            pm = _PORT_RE.search(line)
            if not pm:
                # Only ONU-facing PON ports are subscribers; uplink/core
                # ports (tg0/1, g0/3, ...) are aggregation links.
                continue
            prefix = "GPON" if "gpon" in line.lower() else "EPON"
            port = f"{prefix}{pm.group(1)}:{pm.group(2)}"
            vlan = 0
            vm = re.search(r"(?<!\d)(\d{1,4})(?!\d)", line)
            if vm:
                vlan = int(vm.group(1))
            seen.add(mac)
            macs.append(MacInfo(mac=mac, port=port, vlan=vlan))
        return macs

    async def _snmp_optical(self) -> dict[str, tuple[float | None, float | None]]:
        samples = await _snmp_optical_epon(self.device)
        return {k: (s.rx, s.tx) for k, s in samples.items()}

    async def get_telemetry(self) -> dict[str, OpticalSample]:
        """Lightweight per-ONU optical + byte-counter sample for telemetry."""
        if not self.device.snmp_enabled:
            return {}
        if self.device.pon_type.lower() == "gpon":
            return await _snmp_optical_gpon(self.device)
        return await _snmp_optical_epon(self.device)

    async def get_onus(self) -> list[OnuInfo]:
        try:
            await self.connect()
        except DriverError:
            raise
        try:
            if self.device.pon_type.lower() == "epon":
                output = await self._exec("show epon onu-information", timeout=120)
            else:
                output = await self._exec("show gpon onu-information", timeout=120)
            onus = self._parse_onu_info(output)

            pon_bases = sorted({k[0] for k in onus})
            for pon in pon_bases:
                try:
                    if pon.startswith("GPON"):
                        optical = await self._exec(f"show gpon onu-optical-transceiver-diagnosis interface gpON {pon.replace('GPON', '')}", timeout=12)
                    else:
                        optical = await self._exec(f"show epon optical-transceiver-diagnosis interface epON {pon.replace('EPON', '')}", timeout=12)
                    for (base, onu_id), (rx, tx) in self._parse_optical(optical).items():
                        key = (base, onu_id)
                        if key in onus:
                            onus[key].rx = rx
                            onus[key].tx = tx
                except (TelnetError, DriverError):
                    continue

            # GPON distance
            if self.device.pon_type.lower() != "epon":
                try:
                    dist_out = await self._exec("show gpon onu-distance", timeout=30)
                    for (base, onu_id), dist in self._parse_distance(dist_out).items():
                        key = (base, onu_id)
                        if key in onus:
                            onus[key].extra["distance"] = dist
                except (TelnetError, DriverError):
                    pass

            snmp_optical = await self._snmp_optical() if self.device.snmp_enabled else {}
            if snmp_optical:
                for info in onus.values():
                    key = info.pon_port.upper().replace(" ", "")
                    if key in snmp_optical:
                        info.rx, info.tx = snmp_optical[key]
            return list(onus.values())
        except TelnetError as exc:
            raise DriverError(f"Failed to collect ONUs: {exc}") from exc
        finally:
            self.close()

    async def get_onu_states(self) -> list[OnuInfo]:
        """Fast state-only poll for live down detection.

        Runs just the onu-information command (no per-port optical diagnosis,
        no SNMP) so a live detector can poll every ~30s without the overhead
        of a full scan. State + dereg reason are parsed on the way back.
        """
        try:
            await self.connect()
        except DriverError:
            raise
        try:
            if self.device.pon_type.lower() == "epon":
                output = await self._exec("show epon onu-information", timeout=60)
            else:
                output = await self._exec("show gpon onu-information", timeout=60)
            return list(self._parse_onu_info(output).values())
        except TelnetError as exc:
            raise DriverError(f"Failed to collect ONU states: {exc}") from exc
        finally:
            self.close()

    async def get_port_descriptions(self) -> dict[str, str]:
        """Get PON port descriptions via ``show running-config interface``.

        Returns dict like {"GPON0/1": "TO-CUSTOMER-A", "GPON0/2": ""}.
        """
        try:
            await self.connect()
        except DriverError:
            raise
        try:
            await self._exec("enable", timeout=10)

            # First discover available PON ports from onu-information
            pon_type = self.device.pon_type.lower()
            if pon_type == "epon":
                out = await self._exec("show epon onu-information", timeout=60)
            else:
                out = await self._exec("show gpon onu-information", timeout=60)

            pon_bases: set[str] = set()
            for line in out.splitlines():
                m = re.search(rf"(EPON|GPON)(\d+/\d+)", line, re.IGNORECASE)
                if m:
                    pon_bases.add(f"{m.group(1).upper()}{m.group(2)}")

            descriptions: dict[str, str] = {}
            for pon in sorted(pon_bases):
                try:
                    if pon.startswith("EPON"):
                        raw = pon.replace("EPON", "")
                        cfg = await self._exec(f"show running-config interface epon {raw}", timeout=15)
                    else:
                        raw = pon.replace("GPON", "")
                        cfg = await self._exec(f"show running-config interface gpon {raw}", timeout=15)

                    for line in cfg.splitlines():
                        line = line.strip()
                        if line.lower().startswith("description "):
                            descriptions[pon] = line[12:].strip().strip('"')
                            break
                    else:
                        descriptions[pon] = ""
                except (TelnetError, DriverError):
                    descriptions[pon] = ""

            return descriptions
        except TelnetError as exc:
            raise DriverError(f"Failed to collect port descriptions: {exc}") from exc
        finally:
            self.close()

    async def get_macs(self) -> list[MacInfo]:
        try:
            await self.connect()
        except DriverError:
            raise
        try:
            for cmd in ("show mac address-table", "show mac-address-table dynamic"):
                try:
                    output = await self._exec(cmd, timeout=20)
                except TelnetError:
                    continue
                macs = self._parse_macs(output)
                if macs:
                    return macs
            return []
        finally:
            self.close()

    async def get_rejected_onus(self) -> list[dict]:
        """Discover currently rejected/unauthorized ONUs in real-time from the OLT.

        EPON: show epon rejected-onu
        GPON: show gpon onu-rejected

        Returns:
            List of dicts with keys: pon_port, onu_id, serial, reason, raw_line, description.
        """
        try:
            await self.connect()
        except DriverError:
            raise

        try:
            pon_type = self.device.pon_type.lower()
            if pon_type == "epon":
                cmd = "show epon rejected-onu"
            else:
                cmd = "show gpon onu-rejected"
            output = await self._exec(cmd, timeout=30)
            return self._parse_rejected_output(output, pon_type)
        except TelnetError as exc:
            raise DriverError(f"Failed to discover rejected ONUs: {exc}") from exc
        finally:
            self.close()

    def _parse_rejected_output(self, output: str, pon_type: str) -> list[dict]:
        """Parse output from 'show epon rejected-onu' / 'show gpon onu-rejected'.

        GPON format:
            ONU rejected to register on the olt
            NO.         Serial Number        Interface
            -------------------------------------------------
            1         HWTC:9E6DD9D4        GPON0/2

        EPON format:
            ONU rejected to register on interface EPON0/1:
            INDEX MAC Address    Reject Time         LOID                     PASSWORD
            ----- -------------- ------------------- ------------------------ ------------
            1     9845.629f.039d 2026-08-24 10:37:53 (N/A)                    (N/A)
        """
        rejected = []
        lines = output.splitlines()

        # Detect interface from header line (EPON format)
        interface_from_header = None
        for line in lines:
            hdr = re.match(r"ONU rejected to register on interface\s+(EPON\S+):", line, re.IGNORECASE)
            if hdr:
                interface_from_header = hdr.group(1)
                break

        for line in lines:
            stripped = line.strip()
            if not stripped or stripped.startswith("NO.") or stripped.startswith("IntfName") or stripped.startswith("INDEX") or stripped.startswith("-") or stripped.startswith("ONU rejected") or "No rejected" in stripped.lower():
                continue

            # EPON format: "1     9845.629f.039d 2026-08-24 10:37:53 (N/A)                    (N/A)"
            epon_match = re.match(r"\d+\s+([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})\s+\d{4}-\d{2}-\d{2}", stripped, re.IGNORECASE)
            if epon_match:
                mac = epon_match.group(1)
                pon_port = interface_from_header or "EPON0/?:?"
                rejected.append({
                    "pon_port": pon_port,
                    "onu_id": 0,
                    "serial": mac,
                    "reason": "auth-fail",
                    "raw_line": stripped,
                    "description": "",
                })
                continue

            # GPON format: "1    HWTC:9E6DD9D4    GPON0/2"
            gpon_match = re.match(r"\d+\s+(\S+)\s+(GPON\S+)", stripped)
            if gpon_match:
                serial = gpon_match.group(1)
                interface = gpon_match.group(2)
                m = _PON_RE.search(interface)
                if m:
                    pon_port = f"GPON{m.group(1)}"
                    rejected.append({
                        "pon_port": pon_port,
                        "onu_id": 0,
                        "serial": serial,
                        "reason": "auth-fail",
                        "raw_line": stripped,
                        "description": "",
                    })
                continue

            # Fallback: try to find MAC/serial and interface
            m = _PON_RE.search(stripped)
            if m:
                prefix = "GPON" if "gpon" in pon_type else "EPON"
                pon_port = f"{prefix}{m.group(1)}"
                mac_match = re.search(r"([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4})", stripped, re.IGNORECASE)
                serial_match = re.search(r"([A-Z0-9:]{8,})", stripped)
                serial = serial_match.group(1) if serial_match else (mac_match.group(1) if mac_match else "")
                rejected.append({
                    "pon_port": pon_port,
                    "onu_id": 0,
                    "serial": serial,
                    "reason": "auth-fail",
                    "raw_line": stripped,
                    "description": "",
                })
        return rejected

    def _parse_log_rejected(self, output: str, pon_type: str) -> list[dict]:
        """Parse OLT log lines for rejected ONU entries."""
        rejected = []
        for line in output.splitlines():
            if "reject" not in line.lower() and "auth-fail" not in line.lower():
                continue
            m = _PORT_RE.search(line)
            if not m:
                continue
            prefix = "GPON" if "gpon" in line.lower() else "EPON"
            pon_port = f"{prefix}{m.group(1)}:{m.group(2)}"
            onu_id = int(m.group(2))
            sn_match = re.search(r"\b([A-F0-9]{8,16})\b", line, re.IGNORECASE)
            serial = sn_match.group(1) if sn_match else ""
            rejected.append({
                "pon_port": pon_port,
                "onu_id": onu_id,
                "serial": serial,
                "reason": "auth-fail",
                "raw_line": line.strip(),
            })
        return rejected

    async def authorize_onu(self, pon_port: str, onu_id: int, serial: str) -> str:
        """Authorize/add a rejected ONU on the OLT.

        This registers the ONU on the specified PON port with the given serial.
        """
        m = _PORT_RE.search(pon_port)
        if not m:
            raise DriverError(f"Invalid PON port format: {pon_port}")
        pon_base = m.group(1)
        pon_type = "gpon" if "gpon" in pon_port.lower() else "epon"

        try:
            await self.connect()
        except DriverError:
            raise

        try:
            # Enter PON interface
            await self._exec(f"interface {pon_type} {pon_base}", timeout=10)
            # Register/add the ONU
            await self._exec(f"onu {onu_id} sn {serial}", timeout=10)
            # Try to authorize
            try:
                await self._exec(f"onu {onu_id} auth", timeout=10)
            except Exception:
                pass
            # Exit interface context
            await self._exec("exit", timeout=5)
            return f"ONU {onu_id} ({serial}) authorized on {pon_port}"
        except TelnetError as exc:
            raise DriverError(f"Failed to authorize ONU: {exc}") from exc
        finally:
            self.close()

    async def set_onu_eth_port(self, pon_port: str, onu_id: int, port_id: int, enable: bool) -> str:
        """Enable or disable an ONU Ethernet/UNI port via CLI.

        Args:
            pon_port: Full PON port string like "GPON0/1:5" or "EPON0/1:3".
            onu_id: ONU ID on the PON port.
            port_id: UNI Ethernet port number (1-based, usually 1).
            enable: True to enable, False to disable.

        Returns:
            A human-readable success message.
        """
        m = _PORT_RE.search(pon_port)
        if not m:
            raise DriverError(f"Invalid PON port format: {pon_port}")
        pon_base = m.group(1)  # e.g. "0/1"
        pon_type = "gpon" if "gpon" in pon_port.lower() else "epon"

        try:
            await self.connect()
        except DriverError:
            raise

        try:
            # Enter config mode and interface
            await self._exec("enable", timeout=10)
            await self._exec("config", timeout=10)
            await self._exec(f"interface {pon_type} {pon_base}:{onu_id}", timeout=10)

            if pon_type == "epon":
                if enable:
                    await self._exec(f"no epon onu port {port_id} ctc shutdown", timeout=10)
                else:
                    await self._exec(f"epon onu port {port_id} ctc shutdown", timeout=10)
            else:
                if enable:
                    await self._exec(f"gpon onu uni {port_id} noshutdown", timeout=10)
                else:
                    await self._exec(f"gpon onu uni {port_id} shutdown", timeout=10)

            # Exit interface
            await self._exec("exit", timeout=5)
            await self._exec("exit", timeout=5)

            state = "enabled" if enable else "disabled"
            return f"ONU Ethernet port {port_id} {state} on {pon_port}"
        except TelnetError as exc:
            raise DriverError(f"Failed to set ONU port state: {exc}") from exc
        finally:
            self.close()

    async def delete_onu(self, pon_port: str, onu_id: int) -> str:
        """Delete/deregister an ONU from the OLT.

        EPON: no epon bind-onu sequence X
        GPON: no gpon bind-onu sequence X
        """
        m = _PORT_RE.search(pon_port) or _PON_RE.search(pon_port)
        if not m:
            raise DriverError(f"Invalid PON port format: {pon_port}")
        pon_base = m.group(1)
        pon_type = "gpon" if "gpon" in pon_port.lower() else "epon"

        try:
            await self.connect()
        except DriverError:
            raise

        try:
            await self._exec("enable", timeout=10)
            await self._exec("config", timeout=10)
            await self._exec(f"interface {pon_type} {pon_base}", timeout=10)
            await self._exec(f"no {pon_type} bind-onu sequence {onu_id}", timeout=10)
            await self._exec("exit", timeout=5)
            await self._exec("exit", timeout=5)
            return f"ONU {onu_id} deleted from {pon_port}"
        except TelnetError as exc:
            raise DriverError(f"Failed to delete ONU: {exc}") from exc
        finally:
            self.close()

    async def add_onu(self, pon_port: str, identifier: str, description: str = "", sequence: int | None = None) -> dict:
        """Add/register an ONU on the OLT.

        EPON: epon bind-onu mac XX.XX.XX.XX.XX.XX [sequence]
        GPON: gpon bind-onu sn VENDOR:SERIAL [sequence]

        Args:
            pon_port: PON port string like "EPON0/3" or "GPON0/2" (without :onu_id).
            identifier: MAC for EPON (XX.XX.XX.XX.XX.XX), SN for GPON (VENDOR:SERIAL).
            description: Optional description (no spaces, use _).
            sequence: Optional sequence number. If None, OLT auto-assigns next available.

        Returns:
            dict with pon_port (with sequence), onu_id (sequence number), message.
        """
        m = _PON_RE.search(pon_port)
        if not m:
            raise DriverError(f"Invalid PON port format: {pon_port}")
        pon_base = m.group(1)
        pon_type = "gpon" if "gpon" in pon_port.lower() else "epon"
        id_type = "sn" if pon_type == "gpon" else "mac"

        try:
            await self.connect()
        except DriverError:
            raise

        try:
            await self._exec("enable", timeout=10)
            await self._exec("config", timeout=10)
            await self._exec(f"interface {pon_type} {pon_base}", timeout=10)
            seq_part = f" {sequence}" if sequence else ""
            await self._exec(f"{pon_type} bind-onu {id_type} {identifier}{seq_part}", timeout=10)
            await self._exec("exit", timeout=5)
            await self._exec("exit", timeout=5)

            # Query the OLT to find the actual assigned sequence
            out = await self._exec(f"show {pon_type} onu-information interface {pon_type} {pon_base}", timeout=30)
            onu_id = 0
            for line in out.splitlines():
                if identifier in line:
                    seq_match = re.search(rf"{pon_base}:(\d+)", line)
                    if seq_match:
                        onu_id = int(seq_match.group(1))
                        break

            full_port = f"{pon_type.upper()}{pon_base}:{onu_id}"

            # Set description on OLT if provided
            if description and onu_id > 0:
                try:
                    await self._exec("enable", timeout=10)
                    await self._exec("config", timeout=10)
                    await self._exec(f"interface {pon_type} {pon_base}:{onu_id}", timeout=10)
                    await self._exec(f"description {description[:32]}", timeout=10)
                    await self._exec("exit", timeout=5)
                    await self._exec("exit", timeout=5)
                except Exception:
                    pass  # Description set is best-effort

            return {
                "pon_port": full_port,
                "onu_id": onu_id,
                "message": f"ONU {identifier} added on {full_port}",
            }
        except TelnetError as exc:
            raise DriverError(f"Failed to add ONU: {exc}") from exc
        finally:
            self.close()

    async def set_onu_description(self, pon_port: str, onu_id: int, description: str) -> str:
        """Set ONU description on the OLT.

        EPON: description <string> (inside interface epon 0/X:Y)
        GPON: description <string> (inside interface gpon 0/X:Y)
        Max 32 chars. No spaces, /, ;, : allowed.
        """
        m = _PORT_RE.search(pon_port)
        if not m:
            raise DriverError(f"Invalid PON port format: {pon_port}")
        pon_base = m.group(1)
        pon_type = "gpon" if "gpon" in pon_port.lower() else "epon"
        description = description[:32]

        try:
            await self.connect()
        except DriverError:
            raise

        try:
            await self._exec("enable", timeout=10)
            await self._exec("config", timeout=10)
            await self._exec(f"interface {pon_type} {pon_base}:{onu_id}", timeout=10)
            await self._exec(f"description {description}", timeout=10)
            await self._exec("exit", timeout=5)
            await self._exec("exit", timeout=5)
            return f"Description set to {description} on {pon_port}"
        except TelnetError as exc:
            raise DriverError(f"Failed to set description: {exc}") from exc
        finally:
            self.close()

    async def set_bandwidth(self, pon_port: str, onu_id: int, mode: str) -> str:
        """Set EPON ONU bandwidth (SLA) via CLI.

        EPON only:
            100m: epon sla upstream pir 100000 cir 1000 / downstream pir 100000 cir 1000
            1g:   epon sla upstream pir 1000000 cir 10000 / downstream pir 1000000 cir 10000

        Args:
            pon_port: Full PON port string like "EPON0/1:3".
            onu_id: ONU ID on the PON port.
            mode: "100m" or "1g".

        Returns:
            A human-readable success message.
        """
        m = _PORT_RE.search(pon_port)
        if not m:
            raise DriverError(f"Invalid PON port format: {pon_port}")
        pon_base = m.group(1)
        pon_type = "gpon" if "gpon" in pon_port.lower() else "epon"

        if pon_type != "epon":
            raise DriverError("Bandwidth (SLA) setting is only supported for EPON ONUs")

        if mode == "1g":
            pir, cir = 1000000, 100000
            label = "1 Gbps"
        elif mode == "100m":
            pir, cir = 100000, 100000
            label = "100 Mbps"
        else:
            raise DriverError(f"Invalid bandwidth mode: {mode} (expected '100m' or '1g')")

        try:
            await self.connect()
        except DriverError:
            raise

        try:
            await self._exec("enable", timeout=10)
            await self._exec("config", timeout=10)
            await self._exec(f"interface epon {pon_base}:{onu_id}", timeout=10)
            await self._exec(f"epon sla upstream pir {pir} cir {cir}", timeout=10)
            await self._exec(f"epon sla downstream pir {pir} cir {cir}", timeout=10)
            await self._exec("exit", timeout=5)
            await self._exec("exit", timeout=5)
            return f"Bandwidth set to {label} on {pon_port}"
        except TelnetError as exc:
            raise DriverError(f"Failed to set bandwidth: {exc}") from exc
        finally:
            self.close()


class BdcomSnmpDriver(BaseDriver):
    """SNMP-only collector for BDCOM GPON OLTs."""

    def __init__(self, device: OLTDevice):
        self.device = device

    @property
    def _target(self) -> tuple[str, str, int]:
        return (self.device.ip, self.device.snmp_community, self.device.snmp_port)

    async def test(self) -> str:
        host, community, port = self._target
        try:
            results = await snmp_walk(host, community, GPON_ONU_STATUS_OID, port)
            return f"SNMP OK ({len(results)} ONUs)"
        except DriverError as exc:
            raise DriverError(f"SNMP test failed: {exc}") from exc

    async def get_onus(self) -> list[OnuInfo]:
        host, community, port = self._target
        status_rows = await snmp_walk(host, community, GPON_ONU_STATUS_OID, port)
        rx_rows = await snmp_walk(host, community, GPON_ONU_RX_OID, port)
        tx_rows = await snmp_walk(host, community, GPON_ONU_TX_OID, port)

        def _index(oid: str) -> tuple[int, int]:
            parts = oid.split(".")
            tail = [int(p) for p in parts[-4:]] if len(parts) >= 4 else []
            if len(tail) == 4:
                return (tail[2], tail[3])  # (pon port, onu id)
            return (0, 0)

        status: dict[tuple[int, int], str] = {}
        for oid, value in status_rows:
            port_no, onu_id = _index(oid)
            status[(port_no, onu_id)] = ONU_STATUS_MAP.get(value, "unknown")

        rx_power = {(_index(oid)[1]): _num(v) for oid, v in rx_rows}
        tx_power = {(_index(oid)[1]): _num(v) for oid, v in tx_rows}

        onus: list[OnuInfo] = []
        for (port_no, onu_id), state in status.items():
            # DBm units are 0.1 dBm in this MIB
            rx = rx_power.get(onu_id)
            tx = tx_power.get(onu_id)
            if rx is not None:
                rx = rx / 10.0
            if tx is not None:
                tx = tx / 10.0
            onus.append(
                OnuInfo(
                    pon_port=f"GPON0/{port_no}:{onu_id}",
                    onu_id=onu_id,
                    state=state,
                    rx=rx,
                    tx=tx,
                )
            )
        return onus

    async def get_macs(self) -> list[MacInfo]:
        # Not reliably exposed for all firmware versions; collector falls back
        # to an empty list and the CLI path is preferred anyway.
        return []

    async def get_telemetry(self) -> dict[str, OpticalSample]:
        if self.device.pon_type.lower() == "gpon":
            return await _snmp_optical_gpon(self.device)
        return await _snmp_optical_epon(self.device)


def build_driver(device: OLTDevice) -> BaseDriver:
    return BdcomCliDriver(device)