from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, validator


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ChangePasswordRequest(BaseModel):
    currentPassword: str
    newPassword: str
    confirmPassword: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str = "admin"
    is_admin: bool


class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "global_read"


class UserUpdate(BaseModel):
    username: str | None = None
    password: str | None = None
    role: str | None = None
    is_admin: bool | None = None


class OLTDeviceBase(BaseModel):
    name: str
    ip: str
    vendor: str = "bdcom"
    pon_type: str = "gpon"
    access_method: str = "telnet"
    port: int = 23
    username: str = ""
    password: str = ""
    enable_password: str = ""
    snmp_community: str = "public"
    snmp_version: str = "2c"
    snmp_port: int = 161
    snmp_enabled: bool = False
    port_capacity: int = 32
    enabled: bool = True
    noc_id: int | None = None
    pop_id: int | None = None


class OLTDeviceCreate(OLTDeviceBase):
    pass


class OLTDeviceUpdate(BaseModel):
    name: str | None = None
    ip: str | None = None
    vendor: str | None = None
    pon_type: str | None = None
    access_method: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None
    enable_password: str | None = None
    snmp_community: str | None = None
    snmp_version: str | None = None
    snmp_port: int | None = None
    snmp_enabled: bool | None = None
    port_capacity: int | None = None
    enabled: bool | None = None
    noc_id: int | None = None
    pop_id: int | None = None


class OLTDeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    ip: str
    vendor: str
    pon_type: str
    access_method: str
    port: int
    username: str
    password: str = ""
    enable_password: str = ""
    snmp_community: str
    snmp_version: str
    snmp_port: int
    snmp_enabled: bool
    port_capacity: int
    enabled: bool
    status: str
    noc_id: int | None = None
    pop_id: int | None = None
    last_scan_at: datetime | None
    last_message: str
    onu_count: int = 0
    ports: list[str] = []


class SwitchBase(BaseModel):
    name: str
    ip: str
    vendor: str = "bdcom"
    port_count: int = 24
    access_method: str = "telnet"
    port: int = 23
    username: str = ""
    password: str = ""
    enable_password: str = ""
    snmp_enabled: bool = False
    snmp_community: str = "public"
    enabled: bool = True
    noc_id: int | None = None
    pop_id: int | None = None


class SwitchCreate(SwitchBase):
    pass


class SwitchUpdate(BaseModel):
    name: str | None = None
    ip: str | None = None
    vendor: str | None = None
    port_count: int | None = None
    access_method: str | None = None
    port: int | None = None
    username: str | None = None
    password: str | None = None
    enable_password: str | None = None
    snmp_enabled: bool | None = None
    snmp_community: str | None = None
    enabled: bool | None = None
    noc_id: int | None = None
    pop_id: int | None = None


class SwitchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    ip: str
    vendor: str
    port_count: int
    access_method: str
    port: int
    username: str
    password: str = ""
    enable_password: str = ""
    snmp_enabled: bool
    snmp_community: str
    enabled: bool
    noc_id: int | None = None
    pop_id: int | None = None
    last_scan_at: datetime | None
    last_message: str
    ports: list["SwitchPortOut"] = []


class SwitchPortOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    switch_id: int
    name: str
    status: str
    speed: str
    vlan: str
    mac_address: str
    description: str
    last_scan_at: datetime | None


class MikrotikBase(BaseModel):
    name: str
    ip: str
    api_port: int = 8728
    use_ssl: bool = False
    routeros_version: int = 6
    username: str = ""
    password: str = ""
    enabled: bool = True


class MikrotikCreate(MikrotikBase):
    pass


class MikrotikUpdate(BaseModel):
    name: str | None = None
    ip: str | None = None
    api_port: int | None = None
    use_ssl: bool | None = None
    routeros_version: int | None = None
    username: str | None = None
    password: str | None = None
    enabled: bool | None = None


class MikrotikOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    ip: str
    api_port: int
    use_ssl: bool
    routeros_version: int
    username: str
    password: str = ""
    enabled: bool
    status: str
    last_scan_at: datetime | None
    last_message: str
    subscriber_count: int = 0  # total PPP secrets (authoritative total)
    active_count: int = 0  # currently connected PPPoE sessions


class OnuBase(BaseModel):
    name: str = ""
    serial: str = ""
    mac: str = ""
    pon_port: str = ""
    onu_id: int = 0
    vlan: int = 0
    note: str = ""


