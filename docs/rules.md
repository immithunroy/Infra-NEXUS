# Project Rules & Conventions

## Infra NEXUS — Development Rules

**Version:** 1.0  
**Last Updated:** 2026-08-31

---

## 1. Code Style

### 1.1 Python (Backend)

- **Formatter:** Black (implicit)
- **Line Length:** 88 characters (Black default)
- **Quotes:** Double quotes for strings
- **Type Hints:** Required on all function signatures
- **Docstrings:** Not required (minimal comments)

```python
# Good
async def get_onu(
    onu_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Onu:
    result = await db.execute(select(Onu).where(Onu.id == onu_id))
    return result.scalar_one()

# Bad
async def get_onu(onu_id, db, user):
    result = await db.execute(select(Onu).where(Onu.id == onu_id))
    return result.scalar_one()
```

### 1.2 TypeScript (Frontend)

- **Formatter:** Prettier (implicit)
- **Semicolons:** Used
- **Quotes:** Double quotes
- **Indentation:** 2 spaces
- **Trailing Commas:** Yes

```typescript
// Good
interface Onu {
  id: number;
  name: string;
  state: "active" | "inactive" | "offline" | "unknown";
}

// Bad
interface Onu { id: number; name: string; }
```

### 1.3 SQL

- **Keywords:** UPPERCASE (`SELECT`, `FROM`, `WHERE`)
- **Identifiers:** lowercase_with_underscores
- **String Literals:** Single quotes

```sql
-- Good
SELECT id, name FROM olt_devices WHERE enabled = true;

-- Bad
select id, name from olt_devices where enabled = true;
```

---

## 2. Naming Conventions

### 2.1 Database Tables

- Plural nouns: `onus`, `cables`, `tj_boxes`
- Snake case: `switch_devices`, `mac_entries`
- No prefixes: `users` not `tbl_users`

### 2.2 Database Columns

- Snake case: `olt_id`, `pon_port`, `gps_lat`
- Foreign keys: `{table}_id` (e.g., `olt_id`, `user_id`)
- Booleans: `enabled`, `bound`, `online`
- Timestamps: `created_at`, `updated_at`, `last_scan_at`

### 2.3 Python Files

- Snake case: `collector.py`, `fiber_approvals.py`
- Router files: Plural nouns matching table (mostly)

### 2.4 Python Classes

- PascalCase: `OLTDevice`, `OnuDownEvent`
- Enums: PascalCase class, snake_case values

```python
class UserRole(str, enum.Enum):
    admin = "admin"
    global_read = "global_read"
```

### 2.5 Frontend Files

- Pages: PascalCase (`Dashboard.tsx`, `NocApprovals.tsx`)
- Components: PascalCase (`Layout.tsx`)
- API: camelCase (`api.ts`, `types.ts`)

### 2.6 Frontend Variables

- Interfaces: PascalCase (`OLTDevice`, `SubscriberProfile`)
- Functions: camelCase (`canWrite`, `canApprove`)
- Constants: UPPER_SNAKE_CASE (`ROLE_LABELS`, `TICKET_STATUSES`)

---

## 3. API Design Rules

### 3.1 Endpoint Naming

- Plural nouns: `/api/onus`, `/api/cables`
- Nested resources: `/api/devices/olts/{id}/scan`
- Action verbs for operations: `/api/devices/olts/{id}/test`

### 3.2 HTTP Methods

| Method | Purpose | Response |
|--------|---------|----------|
| `GET` | Read resources | 200 + data |
| `POST` | Create resources / actions | 201 + data |
| `PUT` | Update resources | 200 + data |
| `DELETE` | Remove resources | 204 No Content |

### 3.3 Query Parameters

- Filters: `?olt_id=1&state=active`
- Pagination: `?limit=50&offset=100`
- Search: `?q=search_term`
- Boolean: `?bound=true` (not `?bound=1`)

### 3.4 Request/Response Format

- All JSON: `Content-Type: application/json`
- File uploads: `multipart/form-data`
- No XML (except TR-069 CWMP endpoint)

---

## 4. Database Rules

### 4.1 Primary Keys

- Auto-incrementing integers
- `BigInteger` for high-volume tables (telemetry, events)
- `BigId = BigInteger().with_variant(Integer, "sqlite")` for SQLite compatibility

### 4.2 Foreign Keys

- Always specify `ondelete`:
  - `CASCADE` — Delete children with parent
  - `SET NULL` — Set foreign key to NULL
  - `RESTRICT` — Prevent delete if children exist

### 4.3 Timestamps

- Always `DateTime(timezone=True)`
- Use `server_default=func.now()` for creation
- Use `onupdate=func.now()` for updates

### 4.4 String Fields

- Use `VARCHAR(n)` for bounded strings
- Use `TEXT` for unbounded strings
- Set `DEFAULT ''` for optional strings

### 4.5 Unique Constraints

- Name constraints: `name="uq_olt_mac"`
- Composite keys for natural uniqueness: `UNIQUE(olt_id, pon_port, onu_id)`

