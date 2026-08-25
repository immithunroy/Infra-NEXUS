# OLT Commander

Web platform for monitoring GPON/EPON OLTs and matching the MAC addresses
they learn against the MAC/IP table of Mikrotik (RouterOS) servers.

## Stack

| Layer      | Tech                                                        |
| ---------- | ----------------------------------------------------------- |
| Frontend   | React 18 + TypeScript + Tailwind CSS + Vite + Leaflet       |
| Backend    | Python 3.12 + FastAPI + SQLAlchemy (async) + APScheduler    |
| Database   | PostgreSQL 16                                               |
| Device I/O | SNMP (pysnmp), Telnet (built-in client), SSH (asyncssh), RouterOS API (librouteros), HTTP (routers, ACS) |
| Exports    | Excel (openpyxl), PDF (reportlab)                           |
| Deploy     | Docker Compose / bare metal behind nginx                    |

## Features

- **OLT devices** (BDCOM P3310/P3608 family initially): register credentials,
  choose access method (telnet / ssh / snmp), test connectivity, and scan.
- **ONU/ONT collection**: pulls the ONU table (serial, state), optical RX/TX
  power and the learned MAC table per PON port.
- **Mikrotik collection**: pulls the ARP + DHCP lease table over the RouterOS
  API (v6 or v7) plus live PPPoE sessions.
- **MAC binding engine**: compares OLT-learned MACs against Mikrotik MACs,
  records which customer IP is bound to which PON port, and mirrors it onto
  the ONU records (router/CPE brand auto-resolved from the MAC OUI).
- **Subscriber profiles**: per-ONU address / GPS / phone / notes, WiFi status
  card, telemetry graph, MAC change history and live downtime timeline.
- **Router WiFi service** (`/api/subscribers/{id}/wifi`): reads the current
  SSID/password per brand (TP-Link, Tenda, Cudy, Mercury, Mercusys, Netis,
  D-Link, Asus) via HTTP — extensible to change password / reboot / firmware.
- **Live down detection**: per-ONU down/recovery events, mass-outage windows
  (feeder/cable cuts) flagged per PON port with power-off vs wire-down reasons.
- **Reports** (`/api/reports`): network summary, weekly **optical power** per
  ONU/port (avg/min/max/last RX·TX), **downtime** aggregation, **PON port
  utilization**, and **power fluctuation** (ONUs with RX max-min >= 3 dB) —
  each sortable in the UI, filterable by OLT/port/threshold, and exportable
  to **Excel and PDF**.
- **ONU port control** (`/api/onus/port-control`): enable/disable ONU Ethernet
  UNI ports (1-4) via OLT CLI — works for both EPON and GPON ONTs.
- **Rejected ONU discovery** (`/api/devices/olts/{id}/rejected`): real-time
  scan of the OLT's live ONU state table — shows ONUs that are currently
  deregistered/unauthorized (auth failures), with one-click "Add ONU" to
  authorize and register them into the inventory.
- **Dashboard**: animated proportional-area router-brand bubble chart, weakest
  optical signals (Top N, filterable by OLT/port, Excel/PDF export), RX signal
  quality histogram, capacity utilization, mass-down areas, GPS coverage.
- **Network map** (Leaflet): subscriber GPS points with OLT/port clustering.
- **ACS** (TR-069 style): device inventory, parameter read, metrics, jobs,
  and WiFi password change through the router vendor HTTP APIs.
- **Tickets**: operator task tracking linked to subscribers.
- **Port areas**: human labels for PON ports (e.g. `EPON0/1` -> "Rampura South").
- JWT login (RBAC admin / ops / read), dashboard summary, scan log history.

## Project layout

```
olt-commander/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app + lifespan (init db, seed admin, scheduler)
│   │   ├── config.py          # settings (env driven)
│   │   ├── database.py        # async engine / session
│   │   ├── models.py          # ORM models
│   │   ├── schemas.py         # Pydantic DTOs
│   │   ├── security.py        # JWT + bcrypt
│   │   ├── api/               # auth, devices, onus, bindings, dashboard, reports, subscribers, map, downs, tickets, acs, users, search
│   │   ├── drivers/           # base, snmp, bdcom, mikrotik
│   │   ├── services/          # collector, mac_binding, mac_vendor, router_wifi, scheduler
│   │   └── utils/             # mac helpers, telnet client, export (xlsx/pdf), time
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/               # typed API client
│   │   ├── components/        # layout
│   │   └── pages/             # login, dashboard, devices, onus, bindings, scans
│   ├── Dockerfile
│   └── nginx.conf             # serves SPA + proxies /api to backend
├── docker-compose.yml
└── README.md
```

