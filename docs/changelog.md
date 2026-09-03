# Changelog

## Infra NEXUS — Project Change Log

---

## 2026-09-02

### Fixed

- **Network Map dropdown filter order and customer visibility bug**
  - Corrected dropdown option sequence: All → Links → TJ Boxes → Splitters → Customers
  - Fixed dropdown value from `customer` (singular) to `customers` (plural)
  - Fixed critical bug: selecting "Customers" now correctly shows customer markers instead of hiding all layers
  - Root cause: main map layer effect removes all non-tile layers on re-render, but user layer useEffect didn't re-run because `filterType` wasn't in its dependency array
  - Added `filterType` to user layer useEffect dependencies so it re-adds the user layer after the main effect clears it
  - Added `filterType` check to `filteredUsers` useMemo — returns empty array when dropdown is set to Links/TJ Boxes/Splitters, returns users when set to All or Customers
  - NOC/POP layer remains visible in all dropdown selections (unchanged)
  - Existing checkbox filters continue working on top of dropdown filter (unchanged)
  - `filterType` prop now passed to FiberMapView component for user layer dependency tracking

## 2026-08-31

### Fixed

- **Cable creation 500 error** — Duplicate cable code now returns 400 Bad Request instead of 500 Internal Server Error
  - Added `unique=True` to `Cable.code` column in model to match database schema
  - Added `IntegrityError` handling in `create_cable` and `update_cable` endpoints
  - Returns descriptive error message: "A cable with code 'XYZ' already exists"

### Added

- **NOC Approval Queue** — Centralized approval workflow for all Android/field submissions
  - New `approvals.py` router with 11 endpoints (submit, list, pending-count, detail, approve, reject, return, resubmit, upload-photo, serve-photo)
  - Extended `FiberApprovalRequest` model with `submitted_by_name`, `previous_data_json`, `priority`, `correction_note`, `photos_json`, `location_json`, `resubmitted_at`
  - New `ApprovalStatus` values: `returned_for_correction`, `resubmitted`
  - New `ApprovalPriority` enum: low, normal, high, urgent
  - New permission guards: `require_noc_approval`, `require_approval_submit`
  - Photo upload with GPS tagging (max 10MB)
  - Return-for-correction and resubmission workflow
  - Pending count badge on dashboard and sidebar

- **Frontend Approval Pages**
  - `NocApprovals.tsx` — Queue page with filter tabs (All, Pending, Approved, Rejected, Returned, Resubmitted)
  - `ApprovalDetail.tsx` — Detail page with comparison view, correction/resubmit modals
  - Dashboard pending count badge
  - Sidebar "Approvals" nav link with live badge (auto-refresh 15s)

- **Database Migration**
  - `002_extend_approvals.sql` — 9 ALTER TABLE statements on `fiber_approval_requests`

- **Comprehensive Documentation**
  - `docs/prd.md` — Product Requirements Document
  - `docs/architecture.md` — System Architecture with Mermaid diagrams
  - `docs/database.md` — Complete schema for 35+ tables
  - `docs/api.md` — ~120 API endpoints documented
  - `docs/android-api.md` — Android integration guide with workflows
  - `docs/security.md` — RBAC, JWT, permissions matrix
  - `docs/error-handling.md` — Error codes, recovery procedures
  - `docs/rules.md` — Code style, naming, conventions
  - `docs/design.md` — UI/UX design system
  - `docs/phases.md` — Development timeline (12 phases)
  - `docs/memory.md` — Lessons learned, tech debt
  - `docs/prompts.md` — AI development prompts
  - `docs/code-documentation.md` — Documentation standards

- **Documentation Governance**
  - `AGENTS.md` — Master development rules (documentation-first governance)
  - `docs/changelog.md` — This file
  - `docs/decisions/` — Architectural Decision Records directory

### Changed

- Extended `FiberApprovalRequest` model with new fields
- Added approval queue to sidebar navigation
- Added pending count to dashboard summary
- Registered `approvals` router in `main.py`

### Database

- `fiber_approval_requests` table: 9 new columns via `002_extend_approvals.sql`

### API

- New endpoints: `POST /api/approvals/submit`, `GET /api/approvals`, `GET /api/approvals/pending-count`, `GET /api/approvals/{id}`, `PUT /api/approvals/{id}/approve`, `PUT /api/approvals/{id}/reject`, `PUT /api/approvals/{id}/return`, `PUT /api/approvals/{id}/resubmit`, `POST /api/approvals/upload-photo`, `GET /api/approvals/photos/{filename}`
- New permission guards: `require_noc_approval`, `require_approval_submit`

