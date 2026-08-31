# Changelog

## Infra NEXUS — Project Change Log

---

## 2026-08-31

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

## Future Entries

Add new entries above this line in reverse chronological order.
