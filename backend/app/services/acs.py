"""TR-069 / CWMP ACS server (lightweight).

Implements the subset of the TR-069 protocol needed to manage home routers:

  * Inform       - device registers and reports its parameter tree
  * GetRPC       - empty POST asking the server for the next RPC
  * GetParameterValues / GetParameterValuesResponse
  * SetParameterValues (wifi password change, WAN config push)
  * Download      (firmware update)
  * Reboot

SOAP envelopes are parsed with ElementTree (namespace-agnostic). Device state,
parameters, metrics and queued jobs are persisted so the frontend can monitor
resources / traffic and push configs.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import AcsDevice, AcsJob, AcsMetric, AcsParameter, Onu
from ..utils.time import utcnow

logger = logging.getLogger("olt_commander.acs")

CWMP_NS = "urn:dslforum-org:cwmp-1-0"
SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/"

# Broad set of parameter names polled on GetRPC so most routers reply with at
# least a subset (vendors use different prefixes for CPU/mem/traffic).
_MONITOR_PARAMS = [
    # CPU
    "InternetGatewayDevice.DeviceInfo.CPUUsage",
    "InternetGatewayDevice.DeviceInfo.X_TP-LINK_CPUUsage",
    "InternetGatewayDevice.DeviceInfo.X_ASB_COM_CPUUsage",
    # Memory
    "InternetGatewayDevice.DeviceInfo.MemoryStatus.Total",
    "InternetGatewayDevice.DeviceInfo.MemoryStatus.Used",
    "InternetGatewayDevice.DeviceInfo.X_TP-LINK_MemUsage",
    "InternetGatewayDevice.DeviceInfo.X_ASB_COM_MemTotal",
    "InternetGatewayDevice.DeviceInfo.X_ASB_COM_MemUsed",
    # WAN Traffic - IP Connection
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_TP-LINK_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_ASB_COM_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.X_ASB_COM_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress",
    # WAN Traffic - PPP Connection
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.X_TP-LINK_TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.TotalBytesReceived",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.TotalBytesSent",
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1.MACAddress",
    # WiFi parameters (instances 1-3)
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Enable",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.Passphrase",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Channel",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.Standard",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BasicEncryptionModes",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.BeaconType",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.OperatingStandard",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Enable",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.PreSharedKey.1.Passphrase",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Channel",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Standard",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.BasicEncryptionModes",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.BeaconType",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.OperatingStandard",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.Enable",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.SSID",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.PreSharedKey.1.Passphrase",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.Channel",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.Standard",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.BasicEncryptionModes",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.BeaconType",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.OperatingStandard",
    # WiFi Radio stats (vendor specific)
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.X_TP-LINK_TotalBytesSent",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.X_TP-LINK_TotalBytesSent",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_BROADCOM_COM_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_BROADCOM_COM_TotalBytesSent",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_TP-LINK_TotalBytesReceived",
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.3.X_TP-LINK_TotalBytesSent",
    # Device Summary
    "InternetGatewayDevice.DeviceSummary",
]

# TR-069 device status values used for Inform events.
_EVENT_BOOT = "0 BOOTSTRAP"
_EVENT_PERIODIC = "2 PERIODIC"
_EVENT_CONNECTION = "6 CONNECTION REQUEST"
_EVENT_VALUE_CHANGE = "8 VALUE CHANGE"

_ONLINE_WINDOW_SECONDS = 600  # mark offline when no Inform for 10 minutes


def _localname(tag: str) -> str:
    return tag.split("}", 1)[-1]


def _strip_ns(root: ET.Element) -> None:
    for el in root.iter():
        el.tag = _localname(el.tag)


def _text(el: ET.Element | None) -> str:
    return (el.text or "").strip() if el is not None else ""


# --------------------------------------------------------------------------
# XML builders
# --------------------------------------------------------------------------

def _soap_header(soap_id: str) -> str:
    # TR-069 1.0 CPEs (BDCOM/Tenda) are strict: they expect a plain SOAP id and
    # reject xsi:type attributes / urn:uuid prefixes with "Parse xml string failed".
    return (
        '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" '
        f'xmlns:cwmp="{CWMP_NS}">'
        f'<SOAP-ENV:Header><cwmp:ID SOAP-ENV:mustUnderstand="1">{soap_id}</cwmp:ID></SOAP-ENV:Header>'
        "<SOAP-ENV:Body>"
    )


def _soap_footer() -> str:
    return "</SOAP-ENV:Body></SOAP-ENV:Envelope>"


def inform_response(soap_id: str, max_envelopes: int = 1) -> str:
    return (
        _soap_header(soap_id)
        + f"<cwmp:InformResponse><MaxEnvelopes>{max_envelopes}</MaxEnvelopes></cwmp:InformResponse>"
        + _soap_footer()
    )


def get_parameter_values(soap_id: str, names: list[str]) -> str:
    body = "".join(f"<string>{n}</string>" for n in names)
    return (
        _soap_header(soap_id)
        + f"<cwmp:GetParameterValues><ParameterNames>{body}</ParameterNames></cwmp:GetParameterValues>"
        + _soap_footer()
    )


def set_parameter_values(soap_id: str, params: list[tuple[str, str, str]]) -> str:
    """SetParameterValues RPC (TR-069 1.0 friendly - no xsi:type).

    params = [(name, value, type)]; type is used only to normalize boolean
    values to true/false, which basic CPEs require.
    """
    structs = ""
    for name, value, typ in params:
        if typ == "boolean":
            value = "true" if value in ("1", "true") else "false"
        structs += f"<ParameterValueStruct><Name>{name}</Name><Value>{value}</Value></ParameterValueStruct>"
    return (
        _soap_header(soap_id)
        + f"<cwmp:SetParameterValues><ParameterList>{structs}</ParameterList></cwmp:SetParameterValues>"
        + _soap_footer()
    )


def download(soap_id: str, command_key: str, url: str, file_type: str = "1 Firmware Upgrade Image") -> str:
    return (
        _soap_header(soap_id)
        + (
            "<cwmp:Download>"
            f"<CommandKey>{command_key}</CommandKey>"
            f"<FileType>{file_type}</FileType>"
            f"<URL>{url}</URL>"
            "<Username></Username><Password></Password>"
            "<FileSize>0</FileSize><TargetFileName></TargetFileName><DelaySeconds>0</DelaySeconds>"
            "</cwmp:Download>"
        )
        + _soap_footer()
    )


def reboot(soap_id: str, command_key: str) -> str:
    return (
        _soap_header(soap_id)
        + f"<cwmp:Reboot><CommandKey>{command_key}</CommandKey></cwmp:Reboot>"
        + _soap_footer()
    )


# --------------------------------------------------------------------------
# Param extraction helpers
# --------------------------------------------------------------------------

def _num(value: str) -> float | None:
    try:
        v = value.strip()
        if not v or v.lower() in ("unknown", "nan"):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _find_param(params: dict[str, str], *substrings: str) -> str:
    low = {k.lower(): v for k, v in params.items()}
    for key, value in low.items():
        if all(s in key for s in substrings):
            return value
    return ""


_MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$")


def build_wifi_status(rows: list[AcsParameter]):
    """Build a wifi status (bands + enable) from WLANConfiguration params.

    Accepts any iterable of objects with `.name` and `.value` (AcsParameter
    rows). Returns a dict compatible with AcsWifiStatusOut.
    """
    from ..schemas import AcsWifiBandOut, AcsWifiStatusOut

    by_instance: dict[int, dict[str, str]] = {}
    for p in rows:
        parts = p.name.split(".")
        instance = None
        wlan_idx = -1
        for idx, part in enumerate(parts):
            part_lower = part.lower()
            if part_lower == "wlanconfiguration" and idx + 1 < len(parts):
                try:
                    instance = int(parts[idx + 1])
                    wlan_idx = idx
                    break
                except ValueError:
                    pass
            elif part_lower.startswith("wlanconfiguration") and len(part_lower) > len("wlanconfiguration"):
                try:
                    instance = int(part_lower.replace("wlanconfiguration", ""))
                    wlan_idx = idx
                    break
                except ValueError:
                    pass
        if instance is None:
            continue
        if wlan_idx >= 0 and wlan_idx + 2 < len(parts):
            key = ".".join(parts[wlan_idx + 2:]).lower()
        else:
            continue
        by_instance.setdefault(instance, {})[key] = p.value

    bands: list[AcsWifiBandOut] = []
    for instance in sorted(by_instance):
        data = by_instance[instance]
        ssid = data.get("ssid", "")
        passphrase = (
            data.get("presharedkey.1.passphrase")
            or data.get("presharedkey.2.passphrase")
            or data.get("wepkey", "")
            or ""
        )
        enable_raw = data.get("enable", "")
        enable = None
        if enable_raw.lower() in ("1", "true", "up", "yes"):
            enable = True
        elif enable_raw.lower() in ("0", "false", "down", "no"):
            enable = False
        band = ""
        joined = " ".join(f"{k}={v}" for k, v in data.items())
        low = joined.lower()
        if ("5g" in low or "5ghz" in low or "802.11a" in low or "802.11ac" in low or "802.11ax" in low) and "2.4" not in low:
            band = "5g"
        elif "2.4" in low or "802.11b" in low or "802.11g" in low or "802.11n" in low:
            band = "2.4g"
        else:
            band = {1: "2.4g", 2: "5g", 3: "5g2"}.get(instance, "")
        bands.append(
            AcsWifiBandOut(
                instance=instance,
                band=band,
                ssid=ssid,
                passphrase=passphrase,
                enable=enable,
                channel=data.get("channel", ""),
                standard=data.get("standard", "") or data.get("operatingstandard", ""),
                security_mode=data.get("beacontype", "") or data.get("basicencryptionmodes", ""),
            )
        )
    return AcsWifiStatusOut(supported=True, bands=bands)


def _mac_of(params: dict[str, str]) -> str:
    for key, value in params.items():
        low = key.lower()
        if "macaddress" in low or low.endswith("mac"):
            v = value.strip().lower()
            if _MAC_RE.match(v):
                return v
    return ""


# --------------------------------------------------------------------------
# Inform handling
# --------------------------------------------------------------------------

async def _upsert_device(session: AsyncSession, dev_id: dict, params: dict[str, str], ip: str) -> AcsDevice:
    serial = dev_id.get("serial_number", "")
    if not serial:
        serial = params.get("InternetGatewayDevice.DeviceInfo.SerialNumber", "") or uuid.uuid4().hex[:12]
    res = await session.execute(select(AcsDevice).where(AcsDevice.serial_number == serial))
    device = res.scalar_one_or_none()
    if device is None:
        device = AcsDevice(serial_number=serial)
        session.add(device)
    device.manufacturer = dev_id.get("manufacturer") or device.manufacturer
    device.oui = dev_id.get("oui") or device.oui
    device.product_class = dev_id.get("product_class") or device.product_class
    device.model_name = params.get("InternetGatewayDevice.DeviceInfo.ModelName", "") or device.model_name
    device.hardware_version = params.get("InternetGatewayDevice.DeviceInfo.HardwareVersion", "") or device.hardware_version
    device.software_version = params.get("InternetGatewayDevice.DeviceInfo.SoftwareVersion", "") or device.software_version
    device.ip = ip or device.ip
    mac = _mac_of(params)
    if mac:
        device.mac = mac

    # Auto-link to the subscriber's ONU. The router's PPPoE IP (the Inform
    # source) matches Onu.mikrotik_ip, and its WAN MAC matches Onu.last_mac;
    # either match links the ACS device to the subscriber.
    if device.onu_id is None:
        onu = None
        if device.ip:
            onu = (
                await session.execute(
                    select(Onu)
                    .where(Onu.mikrotik_ip == device.ip)
                    .order_by(Onu.last_seen.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
        if onu is None and mac:
            onu = (
                await session.execute(
                    select(Onu).where(Onu.last_mac == mac).order_by(Onu.last_seen.desc()).limit(1)
                )
            ).scalar_one_or_none()
        if onu is not None:
            device.onu_id = onu.id
            if onu.subscriber:
                device.subscriber = onu.subscriber

    device.online = True
    device.last_inform = utcnow()
    return device


async def _store_params(session: AsyncSession, device: AcsDevice, params: dict[str, str]) -> None:
    existing = (
        await session.execute(select(AcsParameter).where(AcsParameter.device_id == device.id))
    ).scalars().all()
    by_name = {p.name: p for p in existing}
    now = utcnow()
    for name, value in params.items():
        if name in by_name:
            row = by_name[name]
            if row.value != value:
                row.value = value
                row.updated_at = now
        else:
            session.add(AcsParameter(device_id=device.id, name=name, value=value, updated_at=now))


async def _sample_metrics(session: AsyncSession, device: AcsDevice, params: dict[str, str]) -> None:
    """Compute resource + traffic sample; derive transfer rates from byte deltas."""
    now = utcnow()
    cpu = _num(_find_param(params, "cpu", "usage")) or _num(_find_param(params, "cpu", "load")) or _num(
        params.get("InternetGatewayDevice.DeviceInfo.CPUUsage", "")
    )
    mem_total = _num(_find_param(params, "memory", "total"))
    mem_used = _num(_find_param(params, "memory", "used"))
    rx_bytes = _num(_find_param(params, "totalbytes", "received")) or _num(_find_param(params, "rx", "bytes"))
    tx_bytes = _num(_find_param(params, "totalbytes", "sent")) or _num(_find_param(params, "tx", "bytes"))

    dt = 0.0
    if device.last_inform:
        dt = (now - device.last_inform).total_seconds()
    rx_rate = tx_rate = None
    if rx_bytes is not None and device.last_rx_bytes is not None and dt > 0:
        rx_rate = max((rx_bytes - device.last_rx_bytes) * 8 / dt, 0)
    if tx_bytes is not None and device.last_tx_bytes is not None and dt > 0:
        tx_rate = max((tx_bytes - device.last_tx_bytes) * 8 / dt, 0)

    if cpu is None and mem_total is None and mem_used is None and rx_bytes is None and tx_bytes is None:
        return  # no telemetry params exposed by this CPE

    session.add(
        AcsMetric(
            device_id=device.id,
            sampled_at=now,
            cpu=cpu,
            mem_used=mem_used,
            mem_total=mem_total,
            rx_bytes=rx_bytes,
            tx_bytes=tx_bytes,
            rx_rate=rx_rate,
            tx_rate=tx_rate,
        )
    )
    device.last_cpu = cpu if cpu is not None else device.last_cpu
    device.last_mem_used = mem_used if mem_used is not None else device.last_mem_used
    device.last_mem_total = mem_total if mem_total is not None else device.last_mem_total
    device.last_rx_bytes = rx_bytes if rx_bytes is not None else device.last_rx_bytes
    device.last_tx_bytes = tx_bytes if tx_bytes is not None else device.last_tx_bytes
    device.last_rx_rate = rx_rate
    device.last_tx_rate = tx_rate


# --------------------------------------------------------------------------
# Job dispatch
# --------------------------------------------------------------------------

async def _should_poll_monitoring(session: AsyncSession, device: AcsDevice) -> bool:
    """Check if device supports monitoring parameters to avoid Fault 9814."""
    count = (
        await session.execute(
            select(func.count(AcsParameter.id)).where(
                AcsParameter.device_id == device.id,
                AcsParameter.name.like("InternetGatewayDevice.WANDevice.%TotalBytesReceived%")
                | AcsParameter.name.like("InternetGatewayDevice.WANDevice.%TotalBytesSent%")
                | AcsParameter.name.like("InternetGatewayDevice.LANDevice.1.WLANConfiguration.%")
                | AcsParameter.name.like("InternetGatewayDevice.DeviceInfo.CPUUsage%")
                | AcsParameter.name.like("InternetGatewayDevice.DeviceInfo.MemoryStatus.%")
            )
        )
    ).scalar() or 0
    return count > 0


async def _next_job(session: AsyncSession, device: AcsDevice) -> AcsJob | None:
    res = await session.execute(
        select(AcsJob)
        .where(AcsJob.device_id == device.id, AcsJob.status == "queued")
        .order_by(AcsJob.created_at)
        .limit(1)
    )
    return res.scalar_one_or_none()


async def _job_capability_check(session: AsyncSession, device: AcsDevice, job: AcsJob) -> str:
    """Return a fail-fast reason if the device's TR-069 model cannot serve the job.

    Basic CPEs report a DeviceSummary (e.g. "Baseline:1,EthernetLAN:1") with no
    WiFi object; sending them WLANConfiguration SetParameterValues triggers
    Fault 9814. If the device has ever reported parameters under the required
    root path, allow it; otherwise fail the job immediately with a clear reason.
    """
    path_prefix = ""
    if job.action == "wifi":
        path_prefix = "InternetGatewayDevice.LANDevice.1.WLANConfiguration"
    elif job.action == "wan":
        path_prefix = "InternetGatewayDevice.WANDevice.1.WANConnectionDevice"
    if not path_prefix:
        return ""

    count = (
        await session.execute(
            select(func.count(AcsParameter.id)).where(
                AcsParameter.device_id == device.id,
                AcsParameter.name.like(f"{path_prefix}.%"),
            )
        )
    ).scalar() or 0
    if count > 0:
        return ""

    summary = (await session.execute(
        select(AcsParameter).where(
            AcsParameter.device_id == device.id,
            AcsParameter.name == "InternetGatewayDevice.DeviceSummary",
        )
    )).scalar_one_or_none()
    hint = f" (DeviceSummary: {summary.value})" if summary and summary.value else ""
    return (
        f"Device TR-069 model does not expose {path_prefix} "
        f"parameters{hint} — router cannot apply this config via ACS"
    )


async def _fail_sent_job(session: AsyncSession, ip: str, result: str) -> None:
    """Mark the most recent 'sent' job for a device as failed."""
    device = (
        await session.execute(
            select(AcsDevice).where(AcsDevice.ip == ip).order_by(AcsDevice.last_inform.desc()).limit(1)
        )
    ).scalar_one_or_none()
    if device is None:
        return
    job = (
        await session.execute(
            select(AcsJob)
            .where(AcsJob.device_id == device.id, AcsJob.status == "sent")
            .order_by(AcsJob.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if job is not None:
        job.status = "failed"
        job.result = result
        job.finished_at = utcnow()
        await session.commit()


def _job_rpc(job: AcsJob) -> str | None:
    """Build the RPC to send for a job. Returns None for jobs needing a poll first."""
    try:
        payload = json.loads(job.payload or "{}")
    except json.JSONDecodeError:
        payload = {}
    if job.action == "wifi":
        params = []
        ssid = payload.get("ssid")
        passphrase = payload.get("passphrase")
        enable = payload.get("enable")
        band = str(payload.get("band") or "2.4g").lower()
        # WLANConfiguration.1 = 2.4GHz, .2 = 5GHz (primary), .3 = second 5GHz.
        band_instances = {
            "2.4g": [1],
            "5g": [2],
            "5g2": [3],
            "all": [1, 2, 3],
        }.get(band, [1])
        for instance in band_instances:
            base = f"InternetGatewayDevice.LANDevice.1.WLANConfiguration.{instance}"
            if ssid:
                params.append((f"{base}.SSID", ssid, "string"))
            if passphrase:
                params.append((f"{base}.PreSharedKey.1.Passphrase", passphrase, "string"))
                params.append((f"{base}.WEPKeyIndex", "1", "unsignedInt"))
            if enable is not None:
                params.append((f"{base}.Enable", "1" if enable else "0", "boolean"))
        if not params:
            return None
        return set_parameter_values(job.command_key, params)
    if job.action == "wan":
        params = []
        mapping = {
            "AddressingType": "string",
            "IPAddress": "string",
            "SubnetMask": "string",
            "DefaultGateway": "string",
            "DNSServers": "string",
            "Username": "string",
            "Password": "string",
        }
        for key, typ in mapping.items():
            if payload.get(key):
                params.append(
                    (f"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.{key}",
                     str(payload[key]), typ)
                )
        if not params:
            return None
        return set_parameter_values(job.command_key, params)
    if job.action == "firmware":
        url = payload.get("url")
        if not url:
            return None
        return download(job.command_key, job.command_key, url, "1 Firmware Upgrade Image")
    if job.action == "reboot":
        return reboot(job.command_key, job.command_key)
    if job.action == "monitor":
        return get_parameter_values(job.command_key, _MONITOR_PARAMS)
    return None


# --------------------------------------------------------------------------
# Main entry point
# --------------------------------------------------------------------------

async def handle_cwmp(session: AsyncSession, body: bytes, ip: str) -> str:
    """Process an incoming TR-069 POST body and return the response XML.

    Handles Inform, empty GetRPC posts, and the various RPC responses.
    """
    soap_id = ""
    method = None
    dev_id: dict[str, str] = {}
    params: dict[str, str] = {}
    max_envelopes = 1

    if body and body.strip():
        try:
            root = ET.fromstring(body)
            _strip_ns(root)
        except ET.ParseError as exc:
            logger.warning("ACS: unparseable body from %s: %s", ip, exc)
            return ""
        for el in root.iter():
            if _localname(el.tag) == "ID":
                soap_id = _text(el)
                break
        for el in root.iter():
            if _localname(el.tag) in (
                "Inform", "GetParameterValuesResponse", "SetParameterValuesResponse",
                "DownloadResponse", "RebootResponse", "GetRPCMethods", "TransferComplete", "Fault",
            ):
                method = _localname(el.tag)
                break
        if method == "Fault":
            # SOAP fault from the CPE (e.g. 9005 parameter not supported).
            fault_code = ""
            fault_string = ""
            for el in root.iter():
                tag = _localname(el.tag)
                if tag == "FaultCode":
                    fault_code = _text(el)
                elif tag == "FaultString":
                    fault_string = _text(el)
            if not fault_string:
                # <detail><cwmp:Fault><FaultCode>..</FaultCode><FaultString>..</FaultString>
                for el in root.iter():
                    tag = _localname(el.tag)
                    if tag == "FaultString":
                        fault_string = _text(el)
                        break
            logger.warning("ACS: CWMP Fault from %s: code=%s msg=%s", ip, fault_code, fault_string)
            await _fail_sent_job(session, ip, f"Fault {fault_code}: {fault_string}".strip())
            return ""
        if method == "Inform":
            for el in root.iter():
                tag = _localname(el.tag)
                if tag == "MaxEnvelopes":
                    max_envelopes = int(_text(el) or "1")
            # DeviceId block
            for el in root.iter():
                tag = _localname(el.tag)
                if tag == "Manufacturer":
                    dev_id["manufacturer"] = _text(el)
                elif tag == "OUI":
                    dev_id["oui"] = _text(el)
                elif tag == "ProductClass":
                    dev_id["product_class"] = _text(el)
                elif tag == "SerialNumber":
                    dev_id["serial_number"] = _text(el)
            # Pair Name<->Value elements (they alternate within the inform).
            pvs = []
            current_name = None
            for el in root.iter():
                tag = _localname(el.tag)
                if tag == "Name":
                    current_name = _text(el)
                elif tag == "Value":
                    if current_name is not None:
                        pvs.append((current_name, _text(el)))
                        current_name = None
            for name, value in pvs:
                params[name] = value

    if method == "Inform":
        device = await _upsert_device(session, dev_id, params, ip)
        await _store_params(session, device, params)
        await _sample_metrics(session, device, params)
        await session.commit()
        return inform_response(soap_id or "0", max_envelopes)

    # GetRPC: after Inform (or an RPC response) the CPE sends an "empty" POST
    # asking for the next RPC. Some stacks include a SOAP envelope with no
    # method, so we treat any body that parsed without a recognized method as
    # GetRPC too. Identify the device by the source IP (falling back to the
    # most recent online device).
    if method is None:
        res = await session.execute(
            select(AcsDevice)
            .where(AcsDevice.ip == ip)
            .order_by(AcsDevice.last_inform.desc())
            .limit(1)
        )
        device = res.scalar_one_or_none()
        if device is None:
            res = await session.execute(
                select(AcsDevice).where(AcsDevice.online.is_(True)).order_by(AcsDevice.last_inform.desc()).limit(1)
            )
            device = res.scalar_one_or_none()
        if device is None:
            return ""
        job = await _next_job(session, device)
        if job is None:
            # No pending work: check if we should poll for monitoring parameters.
            # Only poll for devices that have previously reported monitoring params
            # to avoid Fault 9814 on basic CPEs.
            if await _should_poll_monitoring(session, device):
                return get_parameter_values(soap_id or str(uuid.uuid4()), _MONITOR_PARAMS)
            return ""
        # Fail fast when the device's reported TR-069 model does not expose the
        # parameters this job needs (avoids pointless Fault round-trips).
        reason = await _job_capability_check(session, device, job)
        if reason:
            job.status = "failed"
            job.result = reason
            job.finished_at = utcnow()
            await session.commit()
            return ""
        rpc = _job_rpc(job)
        if rpc is None:
            job.status = "failed"
            job.result = "missing payload"
            job.finished_at = utcnow()
            await session.commit()
            return ""
        job.status = "sent"
        job.sent_at = utcnow()
        await session.commit()
        return rpc

    # RPC responses from the device.
    if method == "GetParameterValuesResponse":
        # Store reported values + metrics.
        pvs = []
        current_name = None
        for el in root.iter():
            tag = _localname(el.tag)
            if tag == "Name":
                current_name = _text(el)
            elif tag == "Value":
                if current_name is not None:
                    pvs.append((current_name, _text(el)))
                    current_name = None
        params = dict(pvs)
        # identify by IP match
        device = (await session.execute(
            select(AcsDevice).where(AcsDevice.ip == ip).order_by(AcsDevice.last_inform.desc()).limit(1)
        )).scalar_one_or_none()
        if device is not None:
            await _store_params(session, device, params)
            await _sample_metrics(session, device, params)
            await session.commit()
        return ""

    if method in ("SetParameterValuesResponse", "DownloadResponse", "RebootResponse"):
        command_key = ""
        status_field = ""
        for el in root.iter():
            tag = _localname(el.tag)
            if tag == "CommandKey":
                command_key = _text(el)
            elif tag == "Status":
                status_field = _text(el)
        device = (await session.execute(
            select(AcsDevice).where(AcsDevice.ip == ip).order_by(AcsDevice.last_inform.desc()).limit(1)
        )).scalar_one_or_none()
        if device is not None:
            job = (
                await session.execute(
                    select(AcsJob)
                    .where(AcsJob.device_id == device.id, AcsJob.command_key == command_key, AcsJob.status == "sent")
                    .order_by(AcsJob.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            if job is None and not command_key:
                # SetParameterValuesResponse / some routers omit CommandKey.
                job = (
                    await session.execute(
                        select(AcsJob)
                        .where(AcsJob.device_id == device.id, AcsJob.status == "sent")
                        .order_by(AcsJob.created_at.desc())
                        .limit(1)
                    )
                ).scalar_one_or_none()
            if job is not None:
                # TR-069 SetParameterValues Status: 0=applied, 1=retry, 5=rejected.
                if method == "SetParameterValuesResponse" and status_field not in ("", "0"):
                    job.status = "failed"
                    job.result = f"device rejected params (Status={status_field})"
                else:
                    job.status = "done"
                    job.result = f"device acknowledged (Status={status_field})" if method == "SetParameterValuesResponse" else "device acknowledged"
                job.finished_at = utcnow()
                await session.commit()
        return ""

    logger.info("ACS: unhandled method %r from %s", method, ip)
    return ""
