export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export interface UserOut {
  id: number;
  username: string;
  role: string;
  is_admin: boolean;
}

export interface UserCreate {
  username: string;
  password: string;
  role: string;
}

export interface UserUpdate {
  username?: string;
  password?: string;
  role?: string;
}

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  global_write: "Global Write",
  global_read: "Global Read",
  noc: "NOC",
  field_team: "Field Team",
};

export const ROLE_OPTIONS = ["admin", "global_write", "global_read", "noc", "field_team"];

export function canWrite(role?: string): boolean {
  return role === "admin" || role === "global_write";
}

export function canOps(role?: string): boolean {
  return role === "admin" || role === "global_write" || role === "noc";
}

export function canManageUsers(role?: string): boolean {
  return role === "admin";
}

export function canViewMap(role?: string): boolean {
  return !!role && role !== "none";
}

export function canEditMap(role?: string): boolean {
  return role === "admin" || role === "global_write";
}

export function canDeleteMap(role?: string): boolean {
  return role === "admin" || role === "global_write";
}

export function canManageLayers(role?: string): boolean {
  return role === "admin" || role === "global_write";
}

export interface OLTDevice {
  id: number;
  name: string;
  ip: string;
  vendor: string;
  pon_type: string;
  access_method: string;
  port: number;
  username: string;
  password: string;
  enable_password: string;
  snmp_community: string;
  snmp_version: string;
  snmp_port: number;
  snmp_enabled: boolean;
  port_capacity: number;
  enabled: boolean;
  status: string;
  noc_id: number | null;
  pop_id: number | null;
  last_scan_at: string | null;
  last_message: string;
  onu_count: number;
  ports: string[];
}

export interface OltHealth {
  id: number;
  olt_id: number;
  cpu_pct: number | null;
  memory_pct: number | null;
  temp_celsius: number | null;
  pon_sfp_tx: number | null;
  pon_sfp_rx: number | null;
  sampled_at: string;
}

export interface MikrotikDevice {
  id: number;
  name: string;
  ip: string;
  api_port: number;
  use_ssl: boolean;
  routeros_version: number;
  username: string;
  password: string;
  enabled: boolean;
  status: string;
  last_scan_at: string | null;
  last_message: string;
  subscriber_count: number;
  active_count: number;
}

export interface SwitchDevice {
  id: number;
  name: string;
  ip: string;
  vendor: string;
  port_count: number;
  access_method: string;
  port: number;
  username: string;
  password: string;
  enable_password: string;
  snmp_enabled: boolean;
  snmp_community: string;
  enabled: boolean;
  status: string;
  noc_id: number | null;
  pop_id: number | null;
  last_scan_at: string | null;
  last_message: string;
  ports: SwitchPort[];
}

export interface SwitchPort {
  id: number;
  switch_id: number;
  name: string;
  status: string;
  speed: string;
  vlan: string;
  mac_address: string;
  description: string;
  last_scan_at: string | null;
}

export interface Onu {
  id: number;
  olt_id: number;
  olt_name: string;
  source: string;
  state: string;
  name: string;
  serial: string;
  mac: string;
  pon_port: string;
  onu_id: number;
  vlan: number;
  rx_power: number | null;
  tx_power: number | null;
  distance: number | null;
  vendor: string;
  sw_version: string;
  lan_status: string;
  bw_in: number | null;
  bw_out: number | null;
  last_mac: string;
  mac_vendor: string;
  mikrotik_ip: string;
  subscriber: string;
  bound: boolean;
  down_reason: string;
  status: string;
  note: string;
  address: string;
  bandwidth_mode: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  phone: string;
  email: string;
  last_seen: string | null;
  created_at: string;
}

export interface Binding {
  mac: string;
  mac_vendor: string;
  olt_id: number;
  olt_name: string;
  olt_port: string;
  mikrotik_id: number | null;
  mikrotik_name: string;
  mikrotik_ip: string;
  mikrotik_interface: string;
  subscriber: string;
  onu_id: number | null;
  onu_name: string;
  bound: boolean;
  last_checked: string;
}

export interface MacEntry {
  mac: string;
  mac_vendor: string;
  port: string;
  vlan: number;
  last_seen: string;
  olt_id: number;
  olt_name: string;
}

export interface PppActiveEntry {
  mac: string;
  mac_vendor: string;
  ip: string;
  interface: string;
  subscriber: string;
  last_seen: string;
  device_id: number;
  device_name: string;
}