class OnuCreate(OnuBase):
    olt_id: int


class OnuUpdate(BaseModel):
    # subscriber is intentionally absent: it is managed by the binding
    # engine from the Mikrotik /ppp/active list only. extra="forbid" makes
    # sure any attempt to set it (or any other unknown field) is rejected.
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    serial: str | None = None
    mac: str | None = None
    pon_port: str | None = None
    onu_id: int | None = None
    vlan: int | None = None
    bandwidth_mode: str | None = None
    note: str | None = None
    address: str | None = None
    gps_lat: float | None = None
    gps_lng: float | None = None
    gps_accuracy: float | None = None
    phone: str | None = None
    mobile2: str | None = None
    email: str | None = None
    govt_id_type: str | None = None
    govt_id_number: str | None = None
    dob: str | None = None
    landmark: str | None = None


class OnuOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    olt_id: int
    olt_name: str = ""
    source: str
    state: str
    name: str
    serial: str
    mac: str
    pon_port: str
    onu_id: int
    vlan: int
    rx_power: float | None
    tx_power: float | None
    distance: float | None = None
    last_mac: str
    mac_vendor: str = ""
    mikrotik_ip: str
    subscriber: str
    bound: bool
    down_reason: str = ""
    status: str = ""
    note: str
    address: str = ""
    bandwidth_mode: str = "100m"
    gps_lat: float | None = None
    gps_lng: float | None = None
    gps_accuracy: float | None = None
    phone: str = ""
    email: str = ""
    last_seen: datetime | None
    created_at: datetime


class TestResult(BaseModel):
    success: bool
    message: str


class ScanResult(BaseModel):
    success: bool
    message: str
    log_id: int | None = None


class MacEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    mac: str
    mac_vendor: str = ""
    port: str
    vlan: int
    last_seen: datetime
    olt_id: int
    olt_name: str = ""


class PppActiveOut(BaseModel):
    """A live PPPoE session from the Mikrotik /ppp/active table."""

    model_config = ConfigDict(from_attributes=True)

    mac: str
    mac_vendor: str = ""
    ip: str
    interface: str
    subscriber: str
    last_seen: datetime
    device_id: int
    device_name: str = ""


class BindingOut(BaseModel):
    mac: str
    mac_vendor: str = ""
    olt_id: int
    olt_name: str
    olt_port: str
    mikrotik_id: int | None
    mikrotik_name: str
    mikrotik_ip: str
    mikrotik_interface: str
    subscriber: str
    onu_id: int | None
    onu_name: str
    bound: bool
    last_checked: datetime


class PortUsage(BaseModel):
    port: str
    used: int
    capacity: int
    remaining: int
    active: int
    bound: int
    description: str = ""


class OltUsage(BaseModel):
    id: int
    name: str
    ip: str
    pon_type: str
    status: str
    port_capacity: int
    port_count: int
    total_slots: int
    used_slots: int
    free_slots: int
    utilization_pct: float
    onu_total: int
    onu_active: int
    onu_bound: int
    onu_manual: int
    ports: list[PortUsage]


class SignalBucket(BaseModel):
    label: str
    count: int


class WeakOnu(BaseModel):
    olt_id: int = 0
    olt_name: str = ""
    pon_port: str = ""
    onu_id: int = 0
    name: str = ""
    subscriber: str = ""
    serial: str = ""
    state: str = ""
    rx_power: float | None = None
    tx_power: float | None = None


class BrandBucket(BaseModel):
    brand: str
    count: int
    pct: float


class MassDownPort(BaseModel):
    olt_id: int
    olt_name: str
    port: str
    label: str = ""
    count: int
    power_off_count: int = 0
    wire_down_count: int = 0
    reason: str = ""


class MapPoint(BaseModel):
    onu_id: int
    olt_id: int
    olt_name: str = ""
    pon_port: str = ""
    name: str = ""
    subscriber: str = ""
    serial: str = ""
    gps_lat: float
    gps_lng: float
    gps_accuracy: float | None = None
    state: str
    status: str
    down_reason: str = ""
    bound: bool = False
    rx_power: float | None = None
    address: str = ""
    last_seen: datetime | None = None


class MapPointResponse(BaseModel):
    city_lat: float = 22.7000
    city_lng: float = 90.3667
    points: list[MapPoint] = []


