import enum
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .utils.time import utcnow

# BigInteger primary keys keep a huge id range on Postgres but degrade to a
# normal INTEGER on SQLite (so the app also works for local testing).
BigId = BigInteger().with_variant(Integer, "sqlite")


class OnuSource(str, enum.Enum):
    manual = "manual"
    auto = "auto"


class OnuState(str, enum.Enum):
    active = "active"
    inactive = "inactive"
    offline = "offline"
    unknown = "unknown"


class AccessMethod(str, enum.Enum):
    telnet = "telnet"
    ssh = "ssh"
    both = "both"


class ScanType(str, enum.Enum):
    olt = "olt"
    mikrotik = "mikrotik"
    bind = "bind"


class ScanStatus(str, enum.Enum):
    running = "running"
    success = "success"
    failed = "failed"


class UserRole(str, enum.Enum):
    admin = "admin"
    global_read = "global_read"
    global_write = "global_write"
    noc = "noc"
    field_team = "field_team"


class TicketStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"


class TicketPriority(str, enum.Enum):
    low = "low"
    normal = "normal"
    high = "high"
    urgent = "urgent"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.admin)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OLTDevice(Base):
    __tablename__ = "olt_devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    ip: Mapped[str] = mapped_column(String(64))
    vendor: Mapped[str] = mapped_column(String(32), default="bdcom")
    pon_type: Mapped[str] = mapped_column(String(8), default="gpon")  # gpon | epon
    access_method: Mapped[AccessMethod] = mapped_column(
        Enum(AccessMethod), default=AccessMethod.telnet
    )
    port: Mapped[int] = mapped_column(Integer, default=23)
    username: Mapped[str] = mapped_column(String(128), default="")
    password: Mapped[str] = mapped_column(String(256), default="")
    enable_password: Mapped[str] = mapped_column(String(256), default="")
    snmp_community: Mapped[str] = mapped_column(String(64), default="public")
    snmp_version: Mapped[str] = mapped_column(String(8), default="2c")
    snmp_port: Mapped[int] = mapped_column(Integer, default=161)
    snmp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    port_capacity: Mapped[int] = mapped_column(Integer, default=32)  # ONUs per PON port
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(32), default="unknown")  # reachable | unreachable | unknown
    noc_id: Mapped[int | None] = mapped_column(ForeignKey("nocs.id", ondelete="SET NULL"), nullable=True, index=True)
    pop_id: Mapped[int | None] = mapped_column(ForeignKey("pops.id", ondelete="SET NULL"), nullable=True, index=True)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    onus: Mapped[list["Onu"]] = relationship(back_populates="olt", cascade="all, delete-orphan")


class MikrotikDevice(Base):
    __tablename__ = "mikrotik_devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    ip: Mapped[str] = mapped_column(String(64))
    api_port: Mapped[int] = mapped_column(Integer, default=8728)
    use_ssl: Mapped[bool] = mapped_column(Boolean, default=False)
    routeros_version: Mapped[int] = mapped_column(Integer, default=6)  # 6 | 7
    username: Mapped[str] = mapped_column(String(128), default="")
    password: Mapped[str] = mapped_column(String(256), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(32), default="unknown")
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    # PPP secrets total (authoritative subscriber count), refreshed each scan.
    subscriber_count: Mapped[int] = mapped_column(Integer, default=0)
    active_count: Mapped[int] = mapped_column(Integer, default=0)


