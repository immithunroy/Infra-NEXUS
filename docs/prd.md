# Product Requirements Document (PRD)

## Infra NEXUS — ISP Infrastructure Management Platform

**Version:** 1.0  
**Date:** 2026-08-31  
**Status:** Active Development  
**URL:** https://nexus.qbinternet.com

---

## 1. Product Overview

Infra NEXUS is a centralized web platform for managing ISP fiber infrastructure, network devices, subscribers, and NOC operations. It provides real-time visibility into OLT/ONU status, optical signal quality, MAC binding resolution, BGP routing, and fiber plant topology — all from a single dashboard.

### 1.1 Vision

Replace fragmented toolsets (Telnet/SSH sessions, spreadsheets, manual tracking) with a unified platform that automates device management, subscriber provisioning, and infrastructure documentation.

### 1.2 Target Users

| Role | Description | Permissions |
|------|-------------|-------------|
| **Admin** | Platform administrator | Full access including user management |
| **Global Write** | Senior NOC engineer | Read/write all data, no user management |
| **Global Read** | Viewer / auditor | Read-only access to all data |
| **NOC** | Network operations center | Read + run scans/tests, review approvals |
| **Field Team** | Android app users | Read + update address/GPS + submit for approval |

---

## 2. Business Goals

| Goal | Metric | Target |
|------|--------|--------|
| Automate device discovery | OLTs scanned automatically | Every 5 minutes |
| Reduce provisioning time | Manual steps to add subscriber | < 2 minutes |
| Centralize fiber documentation | Fiber plant in database vs spreadsheets | 100% coverage |
| Real-time outage detection | Time to detect mass-down event | < 5 minutes |
| Audit trail | All field changes require approval | 100% traceable |
| Single pane of glass | Devices, subscribers, fiber, BGP | One dashboard |

---

## 3. Core Features

### 3.1 Device Management

#### 3.1.1 OLT Management
- CRUD for BDCOM GPON/EPON OLT devices
- Telnet/SSH/both access method selection
- SNMP community configuration (v2c)
- Per-PON-port capacity tracking
- Real-time connectivity test
- ONU scan and inventory sync
- Rejected/unauthorized ONU discovery and authorization
- ONU registration, deletion, description, bandwidth (SLA) management
- ONU port enable/disable control
- Real-time ONU status check (optical power via CLI)
- Write-all configuration save (daily cron + on-demand)

#### 3.1.2 Mikrotik Router Management
- CRUD for Mikrotik RouterOS devices
- API port and SSL configuration
- RouterOS v6/v7 support
- PPPoE active session scanning
- BGP session monitoring (v6/v7)
- BGP route table inspection
- BGP prefix count snapshots (time-series)

#### 3.1.3 Switch Management
- CRUD for BDCOM switch devices
- Port status scanning (up/down, speed, VLAN, MAC)
- SNMP-based port statistics (rx/tx bytes)

### 3.2 Subscriber Management

#### 3.2.1 Subscriber Profile
- Full subscriber profile: ONU details, address, GPS, phone, email, government ID
- Optical power telemetry (RX/TX) with sparkline charts
- MAC history (previous CPE devices)
- Real-time OLT check (CLI-based optical power)
- PPPoE session binding status
- WiFi configuration viewing (via ACS or direct probe)
- Remote access probing (router admin page detection)

#### 3.2.2 MAC Binding Resolution
- Automated three-way binding: OLT MAC ↔ ONU ↔ PPPoE session
- Mikrotik PPPoE active → MAC → OLT MAC → ONU mapping
- Batch binding trigger with summary
- Manual binding view

### 3.3 ONU Down Detection

#### 3.3.1 Live Detection
- Real-time ONU status polling on configurable OLTs
- Down/recovery event tracking with timestamps
- Mass-outage detection (multiple ONUs on same port)
- Auto-resolve when ONUs recover
- Area labels for PON ports (human-readable zone names)

#### 3.3.2 Down Events & Outages
- Event log with filtering (by OLT, port, event type)
- Outage records (start time, affected count, resolution time)
- 7-day mass-down summary on dashboard

### 3.4 Fiber Infrastructure Management