### Security

- New roles in approval workflow: field_team can submit, noc/global_write/admin can review
- Photo upload restricted to authenticated users
- Approval queue: field_team sees only own submissions

### Android Impact

- Android app can now submit infrastructure changes via `POST /api/approvals/submit`
- Photo upload via `POST /api/approvals/upload-photo`
- Resubmission workflow for corrections

---

## 2026-09-03

### Changed

- **Photo Processing Pipeline — Standardized Stamping for Android Submissions**
  - Rewrote `photo_processing.py` with new stamp format matching specification
  - USER photos: `PPPoE Username:`, `Date & Time:`, `GPS:` with correct formatting
  - TJ photos: `TJ ID:`, `Date & Time:`, `GPS:` — no PPPoE username shown
  - Date/time format: `03 Sep 2026, 05:28 PM` (was `DD-Mon-YYYY HH:MM:SS`)
  - Stamp at bottom-left corner with 30px margin (was 10px)
  - Open Sans 12px font — labels bold, values regular weight
  - Semi-transparent dark background behind stamp text for readability
  - EXIF orientation correction before crop/resize
  - Progressive JPEG compression: starts at Q85, reduces by 5 until < 1 MB
  - Resolution fallback: if compression alone can't reach < 1 MB, scales down progressively
  - Unified stamp logic: `photos.py` now uses shared `photo_processing.process_photo()` instead of inline processing

### Added

- `pppoe_username` column on `field_photos` table for subscriber photo identification
- GPS coordinate validation on both `/api/photos` and `/api/approvals/upload-photo` endpoints
- Liberation Sans font installed in Docker backend as fallback for Open Sans
- `FieldPhotoItem.pppoe_username` field in frontend TypeScript types
- `uploadPhoto()` client helper accepts optional `pppoeUsername` parameter
- Photo viewer modal now shows capture date/time

### Database

- `field_photos` table: new `pppoe_username VARCHAR(128)` column (via `init_db()` ALTER)

### API

- `POST /api/photos/{entity_type}/{entity_id}` — new `pppoe_username` query parameter
- `GET /api/photos/{entity_type}/{entity_id}` — response includes `pppoe_username` field
- `POST /api/approvals/upload-photo` — GPS validation added (lat: -90..90, lng: -180..180)

---

## 2026-08-31

### Added

- **Field Photos System** — Complete TJ and subscriber photo documentation workflow
- `FieldPhoto` SQLAlchemy model for tracking field photos with GPS metadata
- Photo upload API: `POST /api/photos/{entity_type}/{entity_id}` — server-side crop, resize, watermark
- Photo list API: `GET /api/photos/{entity_type}/{entity_id}` — returns all 3 photo slots with status
- Photo file serving: `GET /api/photos/file/{path}` — authenticated file access
- Photo delete API: `DELETE /api/photos/{entity_type}/{entity_id}/{photo_type}`
- `PhotoGallery` React component — responsive 3-column grid with upload, replace, delete, download
- Photo viewer modal — full-screen in-app viewer with GPS info and download button
- TJ photo gallery as a "Photos" tab in `TjDetailPanel` on the Fiber Map
- Subscriber photo gallery section in `SubscriberProfile` page
- `uploadPhoto()` client helper for multipart form uploads
- Database migration: `003_field_photos.sql`

### Database

- New table: `field_photos` — 18 columns, indexed on `(entity_type, entity_id)` and unique on `(entity_type, entity_id, photo_type)`

### API

- `POST /api/photos/{entity_type}/{entity_id}` — Upload/replace field photo (multipart/form-data)
- `GET /api/photos/{entity_type}/{entity_id}` — List photos for entity (3 slots)
- `GET /api/photos/file/{path}` — Serve photo file (authenticated)
- `DELETE /api/photos/{entity_type}/{entity_id}/{photo_type}` — Delete a photo

### Security

- Photo upload restricted to `global_write`, `admin`, `noc` roles
- Photo serving requires JWT authentication
- Path traversal blocked on file serving
- Max file size: 10 MB
- Only image MIME types accepted

### Android Impact

- Android app can upload field photos via `POST /api/photos/{entity_type}/{entity_id}`
- Photo list endpoint provides completion status for 3 required slots per entity
- GPS coordinates and capture timestamp embedded in watermark and metadata

## Future Entries

Add new entries above this line in reverse chronological order.