class SwitchDevice(Base):
    __tablename__ = "switch_devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    ip: Mapped[str] = mapped_column(String(64))
    vendor: Mapped[str] = mapped_column(String(32), default="bdcom")
    port_count: Mapped[int] = mapped_column(Integer, default=24)
    access_method: Mapped[str] = mapped_column(String(16), default="telnet")
    port: Mapped[int] = mapped_column(Integer, default=23)
    username: Mapped[str] = mapped_column(String(128), default="")
    password: Mapped[str] = mapped_column(String(256), default="")
    enable_password: Mapped[str] = mapped_column(String(256), default="")
    snmp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    snmp_community: Mapped[str] = mapped_column(String(64), default="public")
    snmp_version: Mapped[str] = mapped_column(String(8), default="2c")
    snmp_port: Mapped[int] = mapped_column(Integer, default=161)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(32), default="unknown")
    noc_id: Mapped[int | None] = mapped_column(ForeignKey("nocs.id", ondelete="SET NULL"), nullable=True, index=True)
    pop_id: Mapped[int | None] = mapped_column(ForeignKey("pops.id", ondelete="SET NULL"), nullable=True, index=True)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_message: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SwitchPort(Base):
    __tablename__ = "switch_ports"

    id: Mapped[int] = mapped_column(primary_key=True)
    switch_id: Mapped[int] = mapped_column(ForeignKey("switch_devices.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="unknown")
    speed: Mapped[str] = mapped_column(String(32), default="")
    vlan: Mapped[str] = mapped_column(String(32), default="")
    mac_address: Mapped[str] = mapped_column(String(32), default="")
    description: Mapped[str] = mapped_column(String(256), default="")
    rx_bytes: Mapped[int] = mapped_column(Integer, default=0)
    tx_bytes: Mapped[int] = mapped_column(Integer, default=0)
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Onu(Base):
    __tablename__ = "onus"

    id: Mapped[int] = mapped_column(primary_key=True)
    olt_id: Mapped[int] = mapped_column(ForeignKey("olt_devices.id", ondelete="CASCADE"), index=True)
    source: Mapped[OnuSource] = mapped_column(Enum(OnuSource), default=OnuSource.manual)
    state: Mapped[OnuState] = mapped_column(Enum(OnuState), default=OnuState.unknown)

    name: Mapped[str] = mapped_column(String(256), default="")
    serial: Mapped[str] = mapped_column(String(64), default="", index=True)
    mac: Mapped[str] = mapped_column(String(32), default="")
    pon_port: Mapped[str] = mapped_column(String(32), default="", index=True)  # e.g. GPON0/1:5
    onu_id: Mapped[int] = mapped_column(Integer, default=0)
    vlan: Mapped[int] = mapped_column(Integer, default=0)

    rx_power: Mapped[float | None] = mapped_column(nullable=True)
    tx_power: Mapped[float | None] = mapped_column(nullable=True)
    distance: Mapped[float | None] = mapped_column(nullable=True)  # km

    last_mac: Mapped[str] = mapped_column(String(32), default="")
    mikrotik_ip: Mapped[str] = mapped_column(String(64), default="")
    subscriber: Mapped[str] = mapped_column(String(128), default="")  # PPPoE username (subscriber ID)
    bound: Mapped[bool] = mapped_column(Boolean, default=False)
    down_reason: Mapped[str] = mapped_column(String(64), default="")  # power-off | wire-down | ...

    bandwidth_mode: Mapped[str] = mapped_column(String(16), default="100m")  # 100m | 1g
    note: Mapped[str] = mapped_column(Text, default="")
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # Subscriber profile fields (populated by the operator; GPS/address later).
    address: Mapped[str] = mapped_column(Text, default="")
    gps_lat: Mapped[float | None] = mapped_column(nullable=True)
    gps_lng: Mapped[float | None] = mapped_column(nullable=True)
    gps_accuracy: Mapped[float | None] = mapped_column(nullable=True)  # meters; must be < 9
    phone: Mapped[str] = mapped_column(String(64), default="")
    mobile2: Mapped[str] = mapped_column(String(64), default="")
    email: Mapped[str] = mapped_column(String(128), default="")
    govt_id_type: Mapped[str] = mapped_column(String(16), default="")  # NID | DL | PP
    govt_id_number: Mapped[str] = mapped_column(String(64), default="")
    dob: Mapped[str] = mapped_column(String(16), default="")  # YYYY-MM-DD
    landmark: Mapped[str] = mapped_column(String(256), default="")

    olt: Mapped["OLTDevice"] = relationship(back_populates="onus")

    __table_args__ = (
        UniqueConstraint("olt_id", "pon_port", "onu_id", name="uq_olt_pon_onu"),
    )


class OnuDownEvent(Base):
    """A detected ONU down/recovery event from the live down detector."""

    __tablename__ = "onu_down_events"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    olt_id: Mapped[int] = mapped_column(ForeignKey("olt_devices.id", ondelete="CASCADE"), index=True)
    olt_name: Mapped[str] = mapped_column(String(128), default="")
    pon_port: Mapped[str] = mapped_column(String(32), default="", index=True)  # e.g. EPON0/1:3
    onu_id: Mapped[int] = mapped_column(Integer, default=0)
    serial: Mapped[str] = mapped_column(String(64), default="")
    name: Mapped[str] = mapped_column(String(256), default="")
    kind: Mapped[str] = mapped_column(String(16), default="down")  # down | recovery | outage
    reason: Mapped[str] = mapped_column(String(64), default="")  # power-off | wire-down | ...
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=utcnow)
    duration_seconds: Mapped[int | None] = mapped_column(nullable=True)
    outage_id: Mapped[int | None] = mapped_column(nullable=True, index=True)


class OnuOutage(Base):
    """A mass-outage window: many ONUs down on the same port (feeder/cable cut)."""

    __tablename__ = "onu_outages"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    olt_id: Mapped[int] = mapped_column(ForeignKey("olt_devices.id", ondelete="CASCADE"), index=True)
    olt_name: Mapped[str] = mapped_column(String(128), default="")
    pon_port: Mapped[str] = mapped_column(String(32), default="", index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    onu_count: Mapped[int] = mapped_column(Integer, default=0)
    resolved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)


class MacEntry(Base):
    __tablename__ = "mac_entries"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    olt_id: Mapped[int] = mapped_column(ForeignKey("olt_devices.id", ondelete="CASCADE"), index=True)
    mac: Mapped[str] = mapped_column(String(32), index=True)
    port: Mapped[str] = mapped_column(String(32), default="")
    vlan: Mapped[int] = mapped_column(Integer, default=0)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("olt_id", "mac", name="uq_olt_mac"),
    )


