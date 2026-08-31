# System Architecture

## Infra NEXUS — Architecture Overview

**Version:** 1.0  
**Last Updated:** 2026-08-31

---

## 1. High-Level Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        WEB["Web Dashboard<br/>(React 18 + TypeScript)"]
        ANDROID["Android App<br/>(Field Team)"]
    end

    subgraph "Edge Layer"
        NGINX["Nginx Reverse Proxy<br/>:8050 → :8080"]
    end

    subgraph "Application Layer"
        FASTAPI["FastAPI Backend<br/>Python 3.12 + AsyncIO"]
        SCHEDULER["APScheduler<br/>Background Jobs"]
    end

    subgraph "Data Layer"
        PG["PostgreSQL 16<br/>infra_nexus DB"]
    end

    subgraph "External Network Devices"
        OLT["BDCOM OLTs<br/>(GPON/EPON)"]
        MK["Mikrotik Routers<br/>(RouterOS v6/v7)"]
        SWITCH["BDCOM Switches"]
        ACS_DEVICE["CPE Routers<br/>(TR-069)"]
    end

    subgraph "External Services"
        OSRM["OSRM<br/>(Route Generation)"]
        MAC_VENDOR["MAC Vendor API<br/>(OUI Lookup)"]
        SNMP["SNMP Agent<br/>(OLT Telemetry)"]
    end

    WEB --> NGINX
    ANDROID --> NGINX
    NGINX --> FASTAPI
    FASTAPI --> PG
    FASTAPI --> SCHEDULER
    SCHEDULER --> OLT
    SCHEDULER --> MK
    SCHEDULER --> SWITCH
    SCHEDULER --> ACS_DEVICE
    FASTAPI --> OSRM
    FASTAPI --> MAC_VENDOR
    SCHEDULER --> SNMP
```

---

## 2. Deployment Architecture

```mermaid
graph TB
    subgraph "Production Server — 103.177.54.6"
        subgraph "Docker Compose"
            FE["Frontend Container<br/>nginx:alpine<br/>:8050 → :80"]
            BE["Backend Container<br/>python:3.12-slim<br/>:8080"]
            DB["Database Container<br/>postgres:16-alpine<br/>:5432"]
        end
        subgraph "External Services"
            PROXY["NPM Proxy<br/>(SSL termination)"]
        end
    end

    subgraph "CI/CD Pipeline"
        GITHUB["GitHub Actions<br/>push to main"]
        SSH["SSH Deploy<br/>git pull + docker compose"]
    end

    GITHUB -->|"git push"| GITHUB
    GITHUB -->|"SSH + deploy"| SSH
    SSH -->|"docker compose up -d --build"| BE
    PROXY -->|"nexus.qbinternet.com"| FE
    FE --> BE
    BE --> DB
