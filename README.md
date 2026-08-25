# Infra NEXUS

A comprehensive web platform for managing GPON/EPON OLTs, scanning and adding rejected ONUs, matching MAC addresses against Mikrotik servers, managing ONU inventory, switches, subscriber profiles, and fiber infrastructure maps.

## Stack

| Layer      | Tech                                                        |
| ---------- | ----------------------------------------------------------- |
| Frontend   | React 18 + TypeScript + Tailwind CSS + Vite + Leaflet       |
| Backend    | Python 3.10 + FastAPI + SQLAlchemy (async) + APScheduler    |
| Database   | PostgreSQL 16                                               |
| Device I/O | Telnet (built-in), SSH (asyncssh), SNMP (pysnmp), RouterOS API (librouteros), HTTP (TR-069/ACS) |
| Exports    | Excel (openpyxl), PDF (reportlab)                           |
| Deploy     | Bare metal behind nginx                                     |

## Features

### OLT Management
- Register BDCOM GPON/EPON OLTs with telnet/SSH access
- Live ONU table scanning (state, serial, optical power)
- Rejected ONU discovery with one-click authorization
- ONU add/remove directly from the platform
- ONU description setting and EPON bandwidth (SLA) control
- ONU Ethernet port enable/disable via OLT CLI

### Mikrotik Integration
- RouterOS API (v6/v7) connection and scanning
- ARP + DHCP lease table collection
- Live PPPoE session tracking
- MAC binding engine: matches OLT-learned MACs against Mikrotik PPPoE

### ONU Inventory & Profiles
- Per-ONU address, GPS, phone, email, notes
- WiFi status card (TP-Link, Tenda, Cudy, Mercury, Mercusys, Netis, D-Link, Asus)
- Telemetry graph with RX/TX power over time
- MAC change history and live downtime timeline

### Fiber Infrastructure Map
- Interactive Leaflet map for fiber network management
- TJ Boxes (splice closures) with port/capacity/tray tracking
- Splitters hosted inside TJ boxes
- Cables with OSRM auto-routing between TJ endpoints
- Cable cuts/repairs tracking
- Splice management with TIA-598 core color standard
- Cable jacket color coding by core count
- Drag mode for TJ boxes and cable segments
- Export/Import fiber network as XLSX
- NOC/POP locations with device status on map

### Network Map
- Subscriber GPS points with OLT/port clustering
- Status summary, search, user detail panel
- Edit GPS/address for write users

### Subscriber Management
- PPPoE subscriber list with search
- Per-subscriber telemetry with server-side downsampling
- Remote access probing
- WiFi config read/change via TR-069

### Reports & Analytics
- Dashboard: KPI cards, router brand bubble chart, RX signal histogram
- Optical power report (avg/min/max per ONU)
- Power fluctuation detection
- Downtime aggregation
- PON port utilization
- Weakest optical signals (Top N)
- All reports exportable to Excel and PDF

### Down Detection
- Per-ONU down/recovery event tracking
- Mass-outage detection (feeder/cable cuts)
- Area labels for PON ports

### ACS (TR-069)
- Device inventory and parameter read
- WiFi password change
- WAN configuration push
- Firmware update
- Device reboot

### Other
- JWT authentication with RBAC (admin / ops / read)
- Port area labels for human-readable PON port names
- User management (CRUD)
- Ticket system for operator tasks
- Global search across ONUs, OLTs, and Mikrotiks

## Project Layout

```
infra-nexus/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app + lifespan (init db, seed admin, scheduler)
│   │   ├── config.py          # settings (env driven)
│   │   ├── database.py        # async engine / session
│   │   ├── models.py          # ORM models
│   │   ├── schemas.py         # Pydantic DTOs
│   │   ├── security.py        # JWT + bcrypt
│   │   ├── api/               # auth, devices, onus, bindings, dashboard, reports,
│   │   │                      # subscribers, map, downs, tickets, acs, users,
│   │   │                      # search, fiber, noc_pop
│   │   ├── drivers/           # base, snmp, bdcom, mikrotik
│   │   ├── services/          # collector, mac_binding, mac_vendor, router_wifi, scheduler
│   │   └── utils/             # mac helpers, telnet client, export (xlsx/pdf), time
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/               # typed API client + types
│   │   ├── components/        # layout, SubscriberLink, ActionResultBanner, etc.
│   │   ├── lib/               # role helpers, time formatting
│   │   └── pages/             # login, dashboard, devices, onus, subscribers,
│   │                          # fiber map, network map, user map, reports, tickets, etc.
│   ├── index.html
│   └── vite.config.ts
├── .deploy/                   # SSH key for deployment
└── README.md
```