class DashboardSummary(BaseModel):
    olt_count: int
    olt_reachable: int
    mikrotik_count: int
    onu_total: int
    onu_manual: int
    onu_active: int
    onu_inactive: int
    onu_bound: int
    olt_mac_count: int
    active_mac_count: int
    matched_mac_count: int
    total_slots: int
    free_slots: int
    bound_pct: float
    subscriber_total: int = 0  # sum of PPP secrets across Mikrotiks
    subscriber_active: int = 0  # currently connected PPPoE sessions
    signal_hist: list[SignalBucket]
    weakest_onus: list[WeakOnu]
    router_brands: list[BrandBucket] = []
    mass_down_ports: list[MassDownPort] = []
    olts: list[OltUsage]
    last_scan: datetime | None


class NetworkSummary(BaseModel):
    """Summary stats for fiber cable, TJ boxes, users on map, and splitters."""
    # Cable stats
    cable_total_km: float = 0.0
    cable_by_core: dict[int, float] = {}  # core_count -> total km
    cable_count: int = 0
    # TJ box stats
    tj_total: int = 0
    tj_by_port: dict[int, int] = {}  # tj_port -> count
    # User / map stats
    user_total: int = 0
    user_with_gps: int = 0
    user_without_gps: int = 0
    gps_coverage_pct: float = 0.0
    # Splitter stats
    splitter_total: int = 0


class SearchOnu(BaseModel):
    id: int
    olt_id: int
    olt_name: str
    pon_port: str
    name: str
    serial: str
    subscriber: str
    last_mac: str
    mac_vendor: str = ""
    state: str
    bound: bool
    down_reason: str = ""
    status: str = ""


class SearchDevice(BaseModel):
    id: int
    name: str
    ip: str
    kind: str  # olt | mikrotik


class SearchResult(BaseModel):
    onus: list[SearchOnu]
    olts: list[SearchDevice]
    mikrotiks: list[SearchDevice]


class TelemetryPoint(BaseModel):
    sampled_at: datetime
    rx_power: float | None
    tx_power: float | None
    rx_mbps: float | None = None
    tx_mbps: float | None = None


class MacHistoryEntry(BaseModel):
    mac: str
    mac_vendor: str = ""
    changed_at: datetime


class SubscriberSummary(BaseModel):
    subscriber: str
    onu_id: int
    onu_name: str = ""
    olt_name: str = ""
    pon_port: str = ""
    last_mac: str = ""
    mac_vendor: str = ""
    mikrotik_ip: str = ""
    state: str = ""
    bound: bool = False
    down_reason: str = ""
    status: str = ""
    acs_device_id: int | None = None
    rx_power: float | None = None
    tx_power: float | None = None
    mac_change_count: int = 0
    last_seen: datetime | None = None


class RemotePort(BaseModel):
    port: int
    scheme: str
    open: bool


class RemoteAccess(BaseModel):
    ip: str
    reachable: bool
    url: str = ""
    ports: list[RemotePort] = []
    checked_at: float = 0


class SubscriberProfile(BaseModel):
    subscriber: str
    onu_id: int
    onu_name: str = ""
    olt_name: str = ""
    pon_port: str = ""
    serial: str = ""
    last_mac: str = ""
    mac_vendor: str = ""
    mikrotik_ip: str = ""
    state: str = ""
    bound: bool = False
    can_edit_gps: bool = False
    down_reason: str = ""
    status: str = ""
    acs_device_id: int | None = None
    address: str = ""
    gps_lat: float | None = None
    gps_lng: float | None = None
    gps_accuracy: float | None = None
    phone: str = ""
    mobile2: str = ""
    email: str = ""
    govt_id_type: str = ""
    govt_id_number: str = ""
    dob: str = ""
    landmark: str = ""
    note: str = ""
    telemetry: list[TelemetryPoint] = []
    mac_history: list[MacHistoryEntry] = []
    last_seen: datetime | None = None


class DownStartRequest(BaseModel):
    olt_id: int
    port: str = ""
    interval: int = 30
    mass_threshold: int = 5


class PortAreaOut(BaseModel):
    olt_id: int
    port: str
    label: str = ""


class PortAreaUpsert(BaseModel):
    olt_id: int
    port: str
    label: str = ""


class DownEventOut(BaseModel):
    id: int
    olt_id: int
    olt_name: str
    pon_port: str
    onu_id: int
    serial: str
    name: str
    kind: str
    reason: str
    detected_at: datetime
    duration_seconds: int | None = None
    outage_id: int | None = None