export interface PortUsage {
  port: string;
  used: number;
  capacity: number;
  remaining: number;
  active: number;
  bound: number;
  description: string;
}

export interface OltUsage {
  id: number;
  name: string;
  ip: string;
  pon_type: string;
  status: string;
  port_capacity: number;
  port_count: number;
  total_slots: number;
  used_slots: number;
  free_slots: number;
  utilization_pct: number;
  onu_total: number;
  onu_active: number;
  onu_bound: number;
  onu_manual: number;
  ports: PortUsage[];
}

export interface SignalBucket {
  label: string;
  count: number;
}

export interface OpticalAverage {
  avg_rx: number | null;
  samples: number;
  sparkline: [number, string][];
}

export interface OpticalAverages {
  "1d": OpticalAverage;
  "1m": OpticalAverage;
  "3m": OpticalAverage;
}

export interface WeakOnu {
  olt_id: number;
  olt_name: string;
  pon_port: string;
  onu_id: number;
  name: string;
  subscriber: string;
  serial: string;
  state: string;
  rx_power: number | null;
  tx_power: number | null;
}

export interface WeakSignalReport {
  olt_filter: number | null;
  port_filter: string;
  limit: number;
  generated_at: string;
  rows: WeakOnu[];
}

export interface BrandBucket {
  brand: string;
  count: number;
  pct: number;
}

export interface DashboardSummary {
  olt_count: number;
  olt_reachable: number;
  mikrotik_count: number;
  onu_total: number;
  onu_manual: number;
  onu_active: number;
  onu_inactive: number;
  onu_bound: number;
  olt_mac_count: number;
  active_mac_count: number;
  matched_mac_count: number;
  total_slots: number;
  free_slots: number;
  bound_pct: number;
  subscriber_total: number;
  subscriber_active: number;
  signal_hist: SignalBucket[];
  weakest_onus: WeakOnu[];
  router_brands: BrandBucket[];
  mass_down_ports: MassDownPort[];
  olts: OltUsage[];
  last_scan: string | null;
}

export interface NetworkSummary {
  cable_total_km: number;
  cable_by_core: Record<string, number>;
  cable_count: number;
  tj_total: number;
  tj_by_port: Record<string, number>;
  user_total: number;
  user_with_gps: number;
  user_without_gps: number;
  gps_coverage_pct: number;
  splitter_total: number;
}

export interface ScanLog {
  id: number;
  scan_type: string;
  device_id: number;
  device_name: string;
  status: string;
  message: string;
  started_at: string;
  finished_at: string | null;
}

export interface OltWriteLog {
  id: number;
  olt_id: number;
  olt_name: string;
  status: string;
  message: string;
  started_at: string;
  finished_at: string | null;
}

export interface BgpSession {
  id: number;
  device_id: number;
  device_name?: string;
  name: string;
  remote_as: number;
  remote_ip: string;
  local_ip: string;
  local_as: number;
  address_family: string;
  state: string;
  uptime: string;
  prefix_count: number;
  advertised_count: number;
  is_upstream: boolean;
  last_scan_at: string | null;
}

export interface BgpRoute {
  id: number;
  session_id: number;
  prefix: string;
  nexthop: string;
  metric: number;
  community: string;
  received: boolean;
}

export interface BgpPrefixSnapshot {
  id: number;
  session_id: number;
  prefix_count: number;
  advertised_count: number;
  recorded_at: string;
}

export interface SearchOnu {
  id: number;
  olt_id: number;
  olt_name: string;
  pon_port: string;
  name: string;
  serial: string;
  subscriber: string;
  last_mac: string;
  mac_vendor: string;
  state: string;
  bound: boolean;
  down_reason: string;
  status: string;
}

export interface SearchDevice {
  id: number;
  name: string;
  ip: string;
  kind: string;
}

export interface SearchResult {
  onus: SearchOnu[];
  olts: SearchDevice[];
  mikrotiks: SearchDevice[];
}

export interface TelemetryPoint {
  sampled_at: string;
  rx_power: number | null;
  tx_power: number | null;
  rx_mbps: number | null;
  tx_mbps: number | null;
}

export interface MacHistoryEntry {
  mac: string;
  mac_vendor: string;
  changed_at: string;
}

export interface RemotePort {
  port: number;
  scheme: string;
  open: boolean;
}

export interface RemoteAccess {
  ip: string;
  reachable: boolean;
  url: string;
  ports: RemotePort[];
  checked_at: number;
}

export interface RemoteProbeResponse {
  results: Record<string, RemoteAccess>;
}

