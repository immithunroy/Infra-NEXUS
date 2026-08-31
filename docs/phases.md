# Development Phases

## Infra NEXUS — Project Timeline

**Version:** 1.0  
**Last Updated:** 2026-08-31

---

## Phase 1: Foundation (Completed)

**Goal:** Core device management and ONU inventory

### Completed Features
- [x] FastAPI backend with async PostgreSQL
- [x] React frontend with TypeScript
- [x] JWT authentication
- [x] OLT device CRUD (BDCOM GPON/EPON)
- [x] Mikrotik device CRUD
- [x] ONU inventory management
- [x] Telnet/SSH driver for BDCOM OLTs
- [x] RouterOS API driver for Mikrotik
- [x] Basic dashboard with device counts

### Key Decisions
- SQLAlchemy 2.0 async (no Alembic — use create_all + manual migrations)
- FastAPI for API (auto-generated OpenAPI docs)
- React 18 + TypeScript + Vite
- PostgreSQL 16 (async via asyncpg)

---

## Phase 2: Subscriber Management (Completed)

**Goal:** Subscriber profiles and MAC binding

### Completed Features
- [x] Subscriber profile page (ONU + PPPoE + GPS)
- [x] MAC binding resolution (OLT ↔ Mikrotik ↔ PPPoE)
- [x] Real-time ONU check via OLT CLI
- [x] Subscriber search
- [x] GPS/address management
- [x] Phone, email, government ID fields

### Key Decisions
- MAC binding is three-way: OLT MAC → ONU → PPPoE session
- GPS accuracy must be < 9 meters
- `pon_port` includes `:onu_id` suffix in database

---

## Phase 3: Network Monitoring (Completed)

**Goal:** Optical telemetry and down detection

### Completed Features
- [x] SNMP optical power telemetry (RX/TX)
- [x] 90-day telemetry retention
- [x] Telemetry charts (1d/1m/3m)
- [x] Live ONU down detection
- [x] Mass-outage detection
- [x] Down event/outage logging
- [x] Area labels for PON ports

### Key Decisions
- EPON: OIDs .5.1.5 (Rx) / .5.1.6 (Tx)
- GPON: OIDs .3.4.1.2 (Rx) / .3.4.1.3 (Tx)
- Telemetry pruned at 90 days
- Down detection runs as APScheduler job

---

## Phase 4: Fiber Infrastructure (Completed)

**Goal:** Cable/TJ/splitter management with maps

### Completed Features
- [x] Cable CRUD with auto-generated IDs (FC-XXXX)
- [x] TJ box CRUD with auto-generated IDs (TJ-XXXX)
- [x] Splitter CRUD with auto-generated IDs (SP-XXXX)
- [x] Splice management with core validation
- [x] Cable cut tracking
- [x] Fiber loop tracking
- [x] Fiber map (Leaflet + leaflet-draw)
- [x] Network map (subscriber GPS)
- [x] XLSX export/import
- [x] Route generation via OSRM

### Key Decisions
- TJ box types: home_tj (2 ports), regular_tj (4/8/10/12 ports)
- Capacity = tray_count × splice_per_tray
- Core-to-one splice validation in application layer
- Auto-uppercase for cable/TJ/splitter names

---

## Phase 5: Scheduled Operations (Completed)

**Goal:** Automated scanning and provisioning

### Completed Features
- [x] APScheduler background jobs
- [x] OLT scan (every 5 min)
- [x] Mikrotik scan (every 5 min)
- [x] MAC binding (every 5 min)
- [x] Telemetry collection (every 5 min)
- [x] ACS polling (every 10 min)
- [x] MAC vendor sync (daily)
- [x] OLT write-all (daily at 01:00)
- [x] Job status dashboard
- [x] Retry mechanism for write-all

### Key Decisions
- `write all` is DEFERRED — only runs via scheduler
- Write-all at 01:00 AM, retry at 02:00 AM
- MAC vendor sync at 04:00 AM, retry at 05:00 AM
- Telemetry offset +90s to avoid collision with OLT scan

---

## Phase 6: Reports & Analytics (Completed)

**Goal:** Exportable reports and visual analytics

### Completed Features
- [x] Optical power report (weekly stats)
- [x] Fluctuation report (RX variation)
- [x] Downtime report (down/outage events)
- [x] Port utilization report
- [x] Weakest signals report
- [x] XLSX export for all reports
- [x] PDF export for all reports
- [x] Dashboard sparkline charts

### Key Decisions
- Reports computed on-demand (no pre-aggregation)
- Server-side export generation
- openpyxl for XLSX, reportlab for PDF

---

