# Infra NEXUS API Documentation

Complete reference for all 115 API endpoints.

---

## Table of Contents

1. [Authentication](#authentication)
2. [Health Check](#health-check)
3. [Auth](#1-auth)
4. [Devices](#2-devices)
5. [ONUs](#3-onus)
6. [Bindings](#4-bindings)
7. [Dashboard](#5-dashboard)
8. [Search](#6-search)
9. [Subscribers](#7-subscribers)
10. [Down Detection](#8-down-detection)
11. [Map](#9-map)
12. [Users](#10-users)
11. [Reports](#11-reports)
12. [Tickets](#12-tickets)
13. [ACS (TR-069)](#13-acs-tr-069)
14. [Fiber](#14-fiber)
15. [NOC/POP](#15-noc-pop)

---

## Authentication

All endpoints require JWT authentication unless noted. Include the token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

### Get Current User

```http
GET /api/auth/me
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "is_admin": true
}
```

### User Roles

| Role | Permissions |
|------|------------|
| `admin` | Full access: create, update, delete, scan, bind |
| `ops` | Scan, bind, port control, down detection, reports |
| `read` | Read-only access to all data |

---

## Health Check

```http
GET /api/health
```

No authentication required.

**Response:**
```json
{
  "status": "ok"
}
```

---

## 1. Auth

### POST /api/auth/login

Authenticate user, return JWT token.

**Request:**
```json
{
  "username": "string",
  "password": "string"
}
```

**Response:**
```json
{
  "access_token": "string",
  "token_type": "bearer"
}
```

### GET /api/auth/me

Get current authenticated user.

**Response:** `UserOut`
```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "is_admin": true
}
```

---

## 2. Devices

### OLTs

#### GET /api/devices/olts

List all OLT devices with ONU counts and ports.

**Response:** `list[OLTDeviceOut]`
```json
[
  {
    "id": 1,
    "name": "NOC-GPON-1",
    "ip": "172.16.96.5",
    "vendor": "bdcom",
    "pon_type": "gpon",
    "access_method": "telnet",
    "port": 23,
    "username": "admin",
    "password": "...",
    "status": "reachable",
    "enabled": true,
    "onu_count": 120,
    "onu_active": 95,
    "onu_bound": 80,
    "ports": ["GPON0/1", "GPON0/2"],
    "noc_id": 1,
    "pop_id": null,
    "last_scan": "2026-08-25T10:30:00"
  }
]
```

#### POST /api/devices/olts

Create an OLT device. Requires `write` role.

**Request:**
```json
{
  "name": "NOC-GPON-1",
  "ip": "172.16.96.5",
  "vendor": "bdcom",
  "pon_type": "gpon",
  "access_method": "telnet",
  "port": 23,
  "username": "admin",
  "password": "@!7l3q#Z",
  "snmp_community": null,
  "snmp_enabled": false,
  "port_capacity": 128,
  "enabled": true,
  "noc_id": 1,
  "pop_id": null
}
```

**Response:** `OLTDeviceOut` (201)

#### PUT /api/devices/olts/{olt_id}

Update an OLT device. Requires `write` role.

**Request:** Same as POST, all fields optional.

**Response:** `OLTDeviceOut`

#### DELETE /api/devices/olts/{olt_id}

Delete an OLT device. Requires `write` role. Returns 204.

#### POST /api/devices/olts/{olt_id}/test

Test connectivity to an OLT. Requires `ops` role.

**Response:**
```json
{
  "success": true,
  "message": "Connection successful"
}
```

#### POST /api/devices/olts/{olt_id}/scan

Scan an OLT for ONUs. Requires `ops` role.

**Response:**
```json
{
  "success": true,
  "message": "Scan complete: 120 ONUs found",
  "log_id": 42
}
```

#### POST /api/devices/olts/{olt_id}/rejected

Discover rejected/unauthorized ONUs on an OLT. Requires `ops` role.

**Response:** `list[RejectedOnu]`
```json
[
  {
    "pon_port": "EPON0/1",
    "onu_id": 5,
    "mac": "AA:BB:CC:DD:EE:FF",
    "state": "auth_fail",
    "vendor": "BDCOM",
    "serial": "BDLO-12345678"
  }
]
```

#### POST /api/devices/olts/{olt_id}/authorize-onu

Authorize/add a rejected ONU to the OLT and app. Requires `write` role.

**Request:**
```json
{
  "pon_port": "EPON0/1",
  "onu_id": 5,
  "serial": "BDLO-12345678",
  "name": "Customer ONU"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "ONU authorized and added"
}
```

#### POST /api/devices/olts/{olt_id}/delete-onu

Delete/deregister an ONU from the OLT. Requires `write` role.

**Request:**
```json
{
  "pon_port": "EPON0/1",
  "onu_id": 5
}
```

**Response:**
```json
{
  "ok": true,
  "message": "ONU deleted from OLT"
}
```

#### POST /api/devices/olts/{olt_id}/add-onu

Add/register an ONU on the OLT and app inventory. Requires `write` role.

**Request:**
```json
{
  "pon_port": "EPON0/1",
  "identifier": "AA:BB:CC:DD:EE:FF",
  "description": "Customer Router",
  "sequence": 1
}
```

**Response:**
```json
{
  "ok": true,
  "message": "ONU added",
  "pon_port": "EPON0/1",
  "onu_id": 125
}
```

#### POST /api/devices/olts/{olt_id}/set-description

Set ONU description on the OLT. Requires `write` role.

**Request:**
```json
{
  "pon_port": "EPON0/1",
  "onu_id": 5,
  "description": "Customer Router"
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Description set"
}
```

#### POST /api/devices/olts/{olt_id}/set-bandwidth

Set EPON ONU bandwidth (SLA) on the OLT. Requires `write` role.

**Request:**
```json
{
  "pon_port": "EPON0/1",
  "onu_id": 5,
  "mode": "100m"
}
```

Mode values: `100m`, `1g`

**Response:**
```json
{
  "ok": true,
  "message": "Bandwidth set to 100 Mbps"
}
```

### Mikrotiks

#### GET /api/devices/mikrotiks

List all Mikrotik devices.

**Response:** `list[MikrotikOut]`
```json
[
  {
    "id": 1,
    "name": "Mikrotik-CCR1036",
    "ip": "172.16.0.1",
    "api_port": 8728,
    "use_ssl": false,
    "routeros_version": "7",
    "username": "admin",
    "password": "...",
    "status": "reachable",
    "enabled": true,
    "last_scan": "2026-08-25T10:30:00"
  }
]
```

#### POST /api/devices/mikrotiks

Create a Mikrotik device. Requires `write` role.

**Request:**
```json
{
  "name": "Mikrotik-CCR1036",
  "ip": "172.16.0.1",
  "api_port": 8728,
  "use_ssl": false,
  "routeros_version": "7",
  "username": "admin",
  "password": "password",
  "enabled": true
}
```

**Response:** `MikrotikOut` (201)

#### PUT /api/devices/mikrotiks/{device_id}

Update a Mikrotik device. Requires `write` role.

#### DELETE /api/devices/mikrotiks/{device_id}

Delete a Mikrotik device. Requires `write` role. Returns 204.

#### POST /api/devices/mikrotiks/{device_id}/test

Test connectivity. Requires `ops` role.

#### POST /api/devices/mikrotiks/{device_id}/scan

Scan for PPP sessions. Requires `ops` role.

### Switches

#### GET /api/devices/switches

List all switch devices with ports.

**Response:** `list[SwitchOut]`

#### POST /api/devices/switches

Create a switch device. Requires `write` role.

**Request:**
```json
{
  "name": "Core-Switch-1",
  "ip": "172.16.1.1",
  "vendor": "generic",
  "port_count": 48,
  "access_method": "telnet",
  "username": "admin",
  "password": "password",
  "noc_id": 1,
  "pop_id": 1
}
```

#### PUT /api/devices/switches/{switch_id}

Update a switch. Requires `write` role.

#### DELETE /api/devices/switches/{switch_id}

Delete a switch. Requires `write` role. Returns 204.

#### POST /api/devices/switches/{switch_id}/test

Test connectivity. Requires `ops` role.

#### POST /api/devices/switches/{switch_id}/scan

Scan for port status. Requires `ops` role.

---

## 3. ONUs

#### GET /api/onus

List ONUs with filters.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `olt_id` | int | Filter by OLT |
| `pon_port` | string | Filter by PON port |
| `state` | string | Filter by state (active/inactive) |
| `source` | string | Filter by source (scan/manual) |
| `search` | string | Search by name/serial/mac |
| `bound` | bool | Filter bound/unbound |

**Response:** `list[OnuOut]`

#### GET /api/onus/{onu_id}

Get a single ONU by ID.

#### POST /api/onus

Add an ONU to app inventory (application-only, no OLT interaction). Requires `write` role.

**Request:**
```json
{
  "olt_id": 1,
  "name": "Customer ONU",
  "serial": "BDLO-12345678",
  "mac": "AA:BB:CC:DD:EE:FF",
  "pon_port": "GPON0/1",
  "onu_id": 5,
  "vlan": 100,
  "note": "Rampura area"
}
```

#### PUT /api/onus/{onu_id}

Update ONU fields. GPS/address updates require GPS-write role or assigned ticket.

**Request:**
```json
{
  "name": "Updated Name",
  "address": "123 Main St",
  "gps_lat": 23.8103,
  "gps_lng": 90.4125,
  "phone": "+8801712345678",
  "note": "Premium customer"
}
```

#### DELETE /api/onus/{onu_id}

Remove an ONU from the application (app-only removal). Requires `write` role. Returns 204.

#### POST /api/onus/port-control

Enable or disable an ONU Ethernet/UNI port on the OLT via CLI. Requires `write` role.

**Request:**
```json
{
  "olt_id": 1,
  "pon_port": "GPON0/1",
  "onu_id": 5,
  "port_id": 1,
  "enable": true
}
```

**Response:**
```json
{
  "ok": true,
  "message": "Port enabled"
}
```

---

## 4. Bindings

#### POST /api/bindings/run

Trigger MAC binding process. Requires `ops` role.

**Response:**
```json
{
  "matched": 150,
  "new_bindings": 12,
  "unmatched": 8
}
```

#### GET /api/bindings

List MAC-to-ONU bindings.

**Query:** `bound?` (bool) - filter by bound/unbound

**Response:** `list[BindingOut]`

#### GET /api/bindings/olts

List MAC entries learned from OLTs.

**Response:** `list[MacEntryOut]`

#### GET /api/bindings/active

List live PPPoE sessions from Mikrotik.

**Response:** `list[PppActiveOut]`

---

## 5. Dashboard

#### GET /api/dashboard

Dashboard summary with all KPI data.

**Response:** `DashboardSummary`
```json
{
  "olt_count": 5,
  "olt_reachable": 4,
  "mikrotik_count": 3,
  "onu_total": 2400,
  "onu_manual": 15,
  "onu_active": 1800,
  "onu_inactive": 600,
  "onu_bound": 1500,
  "olt_mac_count": 1800,
  "active_mac_count": 1500,
  "matched_mac_count": 1450,
  "total_slots": 1024,
  "free_slots": 624,
  "bound_pct": 62.5,
  "subscriber_total": 1500,
  "subscriber_active": 1200,
  "signal_hist": [
    { "label": "<= -28 dBm", "count": 50 },
    { "label": "-28 to -24", "count": 120 },
    { "label": "-24 to -20", "count": 800 },
    { "label": "-20 to -16", "count": 700 },
    { "label": ">= -16 dBm", "count": 130 }
  ],
  "weakest_onus": [],
  "router_brands": [
    { "brand": "TP-Link", "count": 450 },
    { "brand": "Tenda", "count": 300 }
  ],
  "mass_down_ports": [],
  "olts": [],
  "last_scan": "2026-08-25T10:30:00"
}
```

#### GET /api/dashboard/mass-downs

Live mass-outage areas.

**Response:** `list[MassDownPort]`

#### GET /api/dashboard/optical-averages

Network-wide average RX optical power with sparkline data.

**Response:**
```json
{
  "1d": {
    "avg_rx": -20.47,
    "samples": 241194,
    "sparkline": [
      [-20.45, "2026-08-24T17:00:00+00:00"],
      [-20.43, "2026-08-24T18:00:00+00:00"]
    ]
  },
  "1m": {
    "avg_rx": -20.44,
    "samples": 2216475,
    "sparkline": [...]
  },
  "3m": {
    "avg_rx": -20.44,
    "samples": 2216475,
    "sparkline": [...]
  }
}
```

#### GET /api/scans

List scan log entries.

**Query:** `limit?` (int, default 50, max 500)

**Response:** `list[ScanLogOut]`

---

## 6. Search

#### GET /api/search

Global search across ONUs, OLTs, and Mikrotiks.

**Query:** `q` (string, min 2 chars, max 80 chars)

**Response:**
```json
{
  "onus": [
    { "id": 1, "name": "Customer ONU", "serial": "BDLO-123...", "olt_name": "NOC-GPON-1" }
  ],
  "olts": [
    { "id": 1, "name": "NOC-GPON-1", "ip": "172.16.96.5" }
  ],
  "mikrotiks": [
    { "id": 1, "name": "Mikrotik-CCR1036", "ip": "172.16.0.1" }
  ]
}
```

---

## 7. Subscribers

#### GET /api/subscribers

List subscribers (ONUs with PPPoE usernames).

**Query:** `q?` (search), `limit?` (default 500, max 2000)

**Response:** `list[SubscriberSummary]`

#### GET /api/subscribers/{subscriber}

Full subscriber profile including telemetry, MAC history, contact info, GPS.

**Query:** `hours?` (default 168, max 8760)

**Response:** `SubscriberProfile`

#### GET /api/subscribers/{subscriber}/telemetry

Telemetry data with server-side downsampling.

**Query:** `hours?` (default 168, max 8760)

Downsampling rules:
- Raw 5-min samples for <= 7 days
- Hourly averages for 7-30 days
- Daily averages for 30 days - 1 year

**Response:** `list[TelemetryPoint]`
```json
[
  {
    "sampled_at": "2026-08-25T10:30:00",
    "rx_power": -18.5,
    "tx_power": 2.3,
    "rx_mbps": 45.2,
    "tx_mbps": 12.1
  }
]
```

#### GET /api/subscribers/{subscriber}/wifi

Read subscriber router WiFi config.

**Response:** `AcsWifiStatusOut`

#### POST /api/subscribers/remote/probe

Probe a batch of IPs for remote management ports.

**Request:**
```json
{
  "ips": ["172.16.0.1", "172.16.0.2"]
}
```

**Response:**
```json
{
  "results": {
    "172.16.0.1": { "reachable": true, "ports": [80, 443] },
    "172.16.0.2": { "reachable": false, "ports": [] }
  }
}
```

#### GET /api/subscribers/{subscriber}/remote

Probe a single subscriber's IP for remote access.

---

## 8. Down Detection

#### POST /api/downs/start

Start live ONU down detection. Requires `ops` role.

**Request:**
```json
{
  "olt_id": 1,
  "port": "GPON0/1",
  "interval": 60,
  "mass_threshold": 5
}
```

**Response:** `DownStatusOut`

#### POST /api/downs/stop

Stop the running detection session. Requires `ops` role.

#### GET /api/downs/status

Get current detection session status.

#### GET /api/downs/events

List down events.

**Query:** `olt_id?`, `port?`, `kind?` (down/recovery), `limit?` (default 200, max 2000)

**Response:** `list[DownEventOut]`

#### GET /api/downs/outages

List outage records.

**Query:** `resolved?` (bool), `limit?` (default 50, max 500)

**Response:** `list[OutageOut]`

#### GET /api/downs/ports

Distinct PON port bases for an OLT.

**Query:** `olt_id` (required)

#### GET /api/downs/areas

Area labels for ports.

**Query:** `olt_id?`

#### PUT /api/downs/areas

Create or update an area label. Requires `write` role.

**Request:**
```json
{
  "olt_id": 1,
  "port": "GPON0/1",
  "label": "Rampura South"
}
```

---

## 9. Map

#### GET /api/map/points

ONUs for the network map with GPS coordinates.

**Response:**
```json
{
  "city_lat": 23.8103,
  "city_lng": 90.4125,
  "points": [
    {
      "id": 1,
      "name": "Customer ONU",
      "lat": 23.8103,
      "lng": 90.4125,
      "state": "active",
      "olt_name": "NOC-GPON-1",
      "pon_port": "GPON0/1"
    }
  ]
}
```

---

## 10. Users

#### GET /api/users

List all users. Admin only.

#### POST /api/users

Create a new user. Admin only.

**Request:**
```json
{
  "username": "operator1",
  "password": "securepass",
  "role": "ops"
}
```

#### PUT /api/users/{user_id}

Update a user. Admin only.

#### DELETE /api/users/{user_id}

Delete a user (cannot delete self). Admin only. Returns 204.

---

## 11. Reports

#### GET /api/reports

High-level report: OLT/port summaries, state distribution, down reasons, GPS coverage.

**Query:** `olt_id?`, `days?` (default 30, 1-90)

**Response:** `ReportSummary`

#### GET /api/reports/optical

Optical power report: per-ONU RX/TX statistics.

**Query:** `olt_id?`, `port?`, `days?` (default 7), `sort_by?`, `order?`, `threshold?`

**Response:** `OpticalReport`

#### GET /api/reports/optical/export

Export optical report. Returns file download.

**Query:** `format?` (xlsx/pdf), same filters as above.

#### GET /api/reports/fluctuation

Power fluctuation report: ONUs with RX variation > threshold.

**Query:** `olt_id?`, `port?`, `days?` (default 7), `threshold?` (default 3.0 dB)

**Response:** `FluctuationReport`

#### GET /api/reports/fluctuation/export

Export fluctuation report. Returns file download.

#### GET /api/reports/downtime

Downtime report: down/outage events aggregated per ONU.

**Query:** `olt_id?`, `port?`, `days?` (default 7)

**Response:** `DowntimeReport`

#### GET /api/reports/downtime/export

Export downtime report. Returns file download.

#### GET /api/reports/ports

Per-PON-port capacity/utilization report.

**Query:** `olt_id?`, `port?`

**Response:** `PortReportExport`

#### GET /api/reports/ports/export

Export port utilization report. Returns file download.

#### GET /api/reports/weakest

Weakest optical signals (lowest current RX power).

**Query:** `olt_id?`, `port?`, `limit?` (default 10, max 200)

**Response:** `WeakSignalReport`

#### GET /api/reports/weakest/export

Export weakest signals report. Returns file download.

---

## 12. Tickets

#### GET /api/tickets

List tickets. Non-admins see only their assigned tickets.

#### POST /api/tickets

Create a new ticket. Requires `write` role.

**Request:**
```json
{
  "title": "ONU not connecting",
  "description": "Customer reports no internet",
  "priority": "high",
  "assigned_to": 2,
  "subscriber": "pppoe-customer-1",
  "onu_id": 45
}
```

#### PUT /api/tickets/{ticket_id}

Update a ticket.

**Request:**
```json
{
  "status": "in_progress",
  "priority": "critical",
  "notes": "Technician dispatched"
}
```

#### DELETE /api/tickets/{ticket_id}

Delete a ticket. Requires `write` role. Returns 204.

---

## 13. ACS (TR-069)

#### POST /api/acs/cwmp

TR-069 (CWMP) endpoint called by CPE home routers. **No authentication required** (public endpoint).

#### GET /api/acs/devices

List all ACS devices.

**Query:** `online?` (bool)

#### GET /api/acs/devices/{device_id}

Get a single ACS device.

#### GET /api/acs/devices/{device_id}/parameters

Get device TR-069 parameters.

**Query:** `search?` (string)

#### GET /api/acs/devices/{device_id}/wifi

Current WiFi config per band from TR-069 parameters.

#### GET /api/acs/devices/{device_id}/metrics

Device metrics (CPU, memory, bandwidth).

**Query:** `hours?` (default 24, max 168)

#### GET /api/acs/devices/{device_id}/jobs

List queued/executed TR-069 jobs.

#### POST /api/acs/devices/{device_id}/wifi

Enqueue WiFi SSID/passphrase change via TR-069. Requires `ops` role.

**Request:**
```json
{
  "ssid": "NewWiFiName",
  "passphrase": "newpassword123",
  "enable": true,
  "band": "2.4g"
}
```

#### POST /api/acs/devices/{device_id}/wan

Enqueue WAN configuration push via TR-069. Requires `ops` role.

**Request:**
```json
{
  "addressing_type": "static",
  "ip_address": "172.16.0.100",
  "subnet_mask": "255.255.255.0",
  "default_gateway": "172.16.0.1",
  "dns_servers": ["8.8.8.8", "8.8.4.4"]
}
```

#### POST /api/acs/devices/{device_id}/firmware

Enqueue firmware update via TR-069. Requires `ops` role.

**Request:**
```json
{
  "url": "http://firmware.example.com/v2.0.bin"
}
```

#### POST /api/acs/devices/{device_id}/reboot

Enqueue device reboot via TR-069. Requires `ops` role.

---

## 14. Fiber

### Cables

#### GET /api/fiber/cables

List all fiber cables with route segments.

**Response:** `list[CableOut]`
```json
[
  {
    "id": 1,
    "link_id": "LINK-1001",
    "link_name": "NOC to Rampura",
    "code": "12C-2024-001",
    "core_count": 12,
    "manufacturer": "FIBERHOME",
    "manufacturing_year": 2024,
    "cable_type": "ADSS",
    "src_tj_id": 1,
    "dst_tj_id": 5,
    "src_name": "TJ-5001",
    "dst_name": "TJ-5005",
    "distance_m": 1250.5,
    "segments": [
      { "lat": 23.81, "lng": 90.41 },
      { "lat": 23.82, "lng": 90.42 }
    ],
    "notes": ""
  }
]
```

#### POST /api/fiber/cables

Create a cable. Auto-generates `link_id`. Auto-routes via OSRM if `src_tj_id` and `dst_tj_id` provided. Requires `write` role.

**Request:**
```json
{
  "link_name": "NOC to Rampura",
  "code": "12C-2024-001",
  "core_count": 12,
  "manufacturer": "FIBERHOME",
  "manufacturing_year": 2024,
  "cable_type": "ADSS",
  "src_tj_id": 1,
  "dst_tj_id": 5,
  "route_type": "road",
  "notes": ""
}
```

#### PUT /api/fiber/cables/{cable_id}

Update a cable. Requires `write` role.

#### DELETE /api/fiber/cables/{cable_id}

Delete a cable. Requires `write` role. Returns 204.

### TJ Boxes (Termination/Junction Boxes)

#### GET /api/fiber/tj-boxes

List all TJ boxes.

**Response:** `list[TjBoxOut]`
```json
[
  {
    "id": 1,
    "unique_id": "TJ-5001",
    "name": "Rampura TJ",
    "box_type": "enclosure",
    "tj_port": 8,
    "capacity": 96,
    "tray_count": 8,
    "lat": 23.8103,
    "lng": 90.4125,
    "address": "Rampura Bazar",
    "notes": ""
  }
]
```

#### POST /api/fiber/tj-boxes

Create a TJ box. Auto-generates `unique_id`. Requires `write` role.

**Request:**
```json
{
  "name": "Rampura TJ",
  "box_type": "enclosure",
  "tj_port": 8,
  "capacity": 96,
  "tray_count": 8,
  "lat": 23.8103,
  "lng": 90.4125,
  "address": "Rampura Bazar"
}
```

Box types: `home`, `regular`, `enclosure`, `dome`

#### PUT /api/fiber/tj-boxes/{box_id}

Update a TJ box. Requires `write` role.

#### DELETE /api/fiber/tj-boxes/{box_id}

Delete a TJ box (cascades to hosted splitters). Requires `write` role. Returns 204.

### Splitters

#### GET /api/fiber/splitters

List all splitters.

#### POST /api/fiber/splitters

Create a splitter. Auto-generates `unique_id`. GPS auto-filled from TJ box. Requires `write` role.

**Request:**
```json
{
  "name": "SP-1001",
  "split_ratio": "1:8",
  "tj_box_id": 1,
  "input_core": 1,
  "output_cores": "1,2,3,4,5,6,7,8",
  "lat": 23.8103,
  "lng": 90.4125
}
```

#### PUT /api/fiber/splitters/{splitter_id}

Update a splitter. Requires `write` role.

#### DELETE /api/fiber/splitters/{splitter_id}

Delete a splitter. Requires `write` role. Returns 204.

### Fiber Loops

#### GET /api/fiber/loops

List fiber loops. **Query:** `cable_id?`

#### POST /api/fiber/loops

Create a fiber loop. Requires `write` role.

#### PUT /api/fiber/loops/{loop_id}

Update a fiber loop. Requires `write` role.

#### DELETE /api/fiber/loops/{loop_id}

Delete a fiber loop. Requires `write` role. Returns 204.

### Cable Cuts

#### GET /api/fiber/cuts

List cable cuts. **Query:** `cable_id?`, `status?`

#### POST /api/fiber/cuts

Report a cable cut. Requires `write` role.

**Request:**
```json
{
  "cable_id": 1,
  "lat": 23.815,
  "lng": 90.418,
  "notes": "Construction damage"
}
```

#### PUT /api/fiber/cuts/{cut_id}

Update a cable cut (status, repair date, splice TJ). Requires `write` role.

#### DELETE /api/fiber/cuts/{cut_id}

Delete a cable cut record. Requires `write` role. Returns 204.

### Splices

#### GET /api/fiber/splices

List splices. **Query:** `tj_id?`, `limit?` (default 200), `offset?`

**Response:** `list[SpliceOut]`
```json
[
  {
    "id": 1,
    "tj_id": 1,
    "cable_a_id": 1,
    "cable_a_code": "12C-2024-001",
    "core_a": 1,
    "cable_b_id": 2,
    "cable_b_code": "24C-2024-002",
    "core_b": 1,
    "status": "active",
    "notes": ""
  }
]
```

Splice statuses: `active`, `spare`, `broken`

#### POST /api/fiber/splices

Create a splice. Requires `write` role.

**Request:**
```json
{
  "tj_id": 1,
  "cable_a_id": 1,
  "core_a": 1,
  "cable_b_id": 2,
  "core_b": 1,
  "status": "active"
}
```

#### PUT /api/fiber/splices/{splice_id}

Update a splice. Requires `write` role.

#### DELETE /api/fiber/splices/{splice_id}

Delete a splice. Requires `write` role. Returns 204.

#### GET /api/fiber/splices/unused-cores

Return unused (spare) cores for each cable connected to a TJ.

**Query:** `tj_id` (required)

**Response:**
```json
[
  {
    "cable_id": 1,
    "cable_code": "12C-2024-001",
    "core_count": 12,
    "spare_cores": [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  }
]
```

### Export / Import

#### GET /api/fiber/export

Export entire fiber network (TJ boxes, splitters, cables) as XLSX. Returns file download.

#### POST /api/fiber/import

Import fiber network from XLSX file. Requires `write` role.

**Request:** `multipart/form-data` with `file` field.

**Response:**
```json
{
  "tj_boxes": 15,
  "splitters": 8,
  "cables": 22
}
```

### Map Data

#### GET /api/fiber/noc-pop-map

Get NOC and POP locations with assigned devices.

**Response:**
```json
{
  "nocs": [
    {
      "id": 1,
      "name": "Main NOC",
      "lat": 23.8103,
      "lng": 90.4125,
      "device_count": 5,
      "devices": ["NOC-GPON-1", "NOC-EPON-2"]
    }
  ],
  "pops": [
    {
      "id": 1,
      "name": "Rampura POP",
      "lat": 23.815,
      "lng": 90.418,
      "device_count": 2,
      "devices": ["Switch-1", "Switch-2"]
    }
  ]
}
```

---

## 15. NOC/POP

### NOCs

#### GET /api/noc-pop/nocs

List all NOCs with device counts.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Main NOC",
    "address": "123 Telecom Road",
    "gps_lat": 23.8103,
    "gps_lng": 90.4125,
    "contact_name": "John Doe",
    "contact_phone": "+8801712345678",
    "notes": "Primary operations center",
    "created_at": "2026-08-01T00:00:00",
    "device_count": 5
  }
]
```

#### POST /api/noc-pop/nocs

Create a NOC.

**Request:**
```json
{
  "name": "Main NOC",
  "address": "123 Telecom Road",
  "gps_lat": 23.8103,
  "gps_lng": 90.4125,
  "contact_name": "John Doe",
  "contact_phone": "+8801712345678",
  "notes": "Primary operations center"
}
```

#### PUT /api/noc-pop/nocs/{noc_id}

Update a NOC.

#### DELETE /api/noc-pop/nocs/{noc_id}

Delete a NOC.

### POPs

#### GET /api/noc-pop/pops

List all POPs with device counts.

#### POST /api/noc-pop/pops

Create a POP. Same schema as NOC.

#### PUT /api/noc-pop/pops/{pop_id}

Update a POP.

#### DELETE /api/noc-pop/pops/{pop_id}

Delete a POP.

### Device Assignment

#### PUT /api/noc-pop/assign-device/{device_id}

Assign an OLT/Switch device to a NOC and/or POP.

**Request:**
```json
{
  "noc_id": 1,
  "pop_id": 2
}
```

---

## Response Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 204 | No Content (successful delete) |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not Found |
| 422 | Unprocessable Entity (request format error) |
| 500 | Internal Server Error |

## Rate Limiting

No rate limiting is currently implemented. Consider adding for production multi-user deployments.

## Error Response Format

```json
{
  "detail": "Error message describing what went wrong"
}
```

## Pagination

Most list endpoints support `limit` and `offset` query parameters:

```
GET /api/onus?limit=50&offset=100
```

Default limits vary by endpoint (see individual endpoint documentation above).
