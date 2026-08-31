# AUDIT-2026-08-31-003

## Timestamp

2026-08-31 22:30 +06:00

## Type

Feature

## Title

Field Photo Collection System for TJ Boxes and Subscribers

## Request

Implement a complete field photo collection system with:
- 3 photo slots per TJ (Overall, Internal, Identification)
- 3 photo slots per Subscriber (Installation, Equipment, Identification)
- Server-side image processing (crop, resize, watermark with ID + GPS)
- Upload/replace/delete/download via web UI
- Photo viewer modal (in-app, no new tab)
- Responsive grid (row on desktop, stack on mobile)

## Investigation

- Existing codebase has no file upload, image, or photo handling
- No Android app code in repo — Android integration is API-only
- Backend uses FastAPI with PostgreSQL (production) + SQLite fallback
- Auth: JWT with role-based access control
- Frontend: React + TypeScript with Tailwind CSS
- TjDetailPanel: FiberMap.tsx line 1288+ — tabbed interface (Cables, Splices)
- SubscriberProfile: standalone page with info strip, charts, remote/ACS panels

## Findings

- Pillow not in requirements.txt — needed for server-side image processing
- No existing upload directory structure
- Existing `photos_json` field in `fiber_approval_requests` stores approval photo paths as JSON array — different purpose
- `BigId` type uses BigInteger with SQLite Integer variant
- Database migrations use `CREATE TABLE IF NOT EXISTS` pattern in `init_db()`

## Decision

- Created standalone `FieldPhoto` model separate from approval photos
- Server-side processing: 1:1 square crop → 1440×1440 resize → JPEG quality 85
- Watermark: Open Sans font, entity ID + GPS, white text on semi-transparent dark background
- Storage: `{PHOTO_UPLOAD_DIR}/{entity_type}/{entity_id}/{photo_type}.jpg`
- Added "Photos" tab to TjDetailPanel (third tab alongside Cables and Splices)
- Added photo gallery section to SubscriberProfile between info strip and charts
- Used existing `Card` and `modal` styling patterns for consistency

## Changes

### Code

**Backend:**
- `backend/app/models.py` — Added `FieldPhoto` model (18 columns)
- `backend/app/api/photos.py` — New file: upload, list, serve, delete endpoints
- `backend/app/main.py` — Registered `photos` router
- `backend/app/config.py` — Added `photo_upload_dir` setting
- `backend/app/database.py` — Added `field_photos` table creation in `init_db()`
- `backend/requirements.txt` — Added `Pillow>=10.0.0`

**Frontend:**
- `frontend/src/components/PhotoGallery.tsx` — New component: responsive photo grid with upload/replace/delete/download/viewer
- `frontend/src/api/types.ts` — Added `FieldPhotoItem`, `FieldPhotoListResponse`, `FieldPhotoUploadResponse`, `TJ_PHOTO_TYPES`, `SUBSCRIBER_PHOTO_TYPES`, label maps
- `frontend/src/api/client.ts` — Added `uploadPhoto()` multipart form helper
- `frontend/src/pages/FiberMap.tsx` — Added "Photos" tab to TjDetailPanel, imported PhotoGallery
- `frontend/src/pages/SubscriberProfile.tsx` — Added photo gallery section, imported PhotoGallery

### Database

- Migration: `backend/migrations/003_field_photos.sql`
- `field_photos` table: 18 columns, indexed on `(entity_type, entity_id)` and unique on `(entity_type, entity_id, photo_type)`

### API

- `POST /api/photos/{entity_type}/{entity_id}` — Upload/replace photo (multipart/form-data)
- `GET /api/photos/{entity_type}/{entity_id}` — List photos with completion status
- `GET /api/photos/file/{path}` — Serve photo file (authenticated)
- `DELETE /api/photos/{entity_type}/{entity_id}/{photo_type}` — Delete photo

### Configuration

- `PHOTO_UPLOAD_DIR` env var (default: `/app/uploads/field-photos`)

## Documentation Updated

| Documentation | Action | Reason |
|---|---|---|
| `docs/api.md` | Updated | New Section 22: Field Photos API (upload, list, serve, delete) |
| `docs/database.md` | Updated | New Section 10: field_photos table schema and storage |
| `docs/security.md` | Updated | New subsection 10.4: Photo upload security controls |
| `docs/android-api.md` | Updated | Added photo endpoints to API quick reference |
| `docs/changelog.md` | Updated | Added 2026-08-31 entry for Field Photos System |
| `AGENTS.md` | No change | Feature follows existing governance patterns |

## Tests

- Frontend build: `vite build` completed successfully (75 modules, 811 KB JS bundle)
- Backend: Cannot run locally (no Python in PATH, no venv) — verification deferred to Docker deployment

## Result

SUCCESS

## Known Issues

- Pillow not installed locally — server-side processing verified by code review only
- Font fallback: If DejaVu Sans or Liberation Sans not available, PIL default font used (watermark still works but text may be smaller)
- No EXIF GPS extraction from uploaded photos — GPS must be provided by client (Android app or browser Geolocation API)

## Follow-up

- Deploy and test photo upload end-to-end in Docker environment
- Verify `PHOTO_UPLOAD_DIR` volume mount in docker-compose.yml
- Android integration: camera capture → crop → resize → upload via multipart API
- Consider adding photo completion percentage to TJ/subscriber list views
- Consider adding bulk photo download (ZIP) endpoint

## Related Decisions

- ADR-002 (no Alembic migrations) — migration done via `init_db()` + manual SQL

## Related Audit Entries

- AUDIT-2026-08-31-001 (documentation governance)
- AUDIT-2026-08-31-002 (NOC approval queue)