#### 3.4.1 Cable Management
- Fiber cable CRUD with auto-generated unique IDs (FC-XXXX)
- Cable types: round, figure-8
- Route types: driving, walking
- Auto-route generation via OSRM
- Cable segments with GPS polylines
- Manufacturing metadata (year, manufacturer)

#### 3.4.2 TJ Box Management
- Splice box CRUD with auto-generated IDs (TJ-XXXX)
- Box types: home_tj, regular_tj, enclosure, dome
- Port count, tray count, splice-per-tray configuration
- Capacity = tray_count × splice_per_tray
- GPS location and address

#### 3.4.3 Splice Management
- Core-to-core splice connections at TJ boxes
- Core occupancy validation (one core → one splice)
- Active/spare/broken status
- Unused/spare cores query

#### 3.4.4 Splitter Management
- Splitter CRUD with auto-generated IDs (SP-XXXX)
- Split ratio, input core, output cores
- TJ box association

#### 3.4.5 Cable Cut Tracking
- Cable cut/repair events with GPS coordinates
- Status tracking (cut/repaired)
- Link to repair TJ box

#### 3.4.6 Fiber Loop Tracking
- Fiber slack coils at specific route locations
- Loop length in meters
- Segment association

#### 3.4.7 Fiber Network Export/Import
- XLSX export of entire fiber network
- XLSX import for bulk data loading

### 3.5 Fiber Map

- Interactive Leaflet map showing all fiber infrastructure
- Cable routes with polylines
- TJ boxes, splitters, cable cuts marked on map
- Leaflet-draw support for creating/editing cable routes
- GPS coordinate input with address search
- Edge-to-edge map display (no padding)

### 3.6 Network Map

- Interactive map showing all subscribers (ONUs)
- GPS-positioned subscribers
- Scattered display for subscribers without GPS
- Color-coded by signal quality
- Click for subscriber details

### 3.7 NOC/POP Management

- NOC and POP site CRUD
- GPS coordinates, address, contact info
- Device assignment (OLT → NOC/POP)
- Device counts per NOC/POP
- NOC/POP markers on fiber map

### 3.8 BGP Monitoring

- BGP session listing across all Mikrotik routers
- Session state (established/active/idle)
- Prefix count and advertised count
- Upstream peer flagging
- BGP route table inspection
- Time-series prefix snapshots for trend analysis
- Our ASN: 149035

### 3.9 Telemetry & Monitoring

#### 3.9.1 Optical Telemetry
- SNMP-based RX/TX power sampling (every 5 minutes)
- EPON: OIDs .5.1.5 (Rx) / .5.1.6 (Tx)
- GPON: OIDs .3.4.1.2 (Rx) / .3.4.1.3 (Tx)
- 90-day data retention
- Time-series charts with 1d/1m/3m windows

#### 3.9.2 BGP Telemetry
- Prefix count snapshots (365-day retention)
- Session state tracking

### 3.10 Reports

| Report | Description | Export |
|--------|-------------|--------|
| **Optical Power** | Per-ONU weekly RX power statistics | XLSX, PDF |
| **Fluctuation** | ONUs with RX power variation above threshold | XLSX, PDF |
| **Downtime** | Down/outage events per subscriber | XLSX, PDF |
| **Port Utilization** | Per-PON-port capacity and utilization | XLSX, PDF |
| **Weakest Signals** | Subscribers with lowest optical power | XLSX, PDF |
| **General Summary** | OLT/port summaries, state distribution, down reasons | — |

### 3.11 ACS (TR-069) Integration

- TR-069 (CWMP) endpoint for CPE router management
- Device inventory (serial, manufacturer, model, firmware)
- WiFi configuration viewing and changing
- WAN configuration push
- Firmware update queueing
- Device reboot queueing
- CPU/memory/traffic metrics collection
- TR-069 parameter browsing

### 3.12 Ticket System

- Support ticket CRUD
- Status workflow: open → in_progress → resolved → closed
- Priority levels: low, normal, high, urgent
- Assignment to users
- Subscriber/ONU linkage
- Non-admins see only their assigned tickets

### 3.13 NOC Approval Queue

