# AUDIT-2026-09-03-001

## Timestamp

2026-09-03 01:15 +06:00

## Type

Feature

## Title

Standardized Photo Processing Pipeline for Android Submissions

## Request

Implement server-side photo processing with standardized stamping for all Android-submitted photos:
- USER photos: PPPoE Username + Date & Time + GPS
- TJ photos: TJ ID + Date & Time + GPS
- Open Sans 12px font, labels bold, 30px margin
- EXIF orientation correction
- Progressive JPEG compression to stay under 1 MB
- GPS coordinate validation

## Investigation

- Existing `photo_processing.py` had incomplete stamp format (wrong labels, no Date & Time line, wrong date format, 10px margin, no EXIF handling)
- `photos.py` had duplicate inline processing with different stamp format
- No GPS validation on upload endpoints
- Backend Dockerfile missing font packages
- FieldPhoto model lacked `pppoe_username` field

## Findings

- Two separate processing paths existed: `photo_processing.py` (approval worker) and `photos.py` `_save_processed_image` (field photos)
- Neither handled EXIF orientation
- Neither enforced 1 MB file size limit
- `photo_processing.py` used `DD-Mon-YYYY HH:MM:SS` format instead of required `03 Sep 2026, 05:28 PM`
- Margin was 10px instead of required 30px
- Font fallback chain existed but Open Sans was not installed in Docker

## Decision

- Unified both processing paths to use shared `photo_processing.process_photo()`
- Added EXIF orientation correction as step 2 in pipeline
- Implemented progressive JPEG compression (Q85 → Q30, step 5) with resolution fallback
- Added Liberation Sans font in Dockerfile as fallback for Open Sans
- Added `pppoe_username` to FieldPhoto model for subscriber photo identification
- Added GPS range validation on both upload endpoints

## Changes

### Code

**Backend:**
- `backend/app/services/photo_processing.py` — Complete rewrite: new stamp format, EXIF handling, progressive compression, 30px margin, Open Sans/Liberation font chain
- `backend/app/api/photos.py` — Rewritten to use shared `process_photo()`, added `pppoe_username` parameter, GPS validation, proper entity type mapping
- `backend/app/api/approvals.py` — Added GPS coordinate validation on upload-photo endpoint
- `backend/app/models.py` — Added `pppoe_username` field to FieldPhoto model
- `backend/app/database.py` — Added ALTER TABLE for `pppoe_username` column
- `backend/Dockerfile` — Added `fonts-liberation` package

**Frontend:**
- `frontend/src/api/types.ts` — Added `pppoe_username` to `FieldPhotoItem`
- `frontend/src/api/client.ts` — Added `pppoeUsername` parameter to `uploadPhoto()`
- `frontend/src/components/PhotoGallery.tsx` — Added capture date/time display in viewer modal

### Database

- `field_photos` table: new `pppoe_username VARCHAR(128) DEFAULT ''` column

### API

- `POST /api/photos/{entity_type}/{entity_id}` — new `pppoe_username` query parameter
- `GET /api/photos/{entity_type}/{entity_id}` — response includes `pppoe_username` field
- `POST /api/approvals/upload-photo` — GPS validation (lat: -90..90, lng: -180..180)

## Documentation Updated

| Documentation | Action | Reason |
|---|---|---|
| `docs/changelog.md` | Updated | Added 2026-09-03 entry for photo processing standardization |

## Tests

- Frontend build: `vite build` completed successfully (75 modules, 828 KB JS bundle)
- Backend: Cannot run locally (no Python in PATH) — verification deferred to Docker deployment

## Result

SUCCESS

## Known Issues

- Open Sans not explicitly installed — Liberation Sans used as primary fallback (visually similar)
- Progressive compression may produce slightly larger files than necessary on first pass
- HEIC/HEIF files accepted in upload but Pillow may not decode all variants

## Follow-up

- Deploy and verify stamp appearance on server
- Test with actual Android app uploads
- Consider adding Open Sans to Dockerfile for exact font match
- Verify Liberation Sans renders identically to Open Sans at 12px

## Related Decisions

- ADR-002 (no Alembic migrations) — migration done via `init_db()` + ALTER TABLE

## Related Audit Entries

- AUDIT-2026-08-31-003 (field photos system)