class DownStatusOut(BaseModel):
    running: bool
    olt_id: int | None = None
    olt_name: str = ""
    port: str = ""
    interval: int | None = None
    mass_threshold: int | None = None
    last_poll_at: datetime | None = None
    started_at: datetime | None = None
    last_error: str = ""
    current_down_count: int = 0
    current_down: list[dict] = []


class OutageOut(BaseModel):
    id: int
    olt_id: int
    olt_name: str
    pon_port: str
    started_at: datetime
    onu_count: int
    resolved_at: datetime | None = None
    resolved: bool


class ScanLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    scan_type: str
    device_id: int
    device_name: str
    status: str
    message: str
    started_at: datetime
    finished_at: datetime | None


class OltWriteLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    olt_id: int
    olt_name: str
    status: str
    message: str
    started_at: datetime
    finished_at: datetime | None


class BgpSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device_id: int
    name: str | None = ""
    remote_as: int
    remote_ip: str
    local_ip: str
    local_as: int | None = None
    address_family: str | None = "ipv4"
    state: str
    uptime: str
    prefix_count: int
    advertised_count: int
    is_upstream: bool = False
    last_scan_at: datetime | None


class BgpPrefixSnapshotOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    prefix_count: int
    advertised_count: int
    recorded_at: datetime


class Message(BaseModel):
    detail: str = Field(default="")


class DownReasonBucket(BaseModel):
    reason: str
    count: int


class PortReport(BaseModel):
    port: str
    label: str = ""
    total: int = 0
    active: int = 0
    down: int = 0
    bound: int = 0
    gps: int = 0
    online_pct: float = 0.0


class OltReport(BaseModel):
    olt_id: int
    olt_name: str
    pon_type: str = ""
    port_count: int = 0
    total: int = 0
    active: int = 0
    down: int = 0
    bound: int = 0
    gps: int = 0
    online_pct: float = 0.0
    ports: list[PortReport] = []


class ReportSummary(BaseModel):
    total_onus: int = 0
    total_active: int = 0
    total_down: int = 0
    total_bound: int = 0
    gps_tagged: int = 0
    gps_coverage_pct: float = 0.0
    state: dict[str, int] = {}
    down_reasons: list[DownReasonBucket] = []
    recent_down_events: int = 0
    recent_down_events_by_reason: list[DownReasonBucket] = []
    olts: list[OltReport] = []


class TicketCreate(BaseModel):
    title: str
    description: str = ""
    priority: str = "normal"
    assigned_to: int | None = None
    subscriber: str = ""
    onu_id: int | None = None


class TicketUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    assigned_to: int | None = None
    subscriber: str | None = None
    onu_id: int | None = None


class TicketOut(BaseModel):
    id: int
    title: str
    description: str
    status: str
    priority: str
    assigned_to: int | None = None
    assigned_name: str = ""
    created_by: int | None = None
    created_by_name: str = ""
    subscriber: str = ""
    onu_id: int | None = None
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None


class AcsDeviceOut(BaseModel):
    id: int
    serial_number: str = ""
    manufacturer: str = ""
    oui: str = ""
    product_class: str = ""
    model_name: str = ""
    hardware_version: str = ""
    software_version: str = ""
    ip: str = ""
    mac: str = ""
    subscriber: str = ""
    onu_id: int | None = None
    online: bool = False
    last_inform: datetime | None = None
    first_seen: datetime | None = None
    last_cpu: float | None = None
    last_mem_used: float | None = None
    last_mem_total: float | None = None
    last_rx_rate: float | None = None
    last_tx_rate: float | None = None


class AcsParameterOut(BaseModel):
    name: str
    value: str


class AcsMetricOut(BaseModel):
    sampled_at: datetime
    cpu: float | None = None
    mem_used: float | None = None
    mem_total: float | None = None
    rx_rate: float | None = None
    tx_rate: float | None = None


class AcsJobOut(BaseModel):
    id: int
    action: str
    status: str
    result: str = ""
    payload: str = ""
    created_at: datetime
    sent_at: datetime | None = None
    finished_at: datetime | None = None


class AcsWifiBandOut(BaseModel):
    instance: int
    band: str = ""  # 2.4g | 5g | 5g2 | unknown
    ssid: str = ""
    passphrase: str = ""
    enable: bool | None = None
    channel: str = ""
    standard: str = ""
    security_mode: str = ""