## Phase 7: ACS Integration (Completed)

**Goal:** TR-069 CPE management

### Completed Features
- [x] TR-069 CWMP endpoint
- [x] CPE device inventory
- [x] WiFi configuration viewing
- [x] WiFi SSID/passphrase change
- [x] WAN config push
- [x] Firmware update queueing
- [x] Device reboot queueing
- [x] CPU/memory/traffic metrics
- [x] TR-069 parameter browsing

### Key Decisions
- ACS jobs are queued (async processing)
- CPE devices auto-discovered via TR-069 inform
- Parameters stored in key-value table

---

## Phase 8: Ticket System (Completed)

**Goal:** Support ticket management

### Completed Features
- [x] Ticket CRUD
- [x] Status workflow (open → in_progress → resolved → closed)
- [x] Priority levels (low, normal, high, urgent)
- [x] User assignment
- [x] Subscriber/ONU linkage
- [x] Role-based visibility

### Key Decisions
- Non-admins see only assigned tickets
- Tickets can link to subscriber (PPPoE username) or ONU
- Status and priority stored as strings (not enums)

---

## Phase 9: NOC/POP Management (Completed)

**Goal:** Network operations center and point-of-presence tracking

### Completed Features
- [x] NOC CRUD
- [x] POP CRUD
- [x] Device assignment (OLT → NOC/POP)
- [x] Device counts per NOC/POP
- [x] NOC/POP markers on fiber map

### Key Decisions
- NOC/POP endpoints have no authentication (known limitation)
- Device assignment via `assign-device` endpoint
- NOC/POP shown on fiber map as markers

---

## Phase 10: NOC Approval Queue (Completed)

**Goal:** Centralized approval for field submissions

### Completed Features
- [x] Centralized approval queue (`/api/approvals`)
- [x] Photo upload with GPS tagging
- [x] Return for correction workflow
- [x] Resubmission workflow
- [x] Pending count badge on dashboard
- [x] Sidebar nav link with live badge
- [x] Queue page with filter tabs
- [x] Detail page with comparison view
- [x] All entity types supported
- [x] Priority levels
- [x] Android app integration

### Key Decisions
- Separate from legacy `fiber_approvals.py`
- Photo storage: `/app/uploads/approval-photos/`
- `field_team` sees only own submissions
- Status flow: pending → approved/rejected/returned → resubmitted → pending

---

## Phase 11: Documentation (In Progress)

**Goal:** Comprehensive project documentation

### In Progress
- [ ] PRD (prd.md)
- [ ] Architecture (architecture.md)
- [ ] Database schema (database.md)
- [ ] API reference (api.md)
- [ ] Android API guide (android-api.md)
- [ ] Security (security.md)
- [ ] Error handling (error-handling.md)
- [ ] Rules (rules.md)
- [ ] Design system (design.md)
- [ ] Phases (phases.md) — this file
- [ ] Memory (memory.md)
- [ ] Prompts (prompts.md)
- [ ] Code documentation (code-documentation.md)

---

## Phase 12: Future Enhancements (Planned)

### Planned Features
- [ ] SNMP v3 support
- [ ] OLT firmware upgrade management
- [ ] Geographic outage heatmaps
- [ ] Multi-tenant support
- [ ] Mobile-responsive admin dashboard
- [ ] API rate limiting
- [ ] Webhook notifications for mass-down events
- [ ] Integration with ticketing systems (Jira, etc.)
- [ ] Refresh token support
- [ ] Field-level encryption for device credentials

---

## Timeline Summary

| Phase | Name | Status | Key Deliverables |
|-------|------|--------|-----------------|
| 1 | Foundation | ✅ Complete | Backend, frontend, auth, OLT/Mikrotik CRUD |
| 2 | Subscriber Mgmt | ✅ Complete | Profiles, MAC binding, GPS |
| 3 | Network Monitoring | ✅ Complete | Telemetry, down detection |
| 4 | Fiber Infrastructure | ✅ Complete | Cables, TJ, splitters, maps |
| 5 | Scheduled Operations | ✅ Complete | APScheduler jobs |
| 6 | Reports & Analytics | ✅ Complete | XLSX/PDF exports |
| 7 | ACS Integration | ✅ Complete | TR-069 management |
| 8 | Ticket System | ✅ Complete | Support tickets |
| 9 | NOC/POP Mgmt | ✅ Complete | Site management |
| 10 | NOC Approval Queue | ✅ Complete | Field submission workflow |
| 11 | Documentation | 🔄 In Progress | Comprehensive docs |
| 12 | Future | 📋 Planned | SNMP v3, multi-tenant, etc. |
