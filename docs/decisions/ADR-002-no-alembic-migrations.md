# ADR-002 — No Alembic Migrations

## Status

Accepted

## Context

SQLAlchemy ORM with PostgreSQL requires schema management. Options:
1. Alembic (official SQLAlchemy migration tool)
2. `Base.metadata.create_all()` + manual SQL migrations

Alembic provides:
- Automatic schema diffing
- Version-controlled migrations
- Rollback support
- Team collaboration on schema changes

However, Alembic adds complexity:
- Migration conflict resolution
- Learning curve for team
- Auto-generated migrations may be incorrect
- Requires careful review of generated SQL

## Decision

Use `Base.metadata.create_all()` for initial schema creation + manual SQL migrations for changes.

Schema changes are documented in:
- `backend/migrations/` directory (SQL files)
- `docs/database.md` (current schema state)
- `docs/changelog.md` (change history)

## Alternatives Considered

1. **Alembic** — Official SQLAlchemy migration tool
   - Rejected: Adds complexity, migration conflicts, learning curve

2. **Raw SQL only** — No ORM, pure SQL
   - Rejected: Loses type safety, IDE support, async capabilities

3. **Django-style migrations** — Auto-generated from model changes
   - Rejected: Not available in SQLAlchemy ecosystem

## Consequences

### Benefits
- Simpler mental model (no migration versioning)
- Full control over SQL execution
- No migration conflict resolution needed
- Easy to understand current schema state

### Tradeoffs
- No automatic rollback (must write rollback SQL manually)
- No schema diffing tool (must compare models to DB manually)
- Risk of schema drift if migrations not applied consistently
- Requires discipline to document all schema changes

## Date

2026-01-01