class AcsWifiStatusOut(BaseModel):
    supported: bool = False
    bands: list[AcsWifiBandOut] = []
    summary: str = ""


class WifiChangeRequest(BaseModel):
    ssid: str | None = None
    passphrase: str
    enable: bool | None = None
    # Which wireless band(s): 2.4g | 5g | 5g2 | all
    band: str = "2.4g"


class WanConfigRequest(BaseModel):
    addressing_type: str | None = None
    ip_address: str | None = None
    subnet_mask: str | None = None
    default_gateway: str | None = None
    dns_servers: str | None = None
    username: str | None = None
    password: str | None = None


class FirmwareRequest(BaseModel):
    url: str
class OpticalReportRow(BaseModel):
    """One ONU's optical-power summary over the report window (weekly)."""
    olt_id: int = 0
    olt_name: str = ""
    pon_port: str = ""
    onu_id: int = 0
    subscriber: str = ""
    name: str = ""
    serial: str = ""
    samples: int = 0
    avg_rx: float | None = None
    min_rx: float | None = None
    max_rx: float | None = None
    last_rx: float | None = None
    avg_tx: float | None = None
    min_tx: float | None = None
    max_tx: float | None = None
    last_tx: float | None = None
    current_state: str = ""
    bound: bool = False
    first_sampled: datetime | None = None
    last_sampled: datetime | None = None


class OpticalReport(BaseModel):
    window_days: int
    olt_filter: int | None = None
    generated_at: datetime
    rows: list[OpticalReportRow] = []


class FluctuationReportRow(BaseModel):
    """One ONU whose RX power fluctuated more than the threshold."""
    olt_id: int = 0
    olt_name: str = ""
    pon_port: str = ""
    onu_id: int = 0
    subscriber: str = ""
    name: str = ""
    serial: str = ""
    samples: int = 0
    avg_rx: float | None = None
    min_rx: float | None = None
    max_rx: float | None = None
    last_rx: float | None = None
    avg_tx: float | None = None
    fluctuation: float = 0.0  # max_rx - min_rx
    current_state: str = ""


class FluctuationReport(BaseModel):
    window_days: int
    olt_filter: int | None = None
    threshold: float = 3.0
    generated_at: datetime
    rows: list[FluctuationReportRow] = []


class WeakSignalReport(BaseModel):
    olt_filter: int | None = None
    port_filter: str = ""
    limit: int
    generated_at: datetime
    rows: list[WeakOnu] = []


class DowntimeReportRow(BaseModel):
    """Aggregated downtime (down events + outages) per ONU over the window."""
    olt_id: int = 0
    olt_name: str = ""
    pon_port: str = ""
    onu_id: int = 0
    subscriber: str = ""
    name: str = ""
    serial: str = ""
    down_events: int = 0
    outage_events: int = 0
    total_seconds: int = 0
    avg_seconds: int = 0
    max_seconds: int = 0
    reason: str = ""
    first_event: datetime | None = None
    last_event: datetime | None = None


class DowntimeReport(BaseModel):
    window_days: int
    olt_filter: int | None = None
    generated_at: datetime
    rows: list[DowntimeReportRow] = []


class PortReportRow(BaseModel):
    """Per-OLT-port capacity + state aggregation for export."""
    olt_id: int = 0
    olt_name: str = ""
    pon_type: str = ""
    port: str = ""
    label: str = ""
    capacity: int = 0
    used: int = 0
    remaining: int = 0
    active: int = 0
    down: int = 0
    bound: int = 0
    gps: int = 0
    utilization_pct: float = 0.0


class PortReportExport(BaseModel):
    window_days: int = 0
    olt_filter: int | None = None
    generated_at: datetime
    rows: list[PortReportRow] = []


class OnuPortControl(BaseModel):
    olt_id: int
    pon_port: str
    onu_id: int
    port_id: int = 1
    enable: bool


class RejectedOnu(BaseModel):
    olt_id: int
    pon_port: str
    onu_id: int
    serial: str = ""
    reason: str = ""
    raw_line: str = ""
    description: str = ""


class OnuAuthorizeRequest(BaseModel):
    pon_port: str
    onu_id: int
    serial: str
    name: str = ""


class OnuDeleteRequest(BaseModel):
    pon_port: str
    onu_id: int