export interface SubscriberSummary {
  subscriber: string;
  onu_id: number;
  onu_name: string;
  olt_name: string;
  pon_port: string;
  last_mac: string;
  mac_vendor: string;
  mikrotik_ip: string;
  state: string;
  bound: boolean;
  down_reason: string;
  status: string;
  disabled: boolean;
  acs_device_id: number | null;
  rx_power: number | null;
  tx_power: number | null;
  mac_change_count: number;
  last_seen: string | null;
}

export interface SubscriberProfile {
  subscriber: string;
  onu_id: number;
  onu_name: string;
  olt_name: string;
  pon_port: string;
  serial: string;
  last_mac: string;
  mac_vendor: string;
  mikrotik_ip: string;
  state: string;
  bound: boolean;
  can_edit_gps: boolean;
  down_reason: string;
  status: string;
  acs_device_id: number | null;
  address: string;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  phone: string;
  mobile2: string;
  email: string;
  govt_id_type: string;
  govt_id_number: string;
  dob: string;
  landmark: string;
  note: string;
  telemetry: TelemetryPoint[];
  mac_history: MacHistoryEntry[];
  last_seen: string | null;
}

export interface TrafficSample {
  timestamp: number;
  rx_rate: number;
  tx_rate: number;
}

export interface TrafficSession {
  subscriber: string;
  interface: string;
  mikrotik_name: string;
  mikrotik_ip: string;
  status: string;
  samples: TrafficSample[];
  elapsed: number;
  remaining: number;
  error: string;
}

export interface TestResult {
  success: boolean;
  message: string;
}

export interface DownEvent {
  id: number;
  olt_id: number;
  olt_name: string;
  pon_port: string;
  onu_id: number;
  serial: string;
  name: string;
  kind: string;
  reason: string;
  detected_at: string;
  duration_seconds: number | null;
  outage_id: number | null;
}

export interface DownCurrentOnu {
  pon_port: string;
  onu_id: number;
  serial: string;
  name: string;
  reason: string;
  detected_at: string;
}

export interface DownStatus {
  running: boolean;
  olt_id: number | null;
  olt_name: string;
  port: string;
  interval: number | null;
  mass_threshold: number | null;
  last_poll_at: string | null;
  started_at: string | null;
  last_error: string;
  current_down_count: number;
  current_down: DownCurrentOnu[];
}

export interface Outage {
  id: number;
  olt_id: number;
  olt_name: string;
  pon_port: string;
  started_at: string;
  onu_count: number;
  resolved_at: string | null;
  resolved: boolean;
}

export interface MassDownPort {
  olt_id: number;
  olt_name: string;
  port: string;
  label: string;
  count: number;
  power_off_count: number;
  wire_down_count: number;
  reason: string;
}

export interface PortArea {
  olt_id: number;
  port: string;
  label: string;
}

export interface MapPoint {
  onu_id: number;
  olt_id: number;
  olt_name: string;
  pon_port: string;
  name: string;
  subscriber: string;
  serial: string;
  gps_lat: number;
  gps_lng: number;
  gps_accuracy: number | null;
  state: string;
  status: string;
  down_reason: string;
  bound: boolean;
  rx_power: number | null;
  distance: number | null;
  address: string;
  last_seen: string | null;
}

export interface MapPointResponse {
  city_lat: number;
  city_lng: number;
  points: MapPoint[];
}

export interface DownReasonBucket {
  reason: string;
  count: number;
}

export interface PortReport {
  port: string;
  label: string;
  total: number;
  active: number;
  down: number;
  bound: number;
  gps: number;
  online_pct: number;
}

export interface OltReport {
  olt_id: number;
  olt_name: string;
  pon_type: string;
  port_count: number;
  total: number;
  active: number;
  down: number;
  bound: number;
  gps: number;
  online_pct: number;
  ports: PortReport[];
}

export interface ReportSummary {
  total_onus: number;
  total_active: number;
  total_down: number;
  total_bound: number;
  gps_tagged: number;
  gps_coverage_pct: number;
  state: Record<string, number>;
  down_reasons: DownReasonBucket[];
  recent_down_events: number;
  recent_down_events_by_reason: DownReasonBucket[];
  olts: OltReport[];
}

export interface OpticalReportRow {
  olt_id: number;
  olt_name: string;
  pon_port: string;
  onu_id: number;
  subscriber: string;
  name: string;
  serial: string;
  samples: number;
  avg_rx: number | null;
  min_rx: number | null;
  max_rx: number | null;
  last_rx: number | null;
  avg_tx: number | null;
  min_tx: number | null;
  max_tx: number | null;
  last_tx: number | null;
  current_state: string;
  bound: boolean;
  first_sampled: string | null;
  last_sampled: string | null;
}