```

### Container Details

| Container | Base Image | Port | Volume | Network |
|-----------|-----------|------|--------|---------|
| `infra-nexus-frontend` | `nginx:alpine` | 8050→80 | Static build | `nexus_internal` |
| `infra-nexus-backend` | `python:3.12-slim` | 8080 | `/app/uploads/approval-photos` | `nexus_internal`, `proxy_npm_network` |
| `infra-nexus-db` | `postgres:16-alpine` | 5432 (internal) | `nexus_pgdata` | `nexus_internal` |

### Network Topology

- `nexus_internal` — Internal bridge network for container-to-container communication
- `proxy_npm_network` — External network connecting to Nginx Proxy Manager for SSL termination

---

## 3. Backend Architecture

```mermaid
graph TB
    subgraph "FastAPI Application"
        MAIN["main.py<br/>App factory + lifespan"]
        subgraph "API Layer (Routers)"
            AUTH["auth.py"]
            DEVICES["devices.py"]
            ONUS["onus.py"]
            BINDINGS["bindings.py"]
            DASHBOARD["dashboard.py"]
            SEARCH["search.py"]
            SUBSCRIBERS["subscribers.py"]
            DOWNS["downs.py"]
            MAP["map.py"]
            USERS["users.py"]
            REPORTS["reports.py"]
            TICKETS["tickets.py"]
            ACS_API["acs.py"]
            FIBER["fiber.py"]
            FIBER_APPROVALS["fiber_approvals.py"]
            APPROVALS["approvals.py"]
            NOC_POP["noc_pop.py"]
        end

        subgraph "Security Layer"
            SECURITY["security.py<br/>JWT + RBAC"]
        end

        subgraph "Services Layer"
            COLLECTOR["collector.py<br/>OLT/Mikrotik scanning"]
            SCHEDULER_SVC["scheduler.py<br/>APScheduler jobs"]
            BINDING_SVC["bindings.py<br/>MAC binding"]
            BGP_SVC["BGP (inline in collector)"]
        end

        subgraph "Drivers Layer"
            BDCOM["bdcom.py<br/>OLT telnet/SSH driver"]
            MIKROTIK["mikrotik.py<br/>RouterOS API driver"]
        end

        subgraph "Data Layer"
            MODELS["models.py<br/>SQLAlchemy ORM"]
            SCHEMAS["schemas.py<br/>Pydantic models"]
            DATABASE["database.py<br/>Async session"]
        end
    end

    MAIN --> AUTH
    MAIN --> DEVICES
    MAIN --> ONUS
    MAIN --> BINDINGS
    MAIN --> DASHBOARD
    MAIN --> SEARCH
    MAIN --> SUBSCRIBERS
    MAIN --> DOWNS
    MAIN --> MAP
    MAIN --> USERS
    MAIN --> REPORTS
    MAIN --> TICKETS
    MAIN --> ACS_API
    MAIN --> FIBER
    MAIN --> FIBER_APPROVALS
    MAIN --> APPROVALS
    MAIN --> NOC_POP

    AUTH --> SECURITY
    DEVICES --> SECURITY
    ONUS --> SECURITY
    FIBER --> SECURITY
    APPROVALS --> SECURITY

    DEVICES --> COLLECTOR
    ONUS --> COLLECTOR
    BINDINGS --> BINDING_SVC

    COLLECTOR --> BDCOM
    COLLECTOR --> MIKROTIK

    COLLECTOR --> MODELS
    COLLECTOR --> DATABASE
    SCHEDULER_SVC --> COLLECTOR
```

### Key Design Patterns

#### 3.1 Dependency Injection (FastAPI)
```python
# Every route handler receives its dependencies via FastAPI's DI system
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    ...
```

#### 3.2 Role-Based Access Control (RBAC)
```
admin > global_write > noc > field_team > global_read
```
Each endpoint has a permission guard function:
- `get_current_user` — any authenticated user
- `require_write` — admin, global_write
- `require_ops` — admin, global_write, noc
- `require_gps_write` — admin, global_write, field_team
- `require_admin` — admin only
- `require_fiber_request` — admin, global_write, field_team
- `require_noc_approval` — admin, global_write, noc
- `require_approval_submit` — admin, global_write, field_team

#### 3.3 Upsert Pattern
```python
# Used throughout collector.py for idempotent data collection
result = await session.execute(select(Model).where(Model.field == value))
existing = result.scalar_one_or_none()
if existing:
    existing.field = new_value
else:
    session.add(Model(field=new_value))