class PppActiveEntry(Base):
    """A live PPPoE session from the Mikrotik /ppp/active table.

    The subscriber ID (PPPoE username) and client MAC (caller-id) come
    straight from here - the Mikrotik already verified the secret, so this
    is the authoritative subscriber -> MAC mapping. OLT MACs are only used
    to locate which ONU a session's MAC is connected to.
    """

    __tablename__ = "ppp_active_entries"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    device_id: Mapped[int] = mapped_column(ForeignKey("mikrotik_devices.id", ondelete="CASCADE"), index=True)
    mac: Mapped[str] = mapped_column(String(32), index=True)
    ip: Mapped[str] = mapped_column(String(64), default="")
    interface: Mapped[str] = mapped_column(String(64), default="")
    subscriber: Mapped[str] = mapped_column(String(128), default="")  # PPPoE username (subscriber ID)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("device_id", "mac", name="uq_ppp_device_mac"),
    )


class Binding(Base):
    __tablename__ = "bindings"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    mac: Mapped[str] = mapped_column(String(32), index=True)
    olt_id: Mapped[int] = mapped_column(ForeignKey("olt_devices.id", ondelete="CASCADE"), index=True)
    olt_port: Mapped[str] = mapped_column(String(32), default="")
    mikrotik_id: Mapped[int] = mapped_column(
        ForeignKey("mikrotik_devices.id", ondelete="CASCADE"), index=True, nullable=True
    )
    mikrotik_ip: Mapped[str] = mapped_column(String(64), default="")
    mikrotik_interface: Mapped[str] = mapped_column(String(64), default="")
    subscriber: Mapped[str] = mapped_column(String(128), default="")  # PPPoE username (subscriber ID)
    onu_id: Mapped[int | None] = mapped_column(ForeignKey("onus.id", ondelete="SET NULL"), nullable=True)
    bound: Mapped[bool] = mapped_column(Boolean, default=False)
    last_checked: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("mac", "olt_id", name="uq_mac_olt"),
    )


class ScanLog(Base):
    __tablename__ = "scan_logs"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    scan_type: Mapped[ScanType] = mapped_column(Enum(ScanType))
    device_id: Mapped[int] = mapped_column(Integer, default=0)
    device_name: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[ScanStatus] = mapped_column(Enum(ScanStatus), default=ScanStatus.running)
    message: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------------------------------------------------------------- fiber map
