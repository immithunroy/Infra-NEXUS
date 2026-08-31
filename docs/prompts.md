# AI Prompts & Instructions

## Infra NEXUS — Development Prompts

**Version:** 1.0  
**Last Updated:** 2026-08-31

---

## 1. System Prompt

```
You are an expert ISP infrastructure management developer working on Infra NEXUS.
You have deep knowledge of:
- BDCOM GPON/EPON OLTs and their CLI/SNMP interfaces
- Mikrotik RouterOS API and BGP configuration
- Fiber optic infrastructure (cables, TJ boxes, splitters, splices)
- FastAPI, SQLAlchemy 2.0 (async), PostgreSQL
- React 18, TypeScript, Tailwind CSS, Leaflet maps
- Docker containerization and CI/CD deployment

You follow these principles:
1. Always confirm with user before implementing any OLT command
2. Cite sources for CLI commands
3. Use forward slashes in remote paths
4. Never commit secrets to code
5. Write minimal, focused code
```

---

## 2. Common Development Prompts

### 2.1 Adding a New API Endpoint

```
Create a new API endpoint for [RESOURCE] with:
- GET /api/[RESOURCE] — List all (with filters)
- POST /api/[RESOURCE] — Create (require_write)
- PUT /api/[RESOURCE]/{id} — Update (require_write)
- DELETE /api/[RESOURCE]/{id} — Delete (require_write)

Follow existing patterns in devices.py and fiber.py.
Use Pydantic schemas for request/response.
Add to main.py router registration.
```

### 2.2 Adding a New Database Table

```
Add a new table [TABLE_NAME] to models.py with:
- id: INTEGER PK auto-increment
- [columns based on requirements]
- created_at: TIMESTAMPTZ with server_default=now()
- Foreign keys with appropriate ondelete (CASCADE or SET NULL)
- Indexes on frequently queried columns

Then create corresponding Pydantic schemas in schemas.py.
```

### 2.3 Adding a New Scheduled Job

```
Add a new scheduled job to scheduler.py:
- Job ID: [JOB_ID]
- Trigger: Interval [INTERVAL] seconds
- Function: _[function_name]
- Max instances: 1
- Coalesce: True

The job should:
1. Query enabled devices
2. Process each device
3. Log results
4. Handle errors gracefully

Add job status tracking with _track_job and _finish_job.
```

### 2.4 Adding a New Frontend Page

```
Create a new page [PageName].tsx:
- Functional component with TypeScript
- Use existing Layout component
- Fetch data from /api/[endpoint]
- Handle loading and error states
- Use Tailwind CSS for styling
- Follow existing page patterns

Add route to App.tsx and nav link to Layout.tsx.
```

---

## 3. OLT-Specific Prompts

### 3.1 BDCOM OLT Commands

```
IMPORTANT: Always confirm with user before implementing any OLT command.
Cite sources for CLI commands.

Common BDCOM commands:
- show epon onu information — List all ONUs
- show epon onu status [port] [onu_id] — ONU status
- show epon optical-transceiver-diagnosis [port] [onu_id] — Optical power
- configure terminal — Enter config mode
- epon onu profile [name] — Create ONU profile
- write all — Save configuration

BDCOM limitations:
- Only ~36 commands per telnet session
- Must create new session for each ONU operation
```

### 3.2 SNMP Polling

```
SNMP OIDs for optical telemetry:
- EPON Rx: .1.3.6.1.4.1.3320.10.3.5.1.5
- EPON Tx: .1.3.6.1.4.1.3320.10.3.5.1.6
- GPON Rx: .1.3.6.1.4.1.3320.10.3.4.1.2
- GPON Tx: .1.3.6.1.4.1.3320.10.3.4.1.3

Note: SNMP Rx values are ONU self-reported (CTC DDM),
different from CLI optical-transceiver-diagnosis (OLT-measured).
```

### 3.3 Mikrotik API

```
Mikrotik RouterOS API commands:
- /ppp/active/print — List active PPPoE sessions
- /routing/bgp/session/print — List BGP sessions
- /routing/bgp/advertisements/print — List advertised routes

Version differences:
- v6: state field = "established" (string)
- v7: state field = established (boolean)
```

---

## 4. Fiber Infrastructure Prompts

### 4.1 Cable Management

```
Cable rules:
- Auto-generate link_id: FC-XXXX (4-digit hex)
- Auto-uppercase: link_name, code, manufacturer
- Cable types: round, figure-8
- Route types: driving, walking
- Auto-route generation via OSRM
- Segments store GPS polylines
```

### 4.2 TJ Box Management

```
TJ box rules:
- Auto-generate unique_id: TJ-XXXX (4-digit hex)
- Auto-uppercase: name
- Box types and valid port counts:
  - home_tj: tj_port=2
  - regular_tj: tj_port ∈ {4, 8, 10, 12}
- Capacity formula: capacity = tray_count × splice_per_tray
- Default values: tj_port=8, capacity=12, tray_count=1, splice_per_tray=12
```

