# Code Documentation Guide

## Infra NEXUS — Code Comments & Documentation Standards

**Version:** 1.0  
**Last Updated:** 2026-08-31

---

## 1. Documentation Philosophy

### 1.1 Principles

1. **Code is self-documenting** — Use clear variable/function names
2. **Comments explain WHY, not WHAT** — Don't comment obvious code
3. **Docstrings for public APIs** — All router endpoints need docstrings
4. **Inline comments for complex logic** — Business rules, algorithms
5. **No unnecessary comments** — Don't clutter code

### 1.2 When to Comment

| Situation | Comment Type |
|-----------|-------------|
| Complex algorithm | Inline comment explaining logic |
| Business rule | Inline comment citing requirement |
| Workaround/hack | Inline comment explaining why |
| Public API endpoint | Docstring with description |
| Non-obvious parameter | Inline comment explaining valid values |
| Database constraint | Comment explaining constraint rationale |

---

## 2. Backend Documentation Standards

### 2.1 Module Docstrings

```python
"""
OLT Commander Backend

FastAPI application for managing ISP infrastructure:
- BDCOM GPON/EPON OLT devices
- Mikrotik RouterOS devices
- ONU inventory and telemetry
- Fiber infrastructure (cables, TJ boxes, splitters)
- Subscriber management and MAC binding
- TR-069 ACS integration
"""
```

### 2.2 Function Docstrings

```python
async def scan_olt(session: AsyncSession, olt_id: int) -> ScanLog:
    """Scan an OLT for ONUs and MAC addresses.

    Connects to the OLT via telnet/SSH, retrieves the ONU inventory
    and MAC address table, then upserts into the database. Also
    collects port descriptions (best-effort).

    Args:
        session: Async database session
        olt_id: ID of the OLT to scan

    Returns:
        ScanLog with scan results and status

    Raises:
        Exception: If OLT connection fails
    """
```

### 2.3 Inline Comments

```python
# GOOD: Explains WHY
# BDCOM OLT drops session after ~36 commands, so we create
# a new telnet session for each ONU operation.
driver = await build_driver(device)

# BAD: Explains WHAT (unnecessary)
# Get the OLT device from the database
result = await session.execute(select(OLTDevice).where(OLTDevice.id == olt_id))
```

### 2.4 Business Rule Comments

```python
# Capacity = tray_count × splice_per_tray (auto-calculated, not stored)
capacity = tray_count * splice_per_tray

# A core can only splice with one other core (enforced at application level)
existing = await session.execute(
    select(Splice).where(
        Splice.tj_id == tj_id,
        Splice.cable_a_id == cable_a_id,
        Splice.core_a == core_a,
    )
)
if existing.scalar_one_or_none():
    raise HTTPException(400, "Core already spliced")
```

---

## 3. Frontend Documentation Standards

### 3.1 Component Documentation

```tsx
/**
 * Dashboard page component.
 *
 * Displays:
 * - Device summary cards (OLT, Mikrotik, ONU counts)
 * - Signal quality histogram
 * - Weakest ONUs list
 * - Mass-down areas
 * - Scheduled job status (auto-refreshes every 15s)
 *
 * @returns Dashboard JSX element
 */
export default function Dashboard() {
  // ...
}
```

### 3.2 TypeScript Interface Documentation

```typescript
/**
 * OLT device representation.
 *
 * Contains connection details, status, and configuration
 * for a BDCOM GPON/EPON OLT.
 */
interface OLTDevice {
  /** Device ID (auto-increment) */
  id: number;

  /** Human-readable device name */
  name: string;

  /** Management IP address */
  ip: string;

  /** Vendor identifier (e.g., "bdcom") */
  vendor: string;

  /** PON type: "gpon" or "epon" */
  pon_type: string;

  /** Access method: "telnet", "ssh", or "both" */
  access_method: string;
}
```

### 3.3 Function Documentation

```typescript
/**
 * Check if user has write permissions.
 *
 * Write permission is required for:
 * - Device CRUD (OLT, Mikrotik, Switch)
 * - ONU management
 * - Fiber infrastructure changes
 * - Ticket updates
 *
 * @param role - User role string
 * @returns true if user can write
 */
export function canWrite(role?: string): boolean {
  return role === "admin" || role === "global_write";
}
```

### 3.4 Inline Comments

```tsx
// GOOD: Explains complex logic
// ONU pon_port includes :onu_id suffix (e.g., "EPON0/5:16")
// Must strip before sending CLI commands to OLT
const portBase = onu.pon_port.split(":")[0];

// BAD: Explains obvious code
// Get the first element of the array
const first = items[0];
```

---

## 4. SQL Documentation

### 4.1 Table Comments

```sql
-- A fiber splice connection between two cable cores at a TJ box.
-- Core-to-one validation: a core can only splice with one other core.
CREATE TABLE splices (
    id INTEGER PRIMARY KEY,
    tj_id INTEGER REFERENCES tj_boxes(id) ON DELETE CASCADE,
    cable_a_id INTEGER REFERENCES cables(id) ON DELETE CASCADE,
    core_a INTEGER NOT NULL,
    cable_b_id INTEGER REFERENCES cables(id) ON DELETE CASCADE,
    core_b INTEGER NOT NULL,
    status VARCHAR(16) DEFAULT 'active',  -- active | spare | broken
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### 4.2 Column Comments

```sql
-- pon_port includes :onu_id suffix (e.g., EPON0/5:16)
-- Strip suffix before CLI commands, use full string for database
pon_port VARCHAR(32) DEFAULT '',

