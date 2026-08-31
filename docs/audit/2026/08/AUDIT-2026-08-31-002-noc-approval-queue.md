# AUDIT-2026-08-31-002

## Timestamp

2026-08-31 15:00 +06:00

## Type

Feature

## Title

Centralized NOC approval queue for Android/field submissions

## Request

User requested a centralized approval queue system for all Android/field team submissions. Field team should submit infrastructure changes, photos with GPS tagging, and NOC should review/approve/reject/return for correction.

## Investigation

Inspected:
- Existing `fiber_approvals.py` (legacy approval system)
- `FiberApprovalRequest` model
- Security/RBAC system
- Frontend routing and navigation
- Android app integration points

## Findings

- Existing `fiber_approvals.py` only supported fiber infrastructure entity types
- No photo upload capability
- No correction/resubmission workflow
- No GPS tagging on submissions
- No pending count for dashboard
- Field team could only see own submissions (good)

## Decision

Create centralized `approvals.py` router that handles ALL Android/field submissions:
- 11 entity types supported
- Photo upload with GPS tagging
- Return-for-correction workflow
- Resubmission workflow
- Pending count endpoint for dashboard badge
- Comparison view (previous data vs new data)
- Keep `fiber_approvals.py` for backward compatibility

## Changes

### Code

- `backend/app/api/approvals.py` — NEW: 11 endpoints
- `backend/app/api/fiber_approvals.py` — Extended with return/resubmit
- `backend/app/models.py` — Extended FiberApprovalRequest, ApprovalStatus, ApprovalPriority
- `backend/app/schemas.py` — New approval schemas
- `backend/app/security.py` — New permission guards
- `backend/app/main.py` — Registered approvals router
- `backend/migrations/002_extend_approvals.sql` — DB migration
- `frontend/src/pages/NocApprovals.tsx` — NEW: Queue page
- `frontend/src/pages/ApprovalDetail.tsx` — NEW: Detail page
- `frontend/src/pages/Dashboard.tsx` — Pending approvals badge
- `frontend/src/components/Layout.tsx` — Approvals nav link
- `frontend/src/App.tsx` — Routes
- `frontend/src/api/types.ts` — TypeScript types

### Database

- Migration: `002_extend_approvals.sql`
- Added columns to `fiber_approval_requests`:
  - `submitted_by_name` VARCHAR(128)
  - `previous_data_json` TEXT
  - `priority` VARCHAR(16)
  - `correction_note` TEXT
  - `photos_json` TEXT
  - `location_json` TEXT
  - `resubmitted_at` TIMESTAMPTZ

### API

- Added: `POST /api/approvals/submit`
- Added: `GET /api/approvals`
- Added: `GET /api/approvals/pending-count`
- Added: `GET /api/approvals/{id}`
- Added: `PUT /api/approvals/{id}/approve`
- Added: `PUT /api/approvals/{id}/reject`
- Added: `PUT /api/approvals/{id}/return`
- Added: `PUT /api/approvals/{id}/resubmit`
- Added: `POST /api/approvals/upload-photo`
- Added: `GET /api/approvals/photos/{filename}`

### Security

- New permission guard: `require_noc_approval` (admin, global_write, noc)
- New permission guard: `require_approval_submit` (admin, global_write, field_team)
- Field team sees only own submissions

## Documentation Updated

| Documentation | Action | Reason |
|---|---|---|
| prd.md | Updated | New feature documented |
| api.md | Updated | 10 new endpoints documented |
| android-api.md | Updated | Android integration guide |
| database.md | Updated | New columns documented |
| security.md | Updated | New permission guards |
| architecture.md | Updated | Approval workflow diagram |
| design.md | Updated | Queue page layout |
| phases.md | Updated | Phase 10 marked complete |
| memory.md | Updated | Lessons learned |
| code-documentation.md | Updated | Approval code patterns |
| changelog.md | Updated | Feature added |

## Tests

- Backend Python syntax checks passed
- TypeScript compilation clean (zero errors)
- Production test: submit → pending-count → approve/reject all verified
- DB migration applied on production
- Backend container rebuilt and verified

## Result

SUCCESS

## Known Issues

- None

## Follow-up

- None

## Related Decisions

- ADR-004-noc-approval-queue

## Related Audit Entries

- None