## Quick Start

### Docker

```bash
cd infra-nexus
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080 (docs at /docs)
- Default login: `admin` / `admin123`

### Local Development

#### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Linux/Mac
# .venv\Scripts\activate         # Windows
pip install -r requirements.txt

# Copy and edit .env
copy .env.example .env

# Start
uvicorn app.main:app --reload --port 8080
```

Tables are auto-created on startup. Default admin is seeded if none exists.

#### Frontend

```bash
cd frontend
npm install
npx vite dev                    # http://localhost:5173, proxies /api to :8080
```

## Deployment

### Production Build

```bash
cd frontend
npx vite build                  # outputs to dist/

# Deploy to server
scp -r dist/ root@server:/opt/infra-nexus/frontend/dist/
ssh root@server "systemctl restart infra-nexus"
```

### Server Configuration

- Backend runs on `127.0.0.1:8080` via uvicorn
- Nginx serves the SPA from `dist/` with API proxy
- Telemetry data retained for 90 days (configurable in `collector.py`)

## Adding Devices

### OLT

1. Navigate to **Devices** page
2. Click **Add OLT**
3. Fill in: name, IP, vendor (BDCOM), PON type (GPON/EPON)
4. Set access method: `telnet` (port 23) or `ssh` (port 22)
5. Enter username/password
6. Click **Test** to verify connectivity
7. Click **Scan** to collect ONUs and MACs

### Mikrotik

1. Navigate to **Devices** page
2. Click **Add Mikrotik**
3. Fill in: name, IP, API port (8728 or 8729 for TLS)
4. Enter username/password, RouterOS version (6/7)
5. Click **Test** then **Scan**

### Switch

1. Navigate to **Devices** page
2. Click **Add Switch**
3. Fill in: name, IP, vendor, port count, access method, credentials
4. Click **Test** then **Scan**

## BDCOM Driver Notes

### CLI Commands

- `show gpon onu-information` / `show epon onu-information`
- `show gpon onu-optical-transceiver-diagnosis interface gpon x/y`
- `show mac address-table`
- `show gpon onu-rejected` / `show epon rejected-onu`
- `epon bind-onu mac XX.XX.XX.XX.XX.XX [sequence]` (EPON add ONU)
- `gpon bind-onu sn VENDOR:SERIAL [sequence]` (GPON add ONU)
- `description TEXT` inside `interface {epon|gpon} 0/X:Y` (set ONU description)
- `no epon onu port X ctc shutdown` (EPON port enable)
- `gpon onu uni X noshutdown` (GPON port enable)

### SNMP

- BDCOM GPON MIB (enterprise 3320)
- ONU status: `10.3.3.1.4`
- ONU RX power: `10.3.4.1.2` (0.1 dBm)
- ONU TX power: `10.3.4.1.3` (0.1 dBm)

## API Documentation

See [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) for the complete API reference with all 115 endpoints.

### Authentication

```bash
# Login
curl -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'

# Response: { "access_token": "...", "token_type": "bearer" }

# Use token in subsequent requests
curl -H "Authorization: Bearer <token>" http://localhost:8080/api/dashboard
```

### Interactive API Docs

FastAPI provides auto-generated interactive documentation:
- Swagger UI: http://localhost:8080/docs
- ReDoc: http://localhost:8080/redoc

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander` | PostgreSQL connection string |
| `JWT_SECRET` | `change-me-in-production` | JWT signing secret |
| `ADMIN_USERNAME` | `admin` | Default admin username |
| `ADMIN_PASSWORD` | `admin123` | Default admin password |

## Roadmap

- Other OLT vendors: implement `BaseDriver` in `app/drivers/`
- Alembic migrations
- Email/webhook notifications for outages
- Rate limiting for multi-user operation
- Encrypted credential storage

## License

Internal use only.