class Cable(Base):
    __tablename__ = "cables"

    id: Mapped[int] = mapped_column(primary_key=True)
    link_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    link_name: Mapped[str] = mapped_column(String(128), default="")
    code: Mapped[str] = mapped_column(String(64), default="")
    core_count: Mapped[int] = mapped_column(Integer, default=12)
    manufacturer: Mapped[str] = mapped_column(String(128), default="")
    manufacturing_year: Mapped[int] = mapped_column(Integer, default=0)
    cable_type: Mapped[str] = mapped_column(String(32), default="round")  # round | figure8
    route_type: Mapped[str] = mapped_column(String(16), default="driving")  # driving | walking
    src_tj_id: Mapped[int | None] = mapped_column(ForeignKey("tj_boxes.id", ondelete="SET NULL"), nullable=True, index=True)
    dst_tj_id: Mapped[int | None] = mapped_column(ForeignKey("tj_boxes.id", ondelete="SET NULL"), nullable=True, index=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CableSegment(Base):
    __tablename__ = "cable_segments"

    id: Mapped[int] = mapped_column(primary_key=True)
    cable_id: Mapped[int] = mapped_column(ForeignKey("cables.id", ondelete="CASCADE"), index=True)
    start_lat: Mapped[float] = mapped_column()
    start_lng: Mapped[float] = mapped_column()
    end_lat: Mapped[float] = mapped_column()
    end_lng: Mapped[float] = mapped_column()
    order_index: Mapped[int] = mapped_column(Integer, default=0)


class FiberLoop(Base):
    """A fiber loop (slack coil) at a specific location on a cable route."""
    __tablename__ = "fiber_loops"

    id: Mapped[int] = mapped_column(primary_key=True)
    cable_id: Mapped[int] = mapped_column(ForeignKey("cables.id", ondelete="CASCADE"), index=True)
    segment_index: Mapped[int] = mapped_column(Integer, default=0)  # which segment the loop is near
    lat: Mapped[float] = mapped_column()
    lng: Mapped[float] = mapped_column()
    loop_length_m: Mapped[int] = mapped_column(Integer, default=0)  # extra cable length in meters
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Splice(Base):
    """A splice connection between two cable cores at a TJ box."""
    __tablename__ = "splices"

    id: Mapped[int] = mapped_column(primary_key=True)
    tj_id: Mapped[int] = mapped_column(ForeignKey("tj_boxes.id", ondelete="CASCADE"), index=True)
    cable_a_id: Mapped[int] = mapped_column(ForeignKey("cables.id", ondelete="CASCADE"), index=True)
    core_a: Mapped[int] = mapped_column(Integer)  # core number on cable A
    cable_b_id: Mapped[int] = mapped_column(ForeignKey("cables.id", ondelete="CASCADE"), index=True)
    core_b: Mapped[int] = mapped_column(Integer)  # core number on cable B
    status: Mapped[str] = mapped_column(String(16), default="active")  # active | spare | broken
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CableCut(Base):
    """A cable cut / repair event on a cable route."""
    __tablename__ = "cable_cuts"

    id: Mapped[int] = mapped_column(primary_key=True)
    cable_id: Mapped[int] = mapped_column(ForeignKey("cables.id", ondelete="CASCADE"), index=True)
    lat: Mapped[float] = mapped_column()
    lng: Mapped[float] = mapped_column()
    cut_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    repair_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    splice_tj_id: Mapped[int | None] = mapped_column(ForeignKey("tj_boxes.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="cut")  # cut | repaired
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TjBox(Base):
    __tablename__ = "tj_boxes"

    id: Mapped[int] = mapped_column(primary_key=True)
    unique_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    box_type: Mapped[str] = mapped_column(String(32), default="tj")  # home_tj | regular_tj | enclosure | dome
    tj_port: Mapped[int] = mapped_column(Integer, default=4)
    capacity: Mapped[int] = mapped_column(Integer, default=4)  # splice capacity
    tray_count: Mapped[int] = mapped_column(Integer, default=1)
    lat: Mapped[float] = mapped_column()
    lng: Mapped[float] = mapped_column()
    address: Mapped[str] = mapped_column(String(256), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Splitter(Base):
    __tablename__ = "splitters"

    id: Mapped[int] = mapped_column(primary_key=True)
    unique_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128), default="")
    split_ratio: Mapped[int] = mapped_column(Integer, default=2)
    tj_box_id: Mapped[int | None] = mapped_column(ForeignKey("tj_boxes.id", ondelete="SET NULL"), nullable=True, index=True)
    input_core: Mapped[int] = mapped_column(Integer, default=0)
    output_cores: Mapped[str] = mapped_column(String(256), default="")  # comma-separated core numbers
    lat: Mapped[float] = mapped_column()
    lng: Mapped[float] = mapped_column()
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Pop(Base):
    __tablename__ = "pops"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    address: Mapped[str] = mapped_column(Text, default="")
    gps_lat: Mapped[float] = mapped_column(nullable=True)
    gps_lng: Mapped[float] = mapped_column(nullable=True)
    contact_name: Mapped[str] = mapped_column(String(128), default="")
    contact_phone: Mapped[str] = mapped_column(String(64), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Noc(Base):
    __tablename__ = "nocs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    address: Mapped[str] = mapped_column(Text, default="")
    gps_lat: Mapped[float] = mapped_column(nullable=True)
    gps_lng: Mapped[float] = mapped_column(nullable=True)
    contact_name: Mapped[str] = mapped_column(String(128), default="")
    contact_phone: Mapped[str] = mapped_column(String(64), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class OnuTelemetry(Base):
    """Optical RX/TX power samples for an ONU, taken every few minutes."""

    __tablename__ = "onu_telemetry"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    onu_id: Mapped[int] = mapped_column(ForeignKey("onus.id", ondelete="CASCADE"), index=True)
    olt_id: Mapped[int] = mapped_column(ForeignKey("olt_devices.id", ondelete="CASCADE"), index=True)
    pon_port: Mapped[str] = mapped_column(String(32), default="")
    rx_power: Mapped[float | None] = mapped_column(nullable=True)
    tx_power: Mapped[float | None] = mapped_column(nullable=True)
    in_octets: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    out_octets: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sampled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=utcnow)


class OnuMacHistory(Base):
    """Previous MACs a subscriber used before switching to a new CPE/router."""

    __tablename__ = "onu_mac_history"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    onu_id: Mapped[int] = mapped_column(ForeignKey("onus.id", ondelete="CASCADE"), index=True)
    mac: Mapped[str] = mapped_column(String(32), default="")
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MacVendor(Base):
    """Cached OUI -> vendor lookup (first three MAC bytes, uppercase hex).

    Filled lazily from a free MAC vendor provider and reused for every MAC
    display in the UI, so the provider is only hit once per OUI.
    """

    __tablename__ = "mac_vendors"

    oui: Mapped[str] = mapped_column(String(6), primary_key=True)
    vendor: Mapped[str] = mapped_column(String(256), default="")
    brand: Mapped[str] = mapped_column(String(128), default="")
    source: Mapped[str] = mapped_column(String(32), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PortArea(Base):
    """Editable human label for a PON port base (e.g. 'EPON0/1' -> 'Rampura South')."""

    __tablename__ = "port_areas"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    olt_id: Mapped[int] = mapped_column(ForeignKey("olt_devices.id", ondelete="CASCADE"), index=True)
    port: Mapped[str] = mapped_column(String(32), default="")  # base e.g. EPON0/1
    label: Mapped[str] = mapped_column(String(128), default="")

    __table_args__ = (
        UniqueConstraint("olt_id", "port", name="uq_olt_port_area"),
    )


class Ticket(Base):
    """A task / to-do assigned to a user, optionally tied to a subscriber (ONU).

    The assigned user sees only their own tickets and (by permission) may edit
    the linked subscriber's address & GPS.
    """

    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    title: Mapped[str] = mapped_column(String(256), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    # Stored as VARCHAR (matching the migration); validated via the enums.
    status: Mapped[str] = mapped_column(String(32), default=TicketStatus.open.value)
    priority: Mapped[str] = mapped_column(String(32), default=TicketPriority.normal.value)

    assigned_to: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    subscriber: Mapped[str] = mapped_column(String(128), default="")  # PPPoE username
    onu_id: Mapped[int | None] = mapped_column(
        ForeignKey("onus.id", ondelete="SET NULL"), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AcsDevice(Base):
    """A CPE / home router registered through TR-069 (CWMP) with the ACS."""

    __tablename__ = "acs_devices"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    serial_number: Mapped[str] = mapped_column(String(128), default="", index=True)
    manufacturer: Mapped[str] = mapped_column(String(128), default="")
    oui: Mapped[str] = mapped_column(String(32), default="")
    product_class: Mapped[str] = mapped_column(String(64), default="")
    model_name: Mapped[str] = mapped_column(String(128), default="")
    hardware_version: Mapped[str] = mapped_column(String(64), default="")
    software_version: Mapped[str] = mapped_column(String(64), default="")

    ip: Mapped[str] = mapped_column(String(64), default="")
    mac: Mapped[str] = mapped_column(String(32), default="")
    subscriber: Mapped[str] = mapped_column(String(128), default="")  # optional link to PPPoE user
    onu_id: Mapped[int | None] = mapped_column(
        ForeignKey("onus.id", ondelete="SET NULL"), nullable=True, index=True
    )

    online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_inform: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_cpu: Mapped[float | None] = mapped_column(nullable=True)
    last_mem_used: Mapped[float | None] = mapped_column(nullable=True)
    last_mem_total: Mapped[float | None] = mapped_column(nullable=True)
    last_rx_bytes: Mapped[float | None] = mapped_column(nullable=True)
    last_tx_bytes: Mapped[float | None] = mapped_column(nullable=True)
    last_rx_rate: Mapped[float | None] = mapped_column(nullable=True)  # bits/sec
    last_tx_rate: Mapped[float | None] = mapped_column(nullable=True)

    __table_args__ = (
        UniqueConstraint("serial_number", name="uq_acs_serial"),
    )


class AcsParameter(Base):
    """A TR-069 parameter name/value reported by a CPE (latest value)."""

    __tablename__ = "acs_parameters"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("acs_devices.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(512), default="", index=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        UniqueConstraint("device_id", "name", name="uq_acs_param"),
    )


class AcsMetric(Base):
    """Periodic resource/traffic sample from a CPE (for monitoring charts)."""

    __tablename__ = "acs_metrics"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("acs_devices.id", ondelete="CASCADE"), index=True
    )
    sampled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=utcnow)
    cpu: Mapped[float | None] = mapped_column(nullable=True)
    mem_used: Mapped[float | None] = mapped_column(nullable=True)
    mem_total: Mapped[float | None] = mapped_column(nullable=True)
    rx_bytes: Mapped[float | None] = mapped_column(nullable=True)
    tx_bytes: Mapped[float | None] = mapped_column(nullable=True)
    rx_rate: Mapped[float | None] = mapped_column(nullable=True)  # bits/sec
    tx_rate: Mapped[float | None] = mapped_column(nullable=True)


class AcsJob(Base):
    """A queued TR-069 RPC job (wifi change, firmware download, wan push, reboot)."""

    __tablename__ = "acs_jobs"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    device_id: Mapped[int] = mapped_column(
        ForeignKey("acs_devices.id", ondelete="CASCADE"), index=True
    )
    action: Mapped[str] = mapped_column(String(32), default="")  # wifi | firmware | wan | reboot
    payload: Mapped[str] = mapped_column(Text, default="")  # JSON args
    status: Mapped[str] = mapped_column(String(32), default="queued")  # queued|sent|done|failed|timeout
    result: Mapped[str] = mapped_column(Text, default="")
    command_key: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class OltWriteLog(Base):
    __tablename__ = "olt_write_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    olt_id: Mapped[int] = mapped_column(ForeignKey("olt_devices.id", ondelete="CASCADE"))
    olt_name: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(32), default="running")  # running|success|failed
    message: Mapped[str] = mapped_column(Text, default="")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    olt: Mapped["OLTDevice"] = relationship(back_populates="write_logs")


# Add write_logs relationship to OLTDevice if not already present
if not hasattr(OLTDevice, "write_logs"):
    OLTDevice.write_logs = relationship("OltWriteLog", back_populates="olt", cascade="all, delete-orphan")