export interface OpticalReport {
  window_days: number;
  olt_filter: number | null;
  generated_at: string;
  rows: OpticalReportRow[];
}

export interface FluctuationReportRow {
  olt_id: number;
  olt_name: string;
  pon_port: string;
  onu_id: number;
  subscriber: string;
  name: string;
  serial: string;
  samples: number;
  avg_rx: number | null;
  min_rx: number | null;
  max_rx: number | null;
  last_rx: number | null;
  avg_tx: number | null;
  fluctuation: number;
  current_state: string;
}

export interface FluctuationReport {
  window_days: number;
  olt_filter: number | null;
  threshold: number;
  generated_at: string;
  rows: FluctuationReportRow[];
}

export interface DowntimeReportRow {
  olt_id: number;
  olt_name: string;
  pon_port: string;
  onu_id: number;
  subscriber: string;
  name: string;
  serial: string;
  down_events: number;
  outage_events: number;
  total_seconds: number;
  avg_seconds: number;
  max_seconds: number;
  reason: string;
  first_event: string | null;
  last_event: string | null;
}

export interface DowntimeReport {
  window_days: number;
  olt_filter: number | null;
  generated_at: string;
  rows: DowntimeReportRow[];
}

export interface PortReportRow {
  olt_id: number;
  olt_name: string;
  pon_type: string;
  port: string;
  label: string;
  capacity: number;
  used: number;
  remaining: number;
  active: number;
  down: number;
  bound: number;
  gps: number;
  utilization_pct: number;
}

export interface PortReportExport {
  olt_filter: number | null;
  generated_at: string;
  rows: PortReportRow[];
}

