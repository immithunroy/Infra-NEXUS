from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class OnuInfo:
    pon_port: str = ""
    onu_id: int = 0
    serial: str = ""
    state: str = "unknown"  # active | inactive | offline | unknown
    rx: float | None = None
    tx: float | None = None
    description: str = ""
    dereg_reason: str = ""  # OLT-reported dereg reason (power-off, wire-down, ...)
    extra: dict = field(default_factory=dict)


@dataclass
class MacInfo:
    mac: str = ""
    port: str = ""
    vlan: int = 0


class DriverError(Exception):
    pass


@dataclass
class OltHealthSample:
    """OLT system health via SNMP."""
    cpu_pct: float | None = None
    memory_pct: float | None = None
    temp_celsius: float | None = None
    pon_sfp_tx: float | None = None
    pon_sfp_rx: float | None = None


class BaseDriver(ABC):
    @abstractmethod
    async def test(self) -> str:
        """Return a human readable success message or raise DriverError."""

    @abstractmethod
    async def get_onus(self) -> list[OnuInfo]:
        """Collect the ONU list from the device."""

    @abstractmethod
    async def get_macs(self) -> list[MacInfo]:
        """Collect the learned MAC address table from the device."""