```

#### 3.4 Scheduled Job Pattern
```python
# APScheduler with async job functions
scheduler.add_job(
    _scan_all_olts,
    "interval",
    seconds=settings.scan_olt_interval,
    id="scan_olts",
    max_instances=1,
    coalesce=True,
)
```

---

## 4. Frontend Architecture

```mermaid
graph TB
    subgraph "React Application"
        APP["App.tsx<br/>Router + Auth"]
        subgraph "Pages"
            DASH["Dashboard"]
            DEVICES_PAGE["Devices"]
            ONUS_PAGE["ONUs"]
            ONU_PROFILE["OnuProfile"]
            BINDINGS_PAGE["Bindings"]
            SUBSCRIBERS_PAGE["Subscribers"]
            SUB_PROFILE["SubscriberProfile"]
            TICKETS_PAGE["Tickets"]
            ACS_PAGE["ACS"]
            LIVE_DOWNS["LiveDowns"]
            NET_MAP["NetworkMap"]
            FIBER_MAP["FiberMap"]
            REPORTS_PAGE["Reports"]
            ROUTING_PAGE["Routing"]
            USERS_PAGE["Users"]
            SCANS_PAGE["Scans"]
            SCHEDULE_PAGE["ScheduleJobs"]
            NOC_APPROVALS["NocApprovals"]
            APPROVAL_DETAIL["ApprovalDetail"]
        end

        subgraph "Components"
            LAYOUT["Layout.tsx<br/>Sidebar + Header"]
            MAP_COMP["Map Components<br/>(Leaflet)"]
            CHARTS["Chart Components<br/>(Sparklines)"]
        end

        subgraph "API Layer"
            API["api.ts<br/>Axios instance"]
            TYPES["types.ts<br/>TypeScript types"]
        end
    end

    APP --> LAYOUT
    APP --> API
    API --> TYPES
    LAYOUT --> DASH
    LAYOUT --> DEVICES_PAGE
    LAYOUT --> ONUS_PAGE
    LAYOUT --> ONU_PROFILE
    LAYOUT --> BINDINGS_PAGE
    LAYOUT --> SUBSCRIBERS_PAGE
    LAYOUT --> SUB_PROFILE
    LAYOUT --> TICKETS_PAGE
    LAYOUT --> ACS_PAGE
    LAYOUT --> LIVE_DOWNS
    LAYOUT --> NET_MAP
    LAYOUT --> FIBER_MAP
    LAYOUT --> REPORTS_PAGE
    LAYOUT --> ROUTING_PAGE
    LAYOUT --> USERS_PAGE
    LAYOUT --> SCANS_PAGE
    LAYOUT --> SCHEDULE_PAGE
    LAYOUT --> NOC_APPROVALS
    LAYOUT --> APPROVAL_DETAIL
```

### Frontend Routes

| Path | Component | Auth | Description |
|------|-----------|------|-------------|
| `/login` | Login | No | Authentication page |
| `/` | Dashboard | Yes | Main dashboard |
| `/devices` | Devices | Yes | OLT/Mikrotik/Switch management |
| `/onus` | Onus | Yes | ONU inventory list |
| `/onus/:id` | OnuProfile | Yes | Individual subscriber profile |
| `/bindings` | Bindings | Yes | MAC binding resolution |
| `/subscribers` | Subscribers | Yes | Subscriber list |
| `/subscribers/:subscriber` | SubscriberProfile | Yes | Subscriber detail |
| `/tickets` | Tickets | Yes | Support tickets |
| `/acs` | Acs | Yes | TR-069 device management |
| `/live-downs` | LiveDowns | Yes | Real-time down detection |
| `/network-map` | NetworkMap | Yes | Subscriber map |
| `/fiber-map` | FiberMap | Yes | Fiber infrastructure map |
| `/reports` | Reports | Yes | Reports and exports |
| `/routing` | Routing | Yes | BGP monitoring |
| `/users` | Users | Yes | User management (admin) |
| `/scans` | Scans | Yes | Scan log history |
| `/schedule-jobs` | ScheduleJobs | Yes | Scheduled job status |
| `/approvals` | NocApprovals | Yes | NOC approval queue |
| `/approvals/:id` | ApprovalDetail | Yes | Approval review page |

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Build | Vite | 5.4.11 |
| UI Framework | React | 18.3.1 |
| Language | TypeScript | 5.6.3 |
| Routing | React Router | 6.28.0 |
| Styling | Tailwind CSS | 3.4.17 |
| Maps | Leaflet + leaflet-draw | 1.9.4 / 1.0.4 |
| HTTP Client | Axios | (via api.ts) |

---

## 5. Data Flow Diagrams

### 5.1 OLT Scan Flow

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant C as Collector
    participant D as BDCOM Driver
    participant DB as PostgreSQL

    S->>C: scan_olt(olt_id)
    C->>D: build_driver(device)
    D->>D: connect(telnet/ssh)
    C->>D: get_onus()
    D-->>C: List[OnuInfo]
    C->>D: get_macs()
    D-->>C: List[MacEntry]
    
    loop For each ONU
        C->>DB: upsert_onu()
    end
    
    loop For each MAC
        C->>DB: upsert_mac()
    end
    
    C->>DB: Purge unseen MACs
    C->>DB: Save ScanLog
```

### 5.2 Subscriber Provisioning Flow