### 4.3 Splice Validation

```
Splice rules:
- A core can only splice with one other core
- Validation on create AND update
- Check both cable_a/core_a and cable_b/core_b
- Status options: active, spare, broken
- unused-cores endpoint returns spare_cores and occupied_cores
```

---

## 5. Approval Queue Prompts

### 5.1 Submitting for Approval

```
Approval submission workflow:
1. Upload photo via POST /api/approvals/upload-photo
2. Get GPS coordinates from device
3. Submit via POST /api/approvals/submit with:
   - action: create/update/delete
   - entity_type: tj/tj_splitter/cable/user/etc.
   - payload_json: serialized change body
   - previous_data_json: snapshot (for updates)
   - photos_json: array of photo filenames
   - location_json: {"lat": ..., "lng": ...}
   - priority: low/normal/high/urgent
```

### 5.2 Reviewing Submissions

```
NOC review workflow:
1. View pending count: GET /api/approvals/pending-count
2. List submissions: GET /api/approvals?status=pending
3. View detail: GET /api/approvals/{id}
4. Take action:
   - Approve: PUT /api/approvals/{id}/approve
   - Reject: PUT /api/approvals/{id}/reject
   - Return: PUT /api/approvals/{id}/return (with correction_note)
```

### 5.3 Resubmitting Corrections

```
Field team resubmission:
1. Check submission status: GET /api/approvals/{id}
2. If status = "returned_for_correction":
   - Read correction_note
   - Capture new photos if needed
   - Resubmit: PUT /api/approvals/{id}/resubmit
     with updated payload_json and photos_json
```

---

## 6. Deployment Prompts

### 6.1 Deploying Changes

```
Deployment workflow:
1. Push to main branch
2. CI/CD auto-triggers:
   - SSH to server
   - git pull origin main
   - docker compose build --no-cache
   - docker compose up -d --force-recreate
   - docker image prune -f
3. Verify: docker compose ps
```

### 6.2 Database Migration

```
Manual migration workflow:
1. Create migration SQL in backend/migrations/
2. SSH to server
3. Run: psql -U olt -d infra_nexus -f /opt/infra-nexus/backend/migrations/XXX.sql
4. Verify: psql -U olt -d infra_nexus -c "\d+ table_name"
```

### 6.3 Container Rebuild

```
When to rebuild:
- Python code changes → docker compose up -d --build backend
- Frontend changes → Auto-deploy via CI/CD
- New Python packages → docker compose up -d --build backend
- Environment changes → docker compose up -d (restart only)
```

---

## 7. Testing Prompts

### 7.1 API Testing

```
Test API endpoint:
1. Login: POST /api/auth/login {"username":"admin","password":"admin123"}
2. Use token: Authorization: Bearer <token>
3. Test endpoint with curl or Postman
4. Verify response format and status code
5. Check database for side effects
```

### 7.2 Database Testing

```
Test database operations:
1. Backup first: pg_dump
2. Run test operations
3. Verify with SELECT queries
4. Check constraints and indexes
5. Restore if needed
```

---

## 8. Debugging Prompts

### 8.1 OLT Connection Issues

```
Debug OLT connection:
1. Check IP connectivity: ping <OLT_IP>
2. Check port: telnet <OLT_IP> 23
3. Verify credentials
4. Check backend logs: docker compose logs backend
5. Test via API: POST /api/devices/olts/{id}/test
```

### 8.2 SNMP Issues

```
Debug SNMP polling:
1. Test community: snmpwalk -v2c -c <community> <IP> sysDescr
2. Test specific OID: snmpwalk -v2c -c <community> <IP> <OID>
3. Check firewall: UDP port 161
4. Verify snmp_enabled=true on OLT device
5. Check backend logs for SNMP errors
```

### 8.3 Scheduler Issues

```
Debug scheduler:
1. Check status: GET /api/scheduler/status
2. Look for "failed" status
3. Read error message
4. Check backend logs for job execution
5. Restart if stuck: docker compose restart backend
```

---

## 9. Code Review Prompts

### 9.1 Backend Code Review

```
Review backend code:
1. Check type hints on all functions
2. Verify permission guards on endpoints
3. Check error handling (try/except)
4. Verify database session management
5. Check for SQL injection (use ORM, not raw SQL)
6. Verify input validation (Pydantic)
```

### 9.2 Frontend Code Review

```
Review frontend code:
1. Check TypeScript types
2. Verify API error handling
3. Check loading states
4. Verify responsive design
5. Check accessibility
6. Verify permission-based UI rendering
```

---

## 10. Documentation Prompts

### 10.1 API Documentation

```
Document API endpoint:
1. Method and path
2. Permission guard
3. Request body (JSON example)
4. Response body (JSON example)
5. Error responses
6. Query parameters
7. Path parameters
```

### 10.2 Database Documentation

```
Document table:
1. Table name and purpose
2. All columns with types
3. Primary key
4. Foreign keys with ondelete
5. Unique constraints
6. Indexes
7. Relationships
8. Business rules
```