class OnuAddRequest(BaseModel):
    pon_port: str
    identifier: str
    description: str = ""
    sequence: int | None = None


class OnuDescriptionRequest(BaseModel):
    pon_port: str
    onu_id: int
    description: str


class OnuBandwidthRequest(BaseModel):
    pon_port: str
    onu_id: int
    mode: str  # "100m" or "1g"


# ---------------------------------------------------------------- fiber map
class CableBase(BaseModel):
    link_id: str = ""
    link_name: str = ""
    code: str = ""
    core_count: int = 12
    manufacturer: str = ""
    manufacturing_year: int = 0
    cable_type: str = "round"
    route_type: str = "driving"
    src_tj_id: int | None = None
    dst_tj_id: int | None = None
    notes: str = ""

    @validator("code", "link_name", "manufacturer", pre=True)
    def upper_str(cls, v):
        return v.upper() if isinstance(v, str) else v


class CableCreate(CableBase):
    segments: list["SegmentBase"] = []


class CableUpdate(BaseModel):
    link_name: str | None = None
    code: str | None = None
    core_count: int | None = None
    manufacturer: str | None = None
    manufacturing_year: int | None = None
    cable_type: str | None = None
    route_type: str | None = None
    src_tj_id: int | None = None
    dst_tj_id: int | None = None
    notes: str | None = None
    segments: list["SegmentBase"] | None = None

    @validator("code", "link_name", "manufacturer", pre=True)
    def upper_str(cls, v):
        return v.upper() if isinstance(v, str) else v


class SegmentBase(BaseModel):
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    order_index: int = 0


class SegmentOut(SegmentBase):
    id: int
    cable_id: int