export interface Ticket {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigned_to: number | null;
  assigned_name: string;
  created_by: number | null;
  created_by_name: string;
  subscriber: string;
  onu_id: number | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"];
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"];

export interface AcsDevice {
  id: number;
  serial_number: string;
  manufacturer: string;
  oui: string;
  product_class: string;
  model_name: string;
  hardware_version: string;
  software_version: string;
  ip: string;
  mac: string;
  subscriber: string;
  onu_id: number | null;
  online: boolean;
  last_inform: string | null;
  first_seen: string | null;
  last_cpu: number | null;
  last_mem_used: number | null;
  last_mem_total: number | null;
  last_rx_rate: number | null;
  last_tx_rate: number | null;
}

export interface AcsParameter {
  name: string;
  value: string;
}

export interface AcsMetric {
  sampled_at: string;
  cpu: number | null;
  mem_used: number | null;
  mem_total: number | null;
  rx_rate: number | null;
  tx_rate: number | null;
}

export interface AcsJob {
  id: number;
  action: string;
  status: string;
  result: string;
  payload: string;
  created_at: string;
  sent_at: string | null;
  finished_at: string | null;
}

export interface AcsWifiBand {
  instance: number;
  band: string;
  ssid: string;
  passphrase: string;
  enable: boolean | null;
  channel: string;
  standard: string;
  security_mode: string;
}

export interface AcsWifiStatus {
  supported: boolean;
  bands: AcsWifiBand[];
  summary: string;
}

export interface RejectedOnu {
  olt_id: number;
  pon_port: string;
  onu_id: number;
  serial: string;
  reason: string;
  raw_line: string;
  description: string;
  sequence: number | null;
}

export interface CableSegment {
  id: number;
  cable_id: number;
  start_lat: number;
  start_lng: number;
  end_lat: number;
  end_lng: number;
  order_index: number;
}

export interface Cable {
  id: number;
  link_id: string;
  link_name: string;
  code: string;
  core_count: number;
  manufacturer: string;
  manufacturing_year: number;
  cable_type: string;
  route_type: string;
  src_tj_id: number | null;
  dst_tj_id: number | null;
  src_tj_name: string;
  dst_tj_name: string;
  notes: string;
  segments: CableSegment[];
}

export interface TjBox {
  id: number;
  unique_id: string;
  name: string;
  box_type: string;
  tj_port: number;
  capacity: number;
  tray_count: number;
  lat: number;
  lng: number;
  address: string;
  notes: string;
  noc_id: number | null;
  pop_id: number | null;
}

export interface Splitter {
  id: number;
  unique_id: string;
  name: string;
  split_ratio: number;
  tj_box_id: number | null;
  input_core: number;
  output_cores: string;
  lat: number;
  lng: number;
  notes: string;
  tj_box_name: string;
}

export interface FiberLoop {
  id: number;
  cable_id: number;
  segment_index: number;
  lat: number;
  lng: number;
  loop_length_m: number;
  notes: string;
  created_at: string | null;
}

export interface Splice {
  id: number;
  tj_id: number;
  cable_a_id: number | null;
  core_a: number;
  cable_b_id: number | null;
  core_b: number;
  splitter_a_id: number | null;
  splitter_b_id: number | null;
  port_a: number;
  port_b: number;
  tray_id: number;
  status: string;
  notes: string;
  created_at: string | null;
  cable_a_code: string;
  cable_b_code: string;
  splitter_a_name: string;
  splitter_b_name: string;
  splitter_a_ratio: number;
  splitter_b_ratio: number;
}

export interface CableCut {
  id: number;
  cable_id: number;
  lat: number;
  lng: number;
  cut_date: string | null;
  repair_date: string | null;
  splice_tj_id: number | null;
  splice_tj_name: string;
  status: string;
  notes: string;
}

export interface CutRecoverySplice {
  core_index: number;
  color: string;
  cable_a_id: number;
  cable_b_id: number;
}

export interface CutRecoveryResult {
  tj_id: number;
  tj_unique_id: string;
  tj_name: string;
  tj_capacity: number;
  cable_id: number;
  cable_code: string;
  core_count: number;
  splices_created: number;
  splices: CutRecoverySplice[];
  unmatched_cores: number[];
  cable_a_id: number | null;
  cable_a_link_id: string | null;
  cable_a_link_name: string | null;
  cable_b_id: number | null;
  cable_b_link_id: string | null;
  cable_b_link_name: string | null;
}

// ---------------------------------------------------------------- approval queue
export interface ApprovalItem {
  id: number;
  requested_by: number;
  submitted_by_name: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  entity_label: string;
  status: string;
  priority: string;
  created_at: string;
  reviewed_at: string | null;
}

export interface ApprovalDetail {
  id: number;
  requested_by: number;
  submitted_by_name: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  payload: Record<string, unknown>;
  previous_data: Record<string, unknown> | null;
  status: string;
  priority: string;
  reviewed_by: number | null;
  review_note: string;
  correction_note: string;
  photos: string[];
  photo_processing_status: string;
  photo_processing_error: string;
  location: { lat: number; lng: number } | null;
  created_at: string;
  reviewed_at: string | null;
  resubmitted_at: string | null;
}

export interface PendingCount {
  total: number;
  by_type: Record<string, number>;
}

export const APPROVAL_STATUSES = [
  "pending", "approved", "rejected", "returned_for_correction", "resubmitted",
];

export const ENTITY_TYPE_LABELS: Record<string, string> = {
  tj: "TJ",
  tj_splitter: "TJ + Splitter",
  cable: "Cable",
  user: "User",
  user_location: "User Location",
  splitter: "Splitter",
  splice_box: "Splice Box",
  infrastructure: "Infrastructure",
  loop: "Fiber Loop",
  cable_cut: "Cable Cut",
  other: "Other",
};

export const ACTION_LABELS: Record<string, string> = {
  create: "New",
  update: "Update",
  delete: "Delete",
};

export const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  returned_for_correction: "Returned",
  resubmitted: "Resubmitted",
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export function canApprove(role?: string): boolean {
  return role === "admin" || role === "global_write" || role === "noc";
}

export function canSubmit(role?: string): boolean {
  return role === "admin" || role === "global_write" || role === "field_team";
}

// ── Field Photos ──────────────────────────────────────────────────────────────

export interface FieldPhotoItem {
  photo_type: string;
  uploaded: boolean;
  id?: number;
  url?: string;
  file_size?: number;
  width?: number;
  height?: number;
  latitude?: number | null;
  longitude?: number | null;
  gps_accuracy?: number | null;
  captured_at?: string | null;
  captured_by?: string;
  pppoe_username?: string;
  created_at?: string;
}

export interface FieldPhotoListResponse {
  entity_type: string;
  entity_id: string;
  total_required: number;
  totalUploaded: number;
  photos: FieldPhotoItem[];
}

export interface FieldPhotoUploadResponse {
  id: number;
  photo_type: string;
  storage_key: string;
  file_size: number;
  width: number;
  height: number;
  url: string;
}

export const TJ_PHOTO_TYPES = ["overall", "internal", "identification"] as const;
export type TjPhotoType = (typeof TJ_PHOTO_TYPES)[number];

export const TJ_PHOTO_LABELS: Record<TjPhotoType, string> = {
  overall: "Overall View",
  internal: "Internal View",
  identification: "Identification",
};

export const SUBSCRIBER_PHOTO_TYPES = ["overall", "equipment", "identification"] as const;
export type SubscriberPhotoType = (typeof SUBSCRIBER_PHOTO_TYPES)[number];

export const SUBSCRIBER_PHOTO_LABELS: Record<SubscriberPhotoType, string> = {
  overall: "Installation View",
  equipment: "ONU / Equipment",
  identification: "Identification",
};

export interface NocItem {
  id: number;
  name: string;
  address: string;
  gps_lat: number | null;
  gps_lng: number | null;
  contact_name: string;
  contact_phone: string;
  notes: string;
  device_count: number;
  tj_count: number;
  devices: { id: number; name: string; ip: string; status: string; pon_type: string }[];
  tj_boxes: { id: number; unique_id: string; name: string; box_type: string; tj_port: number; lat: number; lng: number }[];
}

export interface PopItem {
  id: number;
  name: string;
  address: string;
  gps_lat: number | null;
  gps_lng: number | null;
  contact_name: string;
  contact_phone: string;
  notes: string;
  device_count: number;
  tj_count: number;
  devices: { id: number; name: string; ip: string; status: string; pon_type: string }[];
  tj_boxes: { id: number; unique_id: string; name: string; box_type: string; tj_port: number; lat: number; lng: number }[];
}

export const NOC_PHOTO_TYPES = ["overall", "equipment_rack", "patch_panel", "identification"] as const;
export type NocPhotoType = (typeof NOC_PHOTO_TYPES)[number];

export const NOC_PHOTO_LABELS: Record<NocPhotoType, string> = {
  overall: "Overall View",
  equipment_rack: "Equipment Rack",
  patch_panel: "Patch Panel",
  identification: "Identification",
};

export const POP_PHOTO_TYPES = ["overall", "equipment", "identification"] as const;
export type PopPhotoType = (typeof POP_PHOTO_TYPES)[number];

export const POP_PHOTO_LABELS: Record<PopPhotoType, string> = {
  overall: "Overall View",
  equipment: "Equipment",
  identification: "Identification",
};

// ── Lead Management ───────────────────────────────────────────────────

export interface Lead {
  id: number;
  customer_name: string;
  mobile_primary: string;
  mobile_secondary: string;
  road_area: string;
  ward: string;
  package_name: string;
  service_charge: number | null;
  lead_source: string;
  assigned_to: number | null;
  assigned_to_name: string;
  status: string;
  priority: string;
  expected_connection_date: string | null;
  customer_address: string;
  notes: string;
  latitude: number | null;
  longitude: number | null;
  follow_up_date: string | null;
  follow_up_notes: string;
  lost_reason: string;
  converted_to_subscriber: string | null;
  converted_at: string | null;
  created_by: number | null;
  created_by_name: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface LeadDashboard {
  total: number;
  new_count: number;
  follow_up: number;
  interested: number;
  installation_pending: number;
  successful: number;
  lost: number;
  conversion_rate: number;
  total_service_charge: number;
}

export interface UserLeadPerformance {
  user_id: number;
  user_name: string;
  total_leads: number;
  successful: number;
  pending: number;
  lost: number;
  conversion_rate: number;
  total_service_charge: number;
  avg_service_charge: number;
}

export interface MonthlySummary {
  month: string;
  total_leads: number;
  successful: number;
  lost: number;
}

export const LEAD_STATUSES = ["new", "contacted", "follow_up", "interested", "installation_pending", "successful", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  follow_up: "Follow-up",
  interested: "Interested",
  installation_pending: "Installation Pending",
  successful: "Successful",
  lost: "Lost",
};

export const LEAD_STATUS_COLORS: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  contacted: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  follow_up: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  interested: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300",
  installation_pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  successful: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  lost: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

export const LEAD_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LEAD_PRIORITY_LABELS: Record<LeadPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const LEAD_PRIORITY_COLORS: Record<LeadPriority, string> = {
  low: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  normal: "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300",
  high: "bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-300",
  urgent: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300",
};

export const LEAD_SOURCES = ["walk_in", "referral", "phone_call", "online", "field_visit", "other"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  walk_in: "Walk-in",
  referral: "Referral",
  phone_call: "Phone Call",
  online: "Online",
  field_visit: "Field Visit",
  other: "Other",
};