#### 3.13.1 Overview
Centralized approval workflow for all Android/field team submissions. Field team submits data → NOC reviews → approve/reject/return for correction.

#### 3.13.2 Supported Entity Types
- TJ boxes, TJ splitters, cables, users, user locations
- Splitters, splice boxes, infrastructure, loops, cable cuts, other

#### 3.13.3 Workflow States
```
pending → approved | rejected | returned_for_correction
returned_for_correction → resubmitted → pending (re-enters queue)
```

#### 3.13.4 Features
- Photo upload with GPS tagging (max 10MB per photo)
- Previous data snapshot for comparison
- Priority levels (low, normal, high, urgent)
- Correction notes from NOC
- Live pending count badge on dashboard and sidebar
- Filter tabs: All, Pending, Approved, Rejected, Returned, Resubmitted

### 3.14 User Management

- User CRUD (admin only)
- Role assignment (admin, global_write, global_read, noc, field_team)
- Password hashing (bcrypt)
- JWT token authentication (24-hour expiry)
- Self-deletion prevention

### 3.15 Dashboard

- OLT/Mikrotik device counts and status
- ONU total/active/inactive/bound counts
- Signal quality histogram
- Weakest ONUs list
- Router brand distribution
- Mass-down areas (7-day)
- Scheduled job status (live refresh every 15s)
- Pending approval count badge

### 3.16 Global Search

- Search across ONUs, OLTs, and Mikrotik devices
- Minimum 2-character query
- Results grouped by entity type

### 3.17 Scan Logs

- History of all scan operations (OLT, Mikrotik, binding)
- Status tracking (running, success, failed)
- Device name and error messages

### 3.18 Scheduled Jobs

| Job | Default Interval | Description |
|-----|-----------------|-------------|
| OLT Scan | 300s (5 min) | Scan all enabled OLTs for ONUs |
| Mikrotik Scan | 300s | Scan all enabled Mikrotiks for PPP/BGP |
| MAC Binding | 300s | Resolve MAC→ONU→PPPoE bindings |
| Telemetry | 300s (+90s offset) | SNMP optical power sampling |
| ACS Poll | 600s (+120s offset) | TR-069 device polling |
| MAC Vendor Sync | Daily 04:00 | OUI database sync (24h cache) |
| OLT Write All | Daily 01:00 | Save running config on all OLTs |

---

## 4. Android App Integration

### 4.1 Authentication
- JWT-based login (same as web)
- Token stored in SharedPreferences

### 4.2 Submission Workflow
- Submit infrastructure changes via `POST /api/approvals/submit`
- Photo capture and upload via `POST /api/approvals/upload-photo`
- GPS tagging on all submissions
- Offline queue with sync

### 4.3 Read Operations
- View ONU/subscriber profiles
- View fiber infrastructure
- View tickets assigned to user

---

## 5. Technical Constraints

| Constraint | Value |
|------------|-------|
| Database | PostgreSQL 16 (async) |
| Backend | Python 3.12+ / FastAPI |
| Frontend | React 18 / TypeScript / Vite |
| Maps | Leaflet + leaflet-draw |
| Styling | Tailwind CSS |
| Auth | JWT (HS256, 24h expiry) |
| ORM | SQLAlchemy 2.0 (async) |
| Container | Docker Compose |
| CI/CD | GitHub Actions → SSH deploy |
| Production | `103.177.54.6:8050` |
| SSL | Nginx reverse proxy |

---

## 6. Success Criteria

| Criterion | Target |
|-----------|--------|
| Uptime | 99.5%+ |
| Scan cycle time | < 30s per OLT |
| Dashboard load time | < 3s |
| Map render (1000 points) | < 2s |
| Report export (PDF/XLSX) | < 10s |
| Zero data loss on field submission | 100% |
| All field changes auditable | 100% |

---

## 7. Future Considerations

- SNMP v3 support
- OLT firmware upgrade management
- Geographic outage heatmaps
- Multi-tenant support
- Mobile-responsive admin dashboard
- API rate limiting
- Webhook notifications for mass-down events
- Integration with ticketing systems (Jira, etc.)