-- GPS accuracy in meters; must be < 9 for subscriber locations
gps_accuracy FLOAT,
```

---

## 5. README Structure

### 5.1 Backend README

```markdown
# OLT Commander Backend

## Setup
1. Install Python 3.12+
2. pip install -r requirements.txt
3. Set environment variables (see .env.example)
4. Run: uvicorn app.main:app --reload

## API Documentation
- Swagger UI: http://localhost:8080/docs
- ReDoc: http://localhost:8080/redoc

## Environment Variables
- DATABASE_URL: PostgreSQL connection string
- JWT_SECRET: Secret key for JWT tokens
- ADMIN_USERNAME: Default admin username
- ADMIN_PASSWORD: Default admin password
```

### 5.2 Frontend README

```markdown
# OLT Commander Frontend

## Setup
1. Install Node.js 18+
2. npm install
3. npm run dev

## Build
- Development: npm run dev
- Production: npm run build
- Preview: npm run preview

## Tech Stack
- React 18
- TypeScript 5.6
- Vite 5.4
- Tailwind CSS 3.4
- React Router 6
- Leaflet (maps)
```

---

## 6. Comment Inventory

### 6.1 Key Files Requiring Comments

| File | Priority | Focus Areas |
|------|----------|-------------|
| `models.py` | High | Table relationships, business rules |
| `collector.py` | High | OLT scan logic, SNMP polling |
| `scheduler.py` | Medium | Job scheduling, retry logic |
| `security.py` | High | Permission model, JWT validation |
| `approvals.py` | Medium | Approval workflow |
| `fiber.py` | Medium | Splice validation, auto-generation |
| `bdcom.py` | High | OLT CLI commands, session limits |
| `mikrotik.py` | Medium | API commands, v6/v7 differences |

### 6.2 Comment Density Guidelines

- **Router files:** 1 comment per 10 lines
- **Service files:** 1 comment per 15 lines
- **Model files:** 1 comment per 20 lines
- **Driver files:** 1 comment per 10 lines
- **Frontend pages:** 1 comment per 20 lines

---

## 7. Documentation Files

### 7.1 Existing Documentation

| File | Purpose | Size |
|------|---------|------|
| `prd.md` | Product Requirements Document | ~300 lines |
| `architecture.md` | System Architecture | ~400 lines |
| `database.md` | Database Schema Reference | ~500 lines |
| `api.md` | Complete API Reference | ~800 lines |
| `android-api.md` | Android Integration Guide | ~300 lines |
| `security.md` | Security Documentation | ~300 lines |
| `error-handling.md` | Error Handling Reference | ~300 lines |
| `rules.md` | Project Rules & Conventions | ~300 lines |
| `design.md` | UI/UX Design System | ~300 lines |
| `phases.md` | Development Timeline | ~200 lines |
| `memory.md` | Lessons Learned | ~250 lines |
| `prompts.md` | AI Development Prompts | ~300 lines |
| `code-documentation.md` | This file | ~200 lines |

### 7.2 Documentation Maintenance

- Update docs when adding new features
- Review docs quarterly for accuracy
- Keep examples current with codebase
- Remove outdated information promptly

---

## 8. API Documentation

### 8.1 OpenAPI/Swagger

FastAPI auto-generates OpenAPI documentation:
- Swagger UI: `http://localhost:8080/docs`
- ReDoc: `http://localhost:8080/redoc`
- Raw OpenAPI: `http://localhost:8080/openapi.json`

### 8.2 Endpoint Documentation

Every endpoint should have:
1. Brief description (in router decorator)
2. Response model (type hint)
3. Permission guard (dependency injection)
4. Example request/response (in docs)

```python
@router.get("/olts", response_model=list[OLTDeviceOut])
async def list_olts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all OLT devices with ONU counts and ports."""
    # ...
```

---

## 9. Type Documentation

### 9.1 Python Type Hints

```python
# GOOD: Full type hints
async def get_onu(
    onu_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Onu:
    pass

# BAD: Missing type hints
async def get_onu(onu_id, db, user):
    pass
```

### 9.2 TypeScript Types

```typescript
// GOOD: Explicit types
const handleApprove = async (id: number, note: string): Promise<void> => {
  await api.put(`/approvals/${id}/approve`, { review_note: note });
};

// BAD: Implicit types
const handleApprove = async (id, note) => {
  await api.put(`/approvals/${id}/approve`, { review_note: note });
};
```

---

## 10. Documentation Best Practices

### 10.1 Do

- ✅ Comment complex business logic
- ✅ Explain workarounds and hacks
- ✅ Document non-obvious parameters
- ✅ Keep documentation current
- ✅ Use consistent formatting
- ✅ Provide examples for APIs

### 10.2 Don't

- ❌ Comment obvious code
- ❌ Duplicate code in comments
- ❌ Leave outdated comments
- ❌ Use comments as TODO (use issue tracker)
- ❌ Comment out code (use git history)
- ❌ Over-comment simple functions

### 10.3 Code Review Checklist

- [ ] All public functions have docstrings
- [ ] Complex logic has inline comments
- [ ] Type hints are complete
- [ ] No commented-out code
- [ ] No TODO comments (use issue tracker)
- [ ] Documentation files are updated
