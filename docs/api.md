# API Reference

## Infra NEXUS — Complete API Documentation

**Base URL:** `https://nexus.qbinternet.com/api` (production)  
**Local:** `http://localhost:8080/api`  
**Auth:** JWT Bearer token in `Authorization` header  
**Content-Type:** `application/json` (except file uploads)

---

## 1. Authentication

### POST `/api/auth/login`

Authenticate user and receive JWT token.

**Request:**
```json
{
  "username": "admin",
  "password": "admin123"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

### GET `/api/auth/me`

Get current authenticated user profile.

**Headers:** `Authorization: Bearer <token>`

**Response (200):**
```json
{
  "id": 1,
  "username": "admin",
  "role": "admin",
  "is_admin": true,
  "created_at": "2026-01-01T00:00:00Z"
}
```

---

## 2. Device Management

### OLTs

#### GET `/api/devices/olts`

List all OLTs with ONU counts and ports.

**Response (200):**
```json
[
  {
    "id": 1,
    "name": "OLT-01",
    "ip": "192.168.1.10",
    "vendor": "bdcom",
    "pon_type": "epon",
    "access_method": "both",
    "port": 23,
    "username": "admin",
    "password": "***",
    "enable_password": "***",
    "snmp_community": "public",
    "snmp_version": "2c",
    "snmp_port": 161,
    "snmp_enabled": true,
    "port_capacity": 32,
    "port_descriptions": {"EPON0/1": "Zone A"},
    "enabled": true,
    "status": "reachable",
    "noc_id": 1,
    "pop_id": 1,
    "onu_count": 128,
    "ports": [
      {"name": "EPON0/1", "onu_count": 16, "capacity": 32}
    ],
    "last_scan_at": "2026-08-31T10:00:00Z",
    "last_message": "Scan complete: 128 ONUs found",
    "created_at": "2026-01-01T00:00:00Z"
  }
]
```

#### POST `/api/devices/olts`

Create a new OLT device.

**Guard:** `require_write`  
**Request:**
```json
{
  "name": "OLT-02",
  "ip": "192.168.1.11",
  "vendor": "bdcom",
  "pon_type": "gpon",
  "access_method": "telnet",
  "port": 23,
  "username": "admin",
  "password": "password",
  "enable_password": "enable",
  "snmp_community": "public",
  "snmp_enabled": true,
  "port_capacity": 32,
  "noc_id": 1,
  "pop_id": 1
}
```

#### PUT `/api/devices/olts/{olt_id}`

Update an OLT device. All fields optional.

**Guard:** `require_write`

#### DELETE `/api/devices/olts/{olt_id}`

Delete an OLT and all associated ONUs.

**Guard:** `require_write`  
**Response:** `204 No Content`

#### POST `/api/devices/olts/{olt_id}/test`

Test connectivity to an OLT via telnet/SSH.

**Guard:** `require_ops`  
**Response:**
```json
{
  "ok": true,
  "message": "Connected successfully"
}
```

#### POST `/api/devices/olts/{olt_id}/scan`

Scan an OLT for ONUs (inventory sync).

**Guard:** `require_ops`  
**Response:**
```json
{
  "ok": true,
  "message": "Scan complete: 128 ONUs found",
  "log_id": 42
}
```

#### GET `/api/devices/olts/{olt_id}/rejected`

Discover rejected/unauthorized ONUs on an OLT.

**Guard:** `require_ops`  
**Response:**
```json
[
  {
    "pon_port": "EPON0/1",
    "onu_id": 5,
    "mac": "AA:BB:CC:DD:EE:FF",
    "serial": "BDFO-12345678"
  }
]
```

#### POST `/api/devices/olts/{olt_id}/authorize-onu`

Authorize a rejected ONU on the OLT and add to inventory.

**Guard:** `require_write`  
**Request:**
```json
{
  "pon_port": "EPON0/1",
  "onu_id": 5,
  "name": "Customer Name",
  "serial": "BDFO-12345678",
  "mac": "AA:BB:CC:DD:EE:FF"
}
```

#### POST `/api/devices/olts/{olt_id}/delete-onu`

Delete/deregister an ONU from the OLT.

**Guard:** `require_write`  
**Request:**
```json
{
  "pon_port": "EPON0/1",
  "onu_id": 5
}
```

#### POST `/api/devices/olts/{olt_id}/add-onu`

Add/register an ONU on the OLT and app inventory.

**Guard:** `require_write`  
**Request:**
```json
{
  "pon_port": "EPON0/1",
  "onu_id": 10,
  "name": "New Customer",
  "serial": "BDFO-87654321",
  "mac": "11:22:33:44:55:66"
}
```

#### POST `/api/devices/olts/{olt_id}/set-description`

Set ONU description on the OLT.

**Guard:** `require_write`  
**Request:**
```json
{
  "pon_port": "EPON0/1",
  "onu_id": 5,
  "description": "Customer Name - 01712345678"
}
```

#### POST `/api/devices/olts/{olt_id}/set-bandwidth`

Set EPON ONU bandwidth (SLA) on the OLT.

**Guard:** `require_write`  
**Request:**
```json
{
  "pon_port": "EPON0/1",
  "onu_id": 5,
  "bandwidth_mode": "1g"
}
```

---

### Mikrotik Devices

#### GET `/api/devices/mikrotiks`

List all Mikrotik devices.

**Response (200):**
```json
[
  {
    "id": 1,
    "name": "Mikrotik-01",
    "ip": "10.0.0.1",
    "api_port": 8728,
    "use_ssl": false,
    "routeros_version": 7,
    "username": "admin",
    "password": "***",
    "enabled": true,
    "status": "reachable",
    "subscriber_count": 256,
    "active_count": 180,
    "last_scan_at": "2026-08-31T10:00:00Z",
    "last_message": "Scan complete",
    "created_at": "2026-01-01T00:00:00Z"
  }
]
```

#### POST `/api/devices/mikrotiks`

Create a Mikrotik device.

**Guard:** `require_write`

#### PUT `/api/devices/mikrotiks/{device_id}`

Update a Mikrotik device.

**Guard:** `require_write`

#### DELETE `/api/devices/mikrotiks/{device_id}`

Delete a Mikrotik device.

**Guard:** `require_write`  
**Response:** `204 No Content`

#### POST `/api/devices/mikrotiks/{device_id}/test`

Test connectivity to a Mikrotik.

**Guard:** `require_ops`

#### POST `/api/devices/mikrotiks/{device_id}/scan`

Scan a Mikrotik for PPPoE sessions and BGP.

**Guard:** `require_ops`

---

### BGP Sessions

#### GET `/api/devices/mikrotiks/{mikrotik_id}/bgp`

List BGP sessions for a Mikrotik.

#### GET `/api/devices/mikrotiks/{mikrotik_id}/bgp/{session_id}/routes`

List BGP routes for a session.

#### GET `/api/devices/mikrotiks/{mikrotik_id}/bgp/{session_id}/snapshots`

Get prefix count history for graphing.

#### GET `/api/devices/bgp/all-sessions`

List all BGP sessions across all Mikrotiks.

#### PUT `/api/devices/bgp/sessions/{session_id}/toggle-upstream`

Toggle `is_upstream` flag on a BGP session.

#### GET `/api/devices/bgp/snapshots-all`

Get all prefix snapshots across all sessions.

---

### Switches

#### GET `/api/devices/switches`

List all switches with port details.

#### POST `/api/devices/switches`

Create a switch device.  
**Guard:** `require_write`

#### PUT `/api/devices/switches/{switch_id}`

Update a switch device.  
**Guard:** `require_write`

#### DELETE `/api/devices/switches/{switch_id}`

Delete a switch device.  
**Guard:** `require_write`  
**Response:** `204 No Content`

#### POST `/api/devices/switches/{switch_id}/test`

Test switch connectivity.  
**Guard:** `require_ops`

#### POST `/api/devices/switches/{switch_id}/scan`

Scan switch for port status.  
**Guard:** `require_ops`

---

## 3. ONU Management

#### GET `/api/onus`

List ONUs with filters.

**Query Parameters:**
- `olt_id` — Filter by OLT
- `pon_port` — Filter by PON port
- `state` — Filter by state (active/inactive/offline/unknown)
- `source` — Filter by source (manual/auto)
- `search` — Search by name/serial/MAC/subscriber
- `bound` — Filter by binding status (true/false)

#### GET `/api/onus/{onu_id}`

Get a single ONU by ID.

#### POST `/api/onus/{onu_id}/check-status`

Real-time ONU check via OLT CLI (optical power, status).  
**Guard:** `require_write`

#### POST `/api/onus`

Add an ONU/ONT to application inventory.  
**Guard:** `require_write`

#### PUT `/api/onus/{onu_id}`

Update ONU. GPS update requires ticket assignment or global_write role.

#### DELETE `/api/onus/{onu_id}`

Remove an ONU/ONT from the application.  
**Guard:** `require_write`  
**Response:** `204 No Content`

#### POST `/api/onus/port-control`

Enable/disable an ONU Ethernet/UNI port on OLT.  
**Guard:** `require_write`  
**Request:**
```json
{
  "olt_id": 1,
  "pon_port": "EPON0/1",
  "onu_id": 5,
  "port": 1,
  "enable": false
}
```

---

## 4. Binding Management

#### POST `/api/bindings/run`

Trigger MAC binding resolution.  
**Guard:** `require_ops`

#### GET `/api/bindings`

List MAC-to-ONU bindings.  
**Query:** `bound=true|false`

#### GET `/api/bindings/olts`

List OLT MAC address table entries.

#### GET `/api/bindings/active`

List live PPPoE sessions from Mikrotik.

---

## 5. Dashboard

#### GET `/api/dashboard`

Full dashboard summary.

**Response:**
```json
{
  "olt_count": 10,
  "olt_reachable": 8,
  "mikrotik_count": 5,
  "onu_total": 2500,
  "onu_active": 2100,
  "onu_inactive": 300,
  "onu_bound": 1800,
  "signal_hist": [
    {"range": "-18 to -16", "count": 150},
    {"range": "-20 to -18", "count": 300}
  ],
  "weakest_onus": [...],
  "router_brands": [...],
  "mass_down_ports": [...],
  "olts": [...]
}
```

#### GET `/api/dashboard/mass-downs`

Live mass-outage areas from `onu_outages` (7 days).

#### GET `/api/scans`

List recent scan logs.  
**Query:** `limit=50`

#### GET `/api/dashboard/optical-averages`

Average RX power sparklines (1d, 1m, 3m windows).

#### GET `/api/olt-write-logs`

List OLT write (provisioning) logs.  
**Query:** `limit=50`

---

## 6. Global Search

#### GET `/api/search`

Search across ONUs, OLTs, and Mikrotiks.  
**Query:** `q=<search_term>` (min 2 chars)

**Response:**
```json
{
  "onus": [...],
  "olts": [...],
  "mikrotiks": [...]
}
```

---

## 7. Subscriber Management

#### GET `/api/subscribers`

List subscribers (ONUs with PPPoE username).  
**Query:** `q=<search>`, `limit=50`

#### POST `/api/subscribers/remote/probe`

Probe batch of IPs for remote management pages.  
**Request:**
```json
{
  "ips": ["10.0.0.1", "10.0.0.2"]
}
```

#### GET `/api/subscribers/{subscriber}/remote`

Probe a single subscriber's IP for remote access.

#### GET `/api/subscribers/{subscriber}/wifi`

Read subscriber's router WiFi config (ACS or direct).

#### GET `/api/subscribers/{subscriber}/telemetry`

Telemetry data with server-side downsampling.  
**Query:** `hours=24`

#### GET `/api/subscribers/{subscriber}`

Full subscriber profile + optical history + MAC changes.  
**Query:** `hours=24`

---

## 8. Live Down Detection

#### POST `/api/downs/start`

Start live ONU down detection for an OLT.  
**Guard:** `require_ops`  
**Request:**
```json
{
  "olt_id": 1,
  "interval_seconds": 30
}
```

#### POST `/api/downs/stop`

Stop the running detection session.  
**Guard:** `require_ops`

#### GET `/api/downs/status`

Get current detection session status.

#### GET `/api/downs/events`

List down events with filters.  
**Query:** `olt_id`, `port`, `kind`, `limit`

#### GET `/api/downs/outages`

List outage records.  
**Query:** `resolved=true|false`, `limit`

#### GET `/api/downs/ports`

Distinct PON port bases for an OLT.  
**Query:** `olt_id`

#### GET `/api/downs/areas`

Area labels for ports.  
**Query:** `olt_id`

#### PUT `/api/downs/areas`

Create or update an area label for OLT+port.  
**Guard:** `require_write`  
**Request:**
```json
{
  "olt_id": 1,
  "port": "EPON0/1",
  "label": "Rampura South"
}
```

---

## 9. Map

#### GET `/api/map/points`

All ONUs for network map (GPS or scattered).

**Response:**
```json
{
  "points": [
    {
      "onu_id": 1,
      "olt_name": "OLT-01",
      "pon_port": "EPON0/1",
      "name": "Customer",
      "subscriber": "user@isp",
      "gps_lat": 23.8103,
      "gps_lng": 90.4125,
      "state": "active",
      "rx_power": -18.5
    }
  ]
}
```

---

## 10. User Management

#### GET `/api/users`

List all users.  
**Guard:** `require_admin`

#### POST `/api/users`

Create a new user.  
**Guard:** `require_admin`  
**Request:**
```json
{
  "username": "noc_user",
  "password": "securepass",
  "role": "noc"
}
```

#### PUT `/api/users/{user_id}`

Update user (username, role, password).  
**Guard:** `require_admin`

#### DELETE `/api/users/{user_id}`

Delete a user (cannot delete self).  
**Guard:** `require_admin`  
**Response:** `204 No Content`

---

## 11. Reports

#### GET `/api/reports`

High-level report (OLT/port summaries, state, down reasons, GPS).  
**Query:** `olt_id`, `days=30`

#### GET `/api/reports/optical`

Weekly optical power statistics per ONU.  
**Query:** `olt_id`, `port`, `days=30`, `sort_by=rx_power`, `order=asc`, `threshold=-27`

#### GET `/api/reports/optical/export`

Export optical power report as XLSX/PDF.  
**Query:** `format=xlsx|pdf`, same as above

#### GET `/api/reports/fluctuation`

ONUs with RX power fluctuation above threshold.  
**Query:** `olt_id`, `port`, `days=30`, `threshold=3.0`

#### GET `/api/reports/fluctuation/export`

Export fluctuation report as XLSX/PDF.

#### GET `/api/reports/downtime`

Downtime report: down/outage events per ONU.  
**Query:** `olt_id`, `port`, `days=30`

#### GET `/api/reports/downtime/export`

Export downtime report as XLSX/PDF.

#### GET `/api/reports/ports`

Per-PON-port capacity/utilization (point-in-time).  
**Query:** `olt_id`, `port`

#### GET `/api/reports/ports/export`

Export port utilization as XLSX/PDF.

#### GET `/api/reports/weakest`

Weakest optical signals (lowest RX power).  
**Query:** `olt_id`, `port`, `limit=50`

#### GET `/api/reports/weakest/export`

Export weakest signals as XLSX/PDF.

---

## 12. Tickets

#### GET `/api/tickets`

List tickets. Non-admins see only assigned tickets.

#### POST `/api/tickets`

Create a support ticket.  
**Guard:** `require_fiber_request`  
**Request:**
```json
{
  "title": "Service down",
  "description": "Customer reports no internet",
  "priority": "high",
  "assigned_to": 2,
  "subscriber": "user@isp",
  "onu_id": 15
}
```

#### PUT `/api/tickets/{ticket_id}`

Update ticket (role-based field access).

#### DELETE `/api/tickets/{ticket_id}`

Delete a ticket.  
**Guard:** `require_write`  
**Response:** `204 No Content`

---

## 13. ACS (TR-069)

#### POST `/api/acs/cwmp`

TR-069 (CWMP) endpoint called by CPE routers.  
**Auth:** None (public, authenticated by CPE serial)

#### GET `/api/acs/devices`

List ACS-managed devices.  
**Query:** `online=true|false`

#### GET `/api/acs/devices/{device_id}`

Get a single ACS device.

#### GET `/api/acs/devices/{device_id}/parameters`

Get device TR-069 parameters.  
**Query:** `search=<param_name>`

#### GET `/api/acs/devices/{device_id}/wifi`

Get device WiFi config from TR-069 params.

#### GET `/api/acs/devices/{device_id}/metrics`

Get device CPU/memory/bandwidth metrics.  
**Query:** `hours=24`

#### GET `/api/acs/devices/{device_id}/jobs`

List device ACS jobs.

#### POST `/api/acs/devices/{device_id}/wifi`

Queue WiFi SSID/passphrase change via TR-069.  
**Guard:** `require_ops`  
**Request:**
```json
{
  "ssid": "NewNetwork",
  "passphrase": "newpassword123"
}
```

#### POST `/api/acs/devices/{device_id}/wan`

Queue WAN config push via TR-069.  
**Guard:** `require_ops`

#### POST `/api/acs/devices/{device_id}/firmware`

Queue firmware update via TR-069.  
**Guard:** `require_ops`

#### POST `/api/acs/devices/{device_id}/reboot`

Queue device reboot via TR-069.  
**Guard:** `require_ops`

---

## 14. Fiber Infrastructure

### Cables

#### GET `/api/fiber/cables`

List all fiber cables with segments.

#### POST `/api/fiber/cables`

Create cable (auto-generates route via OSRM).  
**Guard:** `require_write`  
**Request:**
```json
{
  "link_name": "Rampura-Box1",
  "code": "RC-001",
  "core_count": 12,
  "manufacturer": "FiberHome",
  "manufacturing_year": 2024,
  "cable_type": "round",
  "route_type": "driving",
  "src_tj_id": 1,
  "dst_tj_id": 2,
  "segments": [
    {
      "start_lat": 23.8103,
      "start_lng": 90.4125,
      "end_lat": 23.8150,
      "end_lng": 90.4180
    }
  ]
}
```

#### PUT `/api/fiber/cables/{cable_id}`

Update cable and segments.  
**Guard:** `require_write`

#### DELETE `/api/fiber/cables/{cable_id}`

Delete a cable.  
**Guard:** `require_write`  
**Response:** `204 No Content`

### TJ Boxes

#### GET `/api/fiber/tj-boxes`

List all TJ splice boxes.

#### POST `/api/fiber/tj-boxes`

Create a TJ box (auto-generates TJ-XXXX ID).  
**Guard:** `require_write`  
**Request:**
```json
{
  "name": "Rampura Junction",
  "box_type": "regular_tj",
  "tj_port": 8,
  "tray_count": 2,
  "splice_per_tray": 12,
  "lat": 23.8103,
  "lng": 90.4125,
  "address": "Rampura, Dhaka"
}
```

**Auto-generated capacity:** `tray_count × splice_per_tray`

**TJ Port Validation:**
- `home_tj`: `tj_port=2`
- `regular_tj`: `tj_port` ∈ {4, 8, 10, 12}

#### PUT `/api/fiber/tj-boxes/{box_id}`

Update a TJ box.  
**Guard:** `require_write`

#### DELETE `/api/fiber/tj-boxes/{box_id}`

Delete TJ box and hosted splitters.  
**Guard:** `require_write`  
**Response:** `204 No Content`

### Splitters

#### GET `/api/fiber/splitters`

List all splitters.

#### POST `/api/fiber/splitters`

Create a splitter (auto-generates SP-XXXX ID).  
**Guard:** `require_write`

#### PUT `/api/fiber/splitters/{splitter_id}`

Update a splitter.  
**Guard:** `require_write`

#### DELETE `/api/fiber/splitters/{splitter_id}`

Delete a splitter.  
**Guard:** `require_write`  
**Response:** `204 No Content`

### Fiber Loops

#### GET `/api/fiber/loops`

List fiber loops.  
**Query:** `cable_id`

#### POST `/api/fiber/loops`

Create a fiber loop.  
**Guard:** `require_write`

#### PUT `/api/fiber/loops/{loop_id}`

Update a fiber loop.  
**Guard:** `require_write`

#### DELETE `/api/fiber/loops/{loop_id}`

Delete a fiber loop.  
**Guard:** `require_write`  
**Response:** `204 No Content`

### Cable Cuts

#### GET `/api/fiber/cuts`

List cable cuts.  
**Query:** `cable_id`, `status=cut|repaired`

#### POST `/api/fiber/cuts`

Record a cable cut.  
**Guard:** `require_write`

#### PUT `/api/fiber/cuts/{cut_id}`

Update a cable cut.  
**Guard:** `require_write`

#### DELETE `/api/fiber/cuts/{cut_id}`

Delete a cable cut.  
**Guard:** `require_write`  
**Response:** `204 No Content`

### Splices

#### GET `/api/fiber/splices`

List splices with cable codes.  
**Query:** `tj_id`, `limit=50`, `offset=0`

#### POST `/api/fiber/splices`

Create splice (validates core occupancy).  
**Guard:** `require_write`  
**Request:**
```json
{
  "tj_id": 1,
  "cable_a_id": 1,
  "core_a": 1,
  "cable_b_id": 2,
  "core_b": 3,
  "status": "active"
}
```

**Validation:** A core can only splice with one other core.

#### PUT `/api/fiber/splices/{splice_id}`

Update splice (validates core conflicts).  
**Guard:** `require_write`

#### DELETE `/api/fiber/splices/{splice_id}`

Delete a splice.  
**Guard:** `require_write`  
**Response:** `204 No Content`

#### GET `/api/fiber/splices/unused-cores`

Get unused/spare cores per cable at a TJ.  
**Query:** `tj_id`

**Response:**
```json
[
  {
    "cable_id": 1,
    "cable_code": "RC-001",
    "cable_name": "Rampura-Box1",
    "spare_cores": [4, 5, 6, 7, 8, 9, 10, 11, 12],
    "occupied_cores": [1, 2, 3]
  }
]
```

### Export/Import

#### GET `/api/fiber/export`

Export fiber network as XLSX.  
**Response:** File download

#### POST `/api/fiber/import`

Import fiber network from XLSX.  
**Guard:** `require_write`  
**Request:** `multipart/form-data` with `file` field

### NOC/POP Map

#### GET `/api/fiber/noc-pop-map`

Get NOC/POP map data with associated OLTs.

**Response:**
```json
{
  "nocs": [
    {
      "id": 1,
      "name": "Main NOC",
      "lat": 23.8103,
      "lng": 90.4125,
      "olt_count": 5,
      "switch_count": 3
    }
  ],
  "pops": [...]
}
```

---

## 15. Fiber Approvals (Legacy)

#### POST `/api/fiber/approvals`

Field team submits fiber change for approval.  
**Guard:** `require_fiber_request`

#### GET `/api/fiber/approvals`

List approval requests (field_team sees own only).  
**Query:** `status`, `entity_type`

#### GET `/api/fiber/approvals/{request_id}`

Get single approval request detail.

#### PUT `/api/fiber/approvals/{request_id}/approve`

Approve pending request and execute the change.  
**Guard:** `require_write`

#### PUT `/api/fiber/approvals/{request_id}/reject`

Reject a pending fiber change request.  
**Guard:** `require_write`

#### PUT `/api/fiber/approvals/{request_id}/return`

Return submission to employee for correction.  
**Guard:** `require_noc_approval`

#### PUT `/api/fiber/approvals/{request_id}/resubmit`

Employee resubmits corrected data.  
**Guard:** `require_approval_submit`

---

## 16. Centralized NOC Approval Queue

#### POST `/api/approvals/submit`

Android app submits any record for NOC approval.  
**Guard:** `require_approval_submit`  
**Request:**
```json
{
  "action": "create",
  "entity_type": "tj",
  "entity_id": null,
  "payload_json": "{\"name\": \"New TJ Box\", ...}",
  "previous_data_json": "",
  "priority": "normal",
  "photos_json": ["photo1.jpg", "photo2.jpg"],
  "location_json": "{\"lat\": 23.8103, \"lng\": 90.4125}"
}
```

#### GET `/api/approvals`

List approval requests.  
**Guard:** `get_current_user`  
**Query:** `status`, `entity_type`, `action`  
**Note:** `field_team` role sees only own submissions.

#### GET `/api/approvals/pending-count`

Count pending approvals broken down by entity type.

**Response:**
```json
{
  "total": 12,
  "by_type": {
    "tj": 3,
    "cable": 5,
    "user_location": 2,
    "other": 2
  }
}
```

#### GET `/api/approvals/{request_id}`

Get single approval request detail.

#### PUT `/api/approvals/{request_id}/approve`

NOC/admin approves request and executes the change.  
**Guard:** `require_noc_approval`  
**Request:**
```json
{
  "review_note": "Looks good"
}
```

#### PUT `/api/approvals/{request_id}/reject`

NOC/admin rejects a pending request.  
**Guard:** `require_noc_approval`  
**Request:**
```json
{
  "review_note": "Missing GPS coordinates"
}
```

#### PUT `/api/approvals/{request_id}/return`

NOC returns submission for employee correction.  
**Guard:** `require_noc_approval`  
**Request:**
```json
{
  "correction_note": "Please re-check the cable code"
}
```

#### PUT `/api/approvals/{request_id}/resubmit`

Employee resubmits corrected data after return.  
**Guard:** `require_approval_submit`  
**Request:**
```json
{
  "payload_json": "{...}",
  "photos_json": ["new_photo.jpg"]
}
```

#### POST `/api/approvals/upload-photo`

Upload a photo for approval submission.  
**Guard:** `require_approval_submit`  
**Request:** `multipart/form-data` with `file` field (max 10MB)

#### GET `/api/approvals/photos/{filename}`

Serve an uploaded approval photo.  
**Guard:** `get_current_user`

---

## 17. NOC/POP Management

#### GET `/api/noc-pop/nocs`

List all NOCs with device counts.

#### POST `/api/noc-pop/nocs`

Create a NOC.

#### PUT `/api/noc-pop/nocs/{noc_id}`

Update a NOC.

#### DELETE `/api/noc-pop/nocs/{noc_id}`

Delete a NOC.

#### GET `/api/noc-pop/pops`

List all POPs with device counts.

#### POST `/api/noc-pop/pops`

Create a POP.

#### PUT `/api/noc-pop/pops/{pop_id}`

Update a POP.

#### DELETE `/api/noc-pop/pops/{pop_id}`

Delete a POP.

#### PUT `/api/noc-pop/assign-device/{device_id}`

Assign OLT to a NOC/POP.

---

## 18. System Endpoints

#### GET `/api/health`

Health check endpoint.  
**Auth:** None  
**Response:** `{"status": "ok"}`

#### GET `/api/scheduler/status`

Get status of all scheduled jobs.

**Response:**
```json
[
  {
    "job_id": "scan_olts",
    "next_run": "2026-08-31T10:05:00Z",
    "last_run": "2026-08-31T10:00:00Z",
    "status": "success",
    "error": null
  }
]
```

---

## 19. Error Responses

All error responses follow this format:

```json
{
  "detail": "Error message"
}
```

| Status Code | Meaning |
|-------------|---------|
| 400 | Bad request / validation error |
| 401 | Unauthorized (missing/invalid token) |
| 403 | Forbidden (insufficient permissions) |
| 404 | Not found |
| 422 | Unprocessable entity (validation error) |
| 500 | Internal server error |

---

## 20. Rate Limiting

Currently no rate limiting is implemented. All endpoints are unlimited.

---

## 21. Pagination

Most list endpoints support `limit` and `offset` query parameters:

```
GET /api/onus?limit=50&offset=100
```

Default limits vary by endpoint (typically 50-200).

---

## 22. Field Photos API

Base URL: `/api/photos`

All endpoints require JWT authentication. Write operations (`upload`, `delete`) require `global_write`, `admin`, or `noc` roles.

### 22.1 Upload / Replace Photo

```
POST /api/photos/{entity_type}/{entity_id}?photo_type={type}&latitude={lat}&longitude={lng}
Content-Type: multipart/form-data
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entity_type` | path | Yes | `tj` or `subscriber` |
| `entity_id` | path | Yes | TJ unique_id or subscriber name |
| `photo_type` | query | Yes | TJ: `overall`, `internal`, `identification`. Subscriber: `overall`, `equipment`, `identification` |
| `latitude` | query | No | GPS latitude (decimal degrees) |
| `longitude` | query | No | GPS longitude (decimal degrees) |
| `captured_at` | query | No | ISO 8601 timestamp of when photo was taken |
| `file` | form | Yes | Image file (JPEG, PNG, WebP, max 10 MB) |

**Server-side processing:**
- Crops to 1:1 square from center
- Resizes to 1440×1440 (~2 MP)
- Adds permanent watermark: entity ID + GPS coordinates (bottom-left)
- Saves as JPEG (quality 85) regardless of input format

**Response 200:**
```json
{
  "id": 1,
  "photo_type": "overall",
  "storage_key": "tj/TJ-001/overall.jpg",
  "file_size": 142000,
  "width": 1440,
  "height": 1440,
  "url": "/api/photos/file/tj/TJ-001/overall.jpg"
}
```

**Errors:**
| Status | Meaning |
|--------|---------|
| 400 | Invalid entity type, photo type, file type, or file too large |
| 401 | Unauthorized |
| 403 | Insufficient permissions |

### 22.2 List Photos

```
GET /api/photos/{entity_type}/{entity_id}
```

**Response 200:**
```json
{
  "entity_type": "tj",
  "entity_id": "TJ-001",
  "total_required": 3,
  "totalUploaded": 2,
  "photos": [
    {
      "photo_type": "overall",
      "uploaded": true,
      "id": 1,
      "url": "/api/photos/file/tj/TJ-001/overall.jpg",
      "file_size": 142000,
      "width": 1440,
      "height": 1440,
      "latitude": 23.8103,
      "longitude": 90.4125,
      "captured_at": "2026-08-31T10:30:00Z",
      "captured_by": "field_user",
      "created_at": "2026-08-31T10:30:05Z"
    },
    {
      "photo_type": "internal",
      "uploaded": false
    },
    {
      "photo_type": "identification",
      "uploaded": true,
      "id": 2,
      "url": "/api/photos/file/tj/TJ-001/identification.jpg"
    }
  ]
}
```

### 22.3 Serve Photo File

```
GET /api/photos/file/{path}
Authorization: Bearer {token}
```

Returns the actual image file with appropriate `Content-Type` header. Path traversal is blocked.

### 22.4 Delete Photo

```
DELETE /api/photos/{entity_type}/{entity_id}/{photo_type}
```

Removes both the database record and the file from disk.

**Response 200:**
```json
{"ok": true, "deleted": "overall"}
```

### 22.5 Storage

Photos are stored at `{PHOTO_UPLOAD_DIR}/{entity_type}/{entity_id}/{photo_type}.jpg`.

Default `PHOTO_UPLOAD_DIR` is `/app/uploads/field-photos` (Docker volume mount recommended).

Each photo type is limited to exactly one file — uploading replaces the previous photo.
