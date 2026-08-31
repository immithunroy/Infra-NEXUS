# AUDIT-2026-08-31-004

## Timestamp

2026-08-31 22:00 +06:00

## Type

Bug Fix

## Title

Cable creation 500 error — duplicate code constraint violation

## Request

Investigate and fix the Fiber Cable creation functionality that fails with HTTP 500 when creating a cable from the web console.

## Investigation

1. Checked git history — last commit `947a425` (field-photos) didn't modify fiber.py or schemas.py
2. Examined backend logs on production server
3. Found error: `asyncpg.exceptions.UniqueViolationError: duplicate key value violates unique constraint "cables_code_key"`
4. Checked database schema: `cables` table has UNIQUE constraint on `code` column
5. Checked SQLAlchemy model: `code` column missing `unique=True`
6. Schema drift between model and database — model didn't reflect existing DB constraint

## Findings

- Database had `cables_code_key` UNIQUE CONSTRAINT on `code` column (created during initial setup)
- SQLAlchemy model in `models.py` had `code: String(64), default=""` without `unique=True`
- `create_cable` endpoint had no `IntegrityError` handling
- When user submitted duplicate code, PostgreSQL rejected it, SQLAlchemy raised `IntegrityError`, FastAPI returned 500

## Decision

Two-part fix:
1. Add `unique=True` to `code` column in `Cable` model to match database schema
2. Add `IntegrityError` handling in `create_cable` and `update_cable` endpoints to return proper 400 error with descriptive message

## Changes

### Code

- `backend/app/models.py` — Added `unique=True` to `Cable.code` column
- `backend/app/api/fiber.py` — Added `IntegrityError` import and try/except in `create_cable` and `update_cable`

### Database

- No schema changes (database already had the constraint)

### API

- `POST /api/fiber/cables` — Now returns 400 with message instead of 500 on duplicate code
- `PUT /api/fiber/cables/{id}` — Now returns 400 with message instead of 500 on duplicate code

## Documentation Updated

| Documentation | Action | Reason |
|---|---|---|
| database.md | Updated | Added UNIQUE constraint to `code` column docs |
| error-handling.md | Updated | Added 400 Bad Request error documentation |
| changelog.md | Pending | Will update |
| audit/index.md | Pending | Will update |

## Tests

- Duplicate code: Returns 400 Bad Request ✓
- Normal cable creation: Returns 200 with cable data ✓
- Cable with TJ endpoints: Auto-generates route segments ✓
- Cable update: Works correctly ✓

## Result

SUCCESS

## Known Issues

- None

## Follow-up

- None

## Related Decisions

- None

## Related Audit Entries

- None