## Quick start (Docker)

```bash
cd olt-commander
docker compose up --build
```

Then open http://localhost:3000 and log in with the default admin
(`admin` / `admin123`). Change these via the `ADMIN_*` environment
variables in `docker-compose.yml`.

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080 (docs at /docs)

## Local development

### Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt   # includes openpyxl + reportlab for report export
# needs a reachable Postgres; defaults:
#   postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander
copy .env.example .env        # adjust DATABASE_URL / secrets
uvicorn app.main:app --reload --port 8080
```

Tables are created automatically on startup and a default admin user is
seeded if none exist. No migration tool is used yet; see
"Roadmap" below.

### Frontend

```bash
cd frontend
npm install
npm run dev                    # http://localhost:5173, proxies /api to :8080
```

## Adding devices

1. **OLT** – name, IP, vendor (bdcom), PON type (gpon/epon), access method:
   - `telnet` (default, port 23) or `ssh` (port 22) with username/password
     and optional enable password.
   - `snmp` with community string (uses the BDCOM GPON MIB, enterprise 3320).
   - Click **Test** to verify credentials, then **Scan** to collect ONUs/MACs.
2. **Mikrotik** – IP, RouterOS API port (8728, or 8729 for TLS), username/
   password, RouterOS version (6/7). Click **Test** then **Scan**.

Then open **MAC Bindings** and press **Run binding comparison**, or just wait
for the periodic scheduler. The **ONU / ONT** page lets you add or remove
inventory entries — application-only, never touching the router or OLT.

## Notes on the BDCOM driver

- CLI commands used (parsing is tolerant of output variations):
  - `show gpon onu-information` / `show epon onu-information`
  - `show gpon onu-optical-transceiver-diagnosis interface gpON x/y`
    (or the EPON equivalent)
  - `show mac address-table` (fallback `show mac-address-table dynamic`)
- SNMP path uses the BDCOM GPON MIB (1.3.6.1.4.1.3320):
  - ONU status `10.3.3.1.4`, ONU RX `10.3.4.1.2`, ONU TX `10.3.4.1.3`
    (values in 0.1 dBm).
- MAC collection works best over the CLI because the output carries the PON
  port. If your firmware only exposes MACs via SNMP, wire the walk OIDs into
  `drivers/bdcom.py` (see `BdcomSnmpDriver.get_macs`).

## Fiber Network Map

Interactive Leaflet map for managing fiber infrastructure:

- **TJ Boxes** — splice closure/joint boxes with unique IDs (`TJ-5001+`), auto-generated on create
  - Types: Home TJ, Regular TJ, Enclosure, Dome/Bamboo
  - TJ Port (2–12), Splice Capacity (2–144), Tray Count (1–12)
- **Splitters** — optical splitters hosted inside TJ boxes (`SP-1001+`), GPS auto-filled from TJ
- **Cables** — fiber links with:
  - `Link ID` (auto-generated `LINK-1001+`), `Link Name` (manual)
  - Source/Destination TJ dropdowns (auto-route via OSRM driving or walking)
  - Core count, type, manufacturer, cable code
  - Visual route drawn on map between TJ endpoints
- **Cable SRC>DST mode** — click two TJ markers on map to auto-create cable with OSRM route
- **Export/Import Excel** — 3-sheet xlsx (TJ Boxes, Splitters, Cables)
- **Right-click context menu** — add TJ, Splitter, or Cable at clicked location
- **TJ detail panel** — click TJ marker to see internal diagram, connected cables, hosted splitters
- **Delete cascade** — deleting TJ box also deletes hosted splitters
- **Fullscreen mode** — bottom-right toggle for max map visibility

## Roadmap / extension points

- **Other vendors**: implement `BaseDriver` (e.g. `zte.py`, `huawei.py`) in
  `app/drivers/` and add them to `build_driver()`.
- **Alarm / outage events**, webhooks or email notifications.
- **Alembic migrations** once the schema stabilizes.
- **Rate limiting and RBAC** for multi-user operation.

## Security notes

- The default admin credentials are for first boot only — change them and
  the `JWT_SECRET` before any production use.
- Device passwords are stored in plain text in the database (as with most
  NMS tools). Consider encrypting at rest if the DB is shared.