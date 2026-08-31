# Changelog

## Infra NEXUS — Project Change Log

---

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