```mermaid
sequenceDiagram
    participant U as User
    participant API as FastAPI
    participant DB as PostgreSQL
    participant OLT as BDCOM OLT

    U->>API: POST /api/onus (create ONU)
    API->>API: validate role (require_write)
    API->>DB: INSERT onu
    DB-->>API: onu_id
    
    U->>API: POST /api/devices/olts/{id}/add-onu
    API->>OLT: telnet session
    OLT->>OLT: configure onu
    OLT-->>API: success
    API->>DB: upsert_onu()
    API-->>U: {ok, pon_port, onu_id}
```

### 5.3 Field Submission → NOC Approval Flow

```mermaid
sequenceDiagram
    participant A as Android App
    participant API as FastAPI
    participant DB as PostgreSQL
    participant NOC as NOC Engineer

    A->>API: POST /api/approvals/upload-photo
    API->>API: Save photo to /app/uploads/
    API-->>A: {filename, url}
    
    A->>API: POST /api/approvals/submit
    API->>DB: INSERT fiber_approval_requests
    API-->>A: {id, status: "pending"}
    
    NOC->>API: GET /api/approvals/pending-count
    API->>DB: COUNT pending
    API-->>NOC: {total: 5, by_type: {...}}
    
    NOC->>API: PUT /api/approvals/{id}/approve
    API->>DB: UPDATE status = "approved"
    API->>DB: Execute entity change
    API->>DB: INSERT audit log
    API-->>NOC: {status: "approved"}
```

### 5.4 Telemetry Collection Flow

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant C as Collector
    participant SNMP as SNMP Agent
    participant DB as PostgreSQL

    S->>C: collect_telemetry(olt_id)
    
    loop For each OLT
        C->>SNMP: walk(OID .5.1.5) [EPON Rx]
        SNMP-->>C: Rx values
        
        C->>SNMP: walk(OID .5.1.6) [EPON Tx]
        SNMP-->>C: Tx values
        
        loop For each ONU
            C->>DB: INSERT onu_telemetry
        end
    end
    
    C->>DB: Prune records > 90 days
```

---

## 6. Security Architecture

### 6.1 Authentication Flow

```mermaid
sequenceDiagram
    participant C as Client
    participant API as FastAPI
    participant DB as PostgreSQL

    C->>API: POST /api/auth/login
    API->>DB: SELECT user WHERE username = ?
    API->>API: bcrypt.checkpw(password, hash)
    API->>API: jwt.encode({sub, username, role, exp})
    API-->>C: {access_token, token_type}
    
    loop Every Request
        C->>API: Authorization: Bearer <token>
        API->>API: jwt.decode(token)
        API->>DB: SELECT user WHERE id = sub
        API->>API: Check role permissions
        API->>API: Execute handler
        API-->>C: Response
    end