---

## 5. Git Rules

### 5.1 Commit Messages

- Imperative mood: "Add ONU scan feature"
- First line < 72 characters
- No trailing period

### 5.2 Branch Strategy

- `main` — Production-ready code
- Feature branches: `feature/xxx`
- Bugfix branches: `fix/xxx`

### 5.3 Deployment

- Push to `main` triggers CI/CD
- No direct SSH deployment (user directive)
- CI/CD handles: `git pull → docker compose build → up -d`

---

## 6. Data Rules

### 6.1 Auto-Uppercasing

These fields are forced to uppercase:
- `code` (cable)
- `link_name` (cable)
- `manufacturer` (cable)
- `name` (TJ box, splitter)

### 6.2 TJ Box Validation

- `home_tj`: `tj_port=2`
- `regular_tj`: `tj_port` ∈ {4, 8, 10, 12}
- `capacity = tray_count × splice_per_tray`

### 6.3 Splice Validation

- A core can only splice with one other core
- Application-level validation (not DB constraint)
- Checked on create and update

### 6.4 ONU PON Port Format

- Includes `:onu_id` suffix: `EPON0/5:16`
- Must strip suffix before CLI commands
- Stored as-is in database

### 6.5 GPS Requirements

- Latitude: -90 to 90
- Longitude: -180 to 180
- Accuracy: Must be < 9 meters (for subscriber GPS)

### 6.6 ONU Name Sync

- `_upsert_onu` in `collector.py` updates `onu.name` when OLT description changes
- Auto-synced during every OLT scan

---

## 7. Security Rules

### 7.1 Authentication

- All endpoints require JWT token (except `/api/auth/login`, `/api/health`)
- Token expires after 24 hours
- No refresh tokens (re-login required)

### 7.2 Passwords

- Stored as bcrypt hashes only
- Never returned in API responses
- Never logged

### 7.3 Device Credentials

- Stored as plaintext in database (known limitation)
- Only accessible via backend container
- Not exposed in API responses (masked with `***`)

### 7.4 File Uploads

- Max size: 10MB
- Server-generated filenames
- Stored in `/app/uploads/approval-photos/`
- No executable files allowed

---

## 8. Performance Rules

### 8.1 Database Queries

- Use `select()` with specific columns when possible
- Add `.limit()` on unbounded queries
- Use `index=True` on frequently queried columns
- Avoid N+1 queries (use `selectinload` for relationships)

### 8.2 Connection Pooling

- `pool_size=10` — Base connections
- `max_overflow=20` — Burst connections
- `pool_pre_ping=True` — Verify connections before use

### 8.3 Caching

- `get_settings()` uses `@lru_cache`
- MAC vendor lookups cached in `mac_vendors` table
- Port descriptions cached in `olt_devices.port_descriptions` (JSON)

### 8.4 Telemetry Retention

- 90 days for `onu_telemetry`
- 365 days for `bgp_prefix_snapshots`
- Auto-pruned during collection/scan jobs

---

## 9. Testing Rules

### 9.1 API Testing

- Test auth: `POST /api/auth/login` with `{"username":"admin","password":"admin123"}`
- Use token in `Authorization: Bearer <token>` header
- Test endpoints: Use curl or Postman

### 9.2 Database Testing

- Use production database for testing
- Backup before destructive tests
- Verify with `SELECT COUNT(*)` after operations

### 9.3 Frontend Testing

- TypeScript compilation: `npm run build` (zero errors required)
- No automated tests currently
- Manual testing via browser

---

## 10. Deployment Rules

### 10.1 CI/CD Pipeline

- Trigger: Push to `main` branch
- Steps: SSH → git pull → docker compose build → up -d → prune images
- No manual intervention required
- **If CI/CD fails:** Clear build cache on server, notify user. Do NOT do manual deployment (scp/cp files into container).

### 10.2 Container Rebuild

- Python code changes require `docker compose up -d --build backend`
- Frontend changes auto-deploy via CI/CD
- Database migrations: Manual SQL via `psql`

### 10.3 Environment Variables

- All config via environment variables
- `.env` file for local development
- Docker Compose `environment:` for production
- Secrets: `JWT_SECRET`, `SERVER_HOST`, `SSH_PRIVATE_KEY`

### 10.4 Health Checks

- `GET /api/health` — Returns `{"status": "ok"}`
- `GET /api/scheduler/status` — Job execution status
- Docker Compose: `docker compose ps` — Container status

---

## 11. Known Limitations

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| No Alembic migrations | Schema changes require manual SQL | Document all migrations |
| Device passwords in plaintext | Security risk | Docker network isolation |
| No rate limiting | Brute force risk | Nginx config |
| No refresh tokens | Re-login after 24h | Acceptable for ISP use case |
| `noc_pop.py` has no auth | Security risk | Add auth guards |
| No automated tests | Regression risk | Manual testing |
| Single-file frontend pages | Maintainability | Component extraction |
| BDCOM session limit (~36 cmds) | Only per-ONU connections reliable | Document limitation |