class CableOut(CableBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    segments: list[SegmentOut] = []
    src_tj_name: str = ""
    dst_tj_name: str = ""


class TjBoxBase(BaseModel):
    name: str
    box_type: str = "regular_tj"
    tj_port: int = 8
    capacity: int = 12
    tray_count: int = 1
    splice_per_tray: int = 12
    lat: float
    lng: float
    address: str = ""
    notes: str = ""

    @validator("name", pre=True)
    def upper_str(cls, v):
        return v.upper() if isinstance(v, str) else v


class TjBoxCreate(TjBoxBase):
    pass


class TjBoxUpdate(BaseModel):
    name: str | None = None
    box_type: str | None = None
    tj_port: int | None = None
    capacity: int | None = None
    tray_count: int | None = None
    splice_per_tray: int | None = None
    lat: float | None = None
    lng: float | None = None
    address: str | None = None
    notes: str | None = None

    @validator("name", pre=True)
    def upper_str(cls, v):
        return v.upper() if isinstance(v, str) else v


class TjBoxOut(TjBoxBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    unique_id: str


class SplitterBase(BaseModel):
    name: str = ""
    split_ratio: int = 2
    tj_box_id: int | None = None
    input_core: int = 0
    output_cores: str = ""
    lat: float
    lng: float
    notes: str = ""

    @validator("name", pre=True)
    def upper_str(cls, v):
        return v.upper() if isinstance(v, str) else v


class SplitterCreate(SplitterBase):
    pass


class SplitterUpdate(BaseModel):
    name: str | None = None
    split_ratio: int | None = None
    tj_box_id: int | None = None
    input_core: int | None = None
    output_cores: str | None = None
    lat: float | None = None
    lng: float | None = None
    notes: str | None = None

    @validator("name", pre=True)
    def upper_str(cls, v):
        return v.upper() if isinstance(v, str) else v


class SplitterOut(SplitterBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    unique_id: str
    tj_box_name: str = ""


# ---------------------------------------------------------------- fiber loops
class FiberLoopBase(BaseModel):
    cable_id: int
    segment_index: int = 0
    lat: float
    lng: float
    loop_length_m: int = 0
    notes: str = ""


class FiberLoopCreate(FiberLoopBase):
    pass


class FiberLoopUpdate(BaseModel):
    segment_index: int | None = None
    lat: float | None = None
    lng: float | None = None
    loop_length_m: int | None = None
    notes: str | None = None


class FiberLoopOut(FiberLoopBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime | None = None


# ---------------------------------------------------------------- splices
class SpliceBase(BaseModel):
    tj_id: int
    cable_a_id: int | None = None
    core_a: int = 0
    cable_b_id: int | None = None
    core_b: int = 0
    splitter_a_id: int | None = None
    splitter_b_id: int | None = None
    port_a: int = 0
    port_b: int = 0
    tray_id: int = 1
    status: str = "active"
    notes: str = ""


class SpliceCreate(SpliceBase):
    pass


class SpliceUpdate(BaseModel):
    cable_a_id: int | None = None
    core_a: int | None = None
    cable_b_id: int | None = None
    core_b: int | None = None
    splitter_a_id: int | None = None
    splitter_b_id: int | None = None
    port_a: int | None = None
    port_b: int | None = None
    tray_id: int | None = None
    status: str | None = None
    notes: str | None = None


class SpliceOut(SpliceBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime | None = None
    cable_a_code: str = ""
    cable_b_code: str = ""
    splitter_a_name: str = ""
    splitter_b_name: str = ""
    splitter_a_ratio: int = 0
    splitter_b_ratio: int = 0


# ---------------------------------------------------------------- cable cuts
class CableCutBase(BaseModel):
    cable_id: int
    lat: float
    lng: float
    notes: str = ""


class CableCutCreate(CableCutBase):
    pass


class CableCutUpdate(BaseModel):
    lat: float | None = None
    lng: float | None = None
    repair_date: datetime | None = None
    splice_tj_id: int | None = None
    status: str | None = None
    notes: str | None = None


class CableCutOut(CableCutBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cut_date: datetime | None = None
    repair_date: datetime | None = None
    splice_tj_id: int | None = None
    status: str = "cut"
    splice_tj_name: str = ""


class CutRecoverySplice(BaseModel):
    core_index: int
    color: str
    cable_a_id: int
    cable_b_id: int


class CutRecoveryResult(BaseModel):
    tj_id: int
    tj_unique_id: str
    tj_name: str
    tj_capacity: int
    cable_id: int
    cable_code: str
    core_count: int
    splices_created: int
    splices: list[CutRecoverySplice]
    unmatched_cores: list[int]


# ---------------------------------------------------------------- approval queue
class ApprovalSubmitRequest(BaseModel):
    """Android / field_team submission for NOC approval queue."""
    entity_type: str  # tj | tj_splitter | cable | user | user_location | splitter | splice_box | infrastructure | loop | cable_cut | other
    action: str = "create"  # create | update | delete
    entity_id: int | None = None  # for updates
    payload: dict  # entity-specific data
    priority: str = "normal"  # low | normal | high | urgent
    location: dict | None = None  # {"lat": ..., "lng": ...}
    photos: list[str] = []  # base64 or filenames (handled by upload endpoint)


class ApprovalReviewRequest(BaseModel):
    review_note: str = ""


class ApprovalReturnRequest(BaseModel):
    correction_note: str


class ApprovalResubmitRequest(BaseModel):
    """Employee resubmits corrected data."""
    payload: dict
    photos: list[str] = []
    correction_note: str = ""


class ApprovalPhotoUpload(BaseModel):
    photo: str  # base64 encoded image data


class ApprovalOut(BaseModel):
    """Full approval request detail for queue display."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    requested_by: int
    submitted_by_name: str = ""
    action: str
    entity_type: str
    entity_id: int | None = None
    payload: dict
    previous_data: dict | None = None
    status: str
    priority: str = "normal"
    reviewed_by: int | None = None
    review_note: str = ""
    correction_note: str = ""
    photos: list[str] = []
    photo_processing_status: str = ""
    photo_processing_error: str = ""
    location: dict | None = None
    created_at: datetime
    reviewed_at: datetime | None = None
    resubmitted_at: datetime | None = None


class ApprovalListOut(BaseModel):
    """Compact approval item for queue list."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    requested_by: int
    submitted_by_name: str = ""
    action: str
    entity_type: str
    entity_id: int | None = None
    entity_label: str = ""  # human-readable entity name for display
    status: str
    priority: str = "normal"
    created_at: datetime
    reviewed_at: datetime | None = None


class PendingCountOut(BaseModel):
    """Pending approval count breakdown."""
    total: int = 0
    by_type: dict[str, int] = {}  # {"tj": 3, "cable": 4, ...}


class ApprovalHistoryEntry(BaseModel):
    """Single audit trail entry."""
    status: str
    user_id: int
    user_name: str = ""
    note: str = ""
    timestamp: datetime | None = None