```

### 6.2 Permission Matrix

| Endpoint Category | admin | global_write | noc | field_team | global_read |
|------------------|-------|-------------|-----|------------|-------------|
| User management | ✅ | ❌ | ❌ | ❌ | ❌ |
| Device CRUD | ✅ | ✅ | ❌ | ❌ | ❌ |
| Scan/Test/Down | ✅ | ✅ | ✅ | ❌ | ❌ |
| GPS/Address update | ✅ | ✅ | ❌ | ✅ | ❌ |
| Fiber infrastructure | ✅ | ✅ | ❌ | ❌ | ❌ |
| Submit for approval | ✅ | ✅ | ❌ | ✅ | ❌ |
| Review approvals | ✅ | ✅ | ✅ | ❌ | ❌ |
| Read-only access | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 7. File Structure

```
olt-commander/
├── backend/
│   ├── app/
│   │   ├── api/                    # FastAPI routers
│   │   │   ├── acs.py             # TR-069 ACS management
│   │   │   ├── approvals.py       # Centralized NOC approval queue
│   │   │   ├── auth.py            # Authentication + JWT
│   │   │   ├── bindings.py        # MAC binding resolution
│   │   │   ├── dashboard.py       # Dashboard summary
│   │   │   ├── devices.py         # OLT/Mikrotik/Switch CRUD
│   │   │   ├── downs.py           # Live down detection
│   │   │   ├── fiber.py           # Fiber infrastructure CRUD
│   │   │   ├── fiber_approvals.py # Fiber approval workflow (legacy)
│   │   │   ├── map.py             # Network map data
│   │   │   ├── noc_pop.py         # NOC/POP management
│   │   │   ├── onus.py            # ONU management
│   │   │   ├── reports.py         # Reports + export
│   │   │   ├── search.py          # Global search
│   │   │   ├── subscribers.py     # Subscriber profiles
│   │   │   ├── tickets.py         # Support tickets
│   │   │   └── users.py           # User management
│   │   ├── drivers/               # Device communication drivers
│   │   │   ├── bdcom.py           # BDCOM OLT telnet/SSH
│   │   │   └── mikrotik.py        # Mikrotik RouterOS API
│   │   ├── services/              # Business logic
│   │   │   ├── collector.py       # OLT/Mikrotik scanning + telemetry
│   │   │   └── scheduler.py       # APScheduler background jobs
│   │   ├── utils/                 # Utility functions
│   │   │   └── time.py            # UTC time helpers
│   │   ├── models.py              # SQLAlchemy ORM models
│   │   ├── schemas.py             # Pydantic request/response schemas
│   │   ├── security.py            # JWT + RBAC + password hashing
│   │   ├── database.py            # Async SQLAlchemy setup
│   │   ├── config.py              # Pydantic Settings (env vars)
│   │   └── main.py                # FastAPI app factory
│   ├── migrations/
│   │   └── 002_extend_approvals.sql
│   ├── uploads/
│   │   └── approval-photos/       # Photo storage
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── api.ts             # Axios instance
│   │   │   └── types.ts           # TypeScript interfaces
│   │   ├── components/            # Shared components
│   │   │   └── Layout.tsx         # Sidebar + header
│   │   ├── pages/                 # Page components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Devices.tsx
│   │   │   ├── Onus.tsx
│   │   │   ├── OnuProfile.tsx
│   │   │   ├── Bindings.tsx
│   │   │   ├── Subscribers.tsx
│   │   │   ├── SubscriberProfile.tsx
│   │   │   ├── Tickets.tsx
│   │   │   ├── Acs.tsx
│   │   │   ├── LiveDowns.tsx
│   │   │   ├── NetworkMap.tsx
│   │   │   ├── FiberMap.tsx
│   │   │   ├── Reports.tsx
│   │   │   ├── Routing.tsx
│   │   │   ├── Users.tsx
│   │   │   ├── Scans.tsx
│   │   │   ├── ScheduleJobs.tsx
│   │   │   ├── NocApprovals.tsx
│   │   │   └── ApprovalDetail.tsx
│   │   ├── App.tsx                # Root component + routes
│   │   └── main.tsx               # Entry point
│   ├── Dockerfile
│   ├── package.json
│   └── tailwind.config.js
├── docker-compose.yml
├── .github/workflows/deploy.yml
└── docs/                          # This documentation
```

---

## 8. External Dependencies

### 8.1 Python Dependencies (backend)

| Package | Purpose |
|---------|---------|
| fastapi | Web framework |
| uvicorn | ASGI server |
| sqlalchemy[asyncio] | ORM |
| asyncpg | PostgreSQL async driver |
| pydantic-settings | Configuration |
| python-jose | JWT tokens |
| bcrypt | Password hashing |
| httpx | Async HTTP client |
| apscheduler | Background jobs |
| pysnmp | SNMP client |
| openpyxl | XLSX export |
| reportlab | PDF generation |
| telnetlib3 | Async telnet (OLT) |
| routeros-api | Mikrotik API |

### 8.2 External Services

| Service | URL | Purpose |
|---------|-----|---------|
| OSRM | `router.project-osrm.org` | Route generation for cables |
| MAC Vendor API | `api.macvendors.com` | OUI lookup |

---

## 9. Scalability Considerations

| Dimension | Current | Limit | Mitigation |
|-----------|---------|-------|------------|
| OLTs | ~10-50 | 200+ | Parallel scanning, configurable intervals |
| ONUs | ~1000-5000 | 50,000+ | Batch upserts, connection pooling |
| Telemetry | 90-day retention | ~10M rows | Pruning job, partitioning |
| Concurrent users | ~5-20 | 100+ | Async backend, connection pooling |
| File uploads | Photos | 10MB/file | Local storage, Docker volume |

### Connection Pool Configuration

```python
engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    echo=False,
    pool_size=10,      # base connections
    max_overflow=20,   # burst connections
)
```
