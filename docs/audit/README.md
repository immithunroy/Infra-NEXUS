# Audit Trail System

## Infra NEXUS — Project Action, Change & Documentation Audit Trail

**Purpose:** Maintain a complete, chronological, traceable history of meaningful development actions.

---

## Philosophy

> **EVERY MEANINGFUL CHANGE MUST LEAVE A TRACE.**

A future developer must be able to answer:
- What changed?
- When did it change?
- Why did it change?
- Who/what requested it?
- What files changed?
- What APIs changed?
- What database changed?
- What security implications existed?
- What documentation changed?
- How was it tested?
- Was it successful?
- What decisions were made?
- What problems remain?

...without relying on someone's memory or an old chat conversation.

---

## Three Levels of Project Knowledge

| Level | Location | Purpose |
|-------|----------|---------|
| **Governance** | `AGENTS.md` | How every future developer/AI must work |
| **Current State** | `docs/*.md` | What the system currently is |
| **History** | `docs/audit/` + `docs/decisions/` | How and why the system got here |

---

## When to Create an Audit Entry

### Always Record

- Feature creation, modification, removal
- Bug fixes (significant ones)
- Refactoring
- Configuration changes
- Dependency changes
- Migration creation, schema changes
- New API endpoint, modification, removal
- Authentication/authorization changes
- Security fixes
- Docker/deployment changes
- Documentation creation/modification
- Architectural decisions

### Do NOT Record

- Typo fixes
- Formatting changes
- Whitespace adjustments
- Import reordering
- Trivial code style changes

---

## Entry Naming Convention

```
AUDIT-YYYY-MM-DD-NNN
```

Examples:
```
AUDIT-2026-08-31-001
AUDIT-2026-08-31-002
AUDIT-2026-09-01-001
```

Never reuse an audit ID. Newest entries appear first in index.

---

## Entry Format

```markdown
# AUDIT-YYYY-MM-DD-NNN

## Timestamp

YYYY-MM-DD HH:MM +TZ

## Type

Feature / Bug Fix / API / Database / Security / Documentation / Architecture / Refactoring

## Title

Brief description of the change

## Request

Original requested objective.

## Investigation

What was inspected before implementation.

## Findings

Important discoveries from the existing codebase.

## Decision

What was decided and why.

## Changes

### Code

- `backend/app/...`
- `frontend/src/...`

### Database

- None / Migration: ...

### API

- Added / Modified / Removed: `METHOD /path`

### Configuration

- None / ...

## Documentation Updated

| Documentation | Action | Reason |
|---|---|---|
| prd.md | Updated | New feature |
| api.md | Updated | New endpoint |

## Tests

- How was it verified?

## Result

SUCCESS / PARTIAL / FAILED / REVERTED

## Known Issues

- None / ...

## Follow-up

- None / ...

## Related Decisions

- ADR-NNN

## Related Audit Entries

- AUDIT-...
```

---

## Before / After

For important changes, record behavior transition:

```markdown
## Behavior Change

### Before

Subscriber coordinates were not returned by the API.

### After

Subscriber coordinates are returned when available.

### Reason

Required for Android field-worker mapping.
```

---

## Bug Fix Trail

```markdown
## Bug

What was wrong?

## Root Cause

Why did it happen?

## Fix

What was changed?

## Prevention

What prevents recurrence?

## Testing

How was it verified?
```

---

## Failed Changes

Do NOT only record successful changes:

```markdown
## Result

FAILED

## Attempt

What was attempted?

## Failure

What went wrong?

## Current State

Was the change reverted?

## Next Step

What should be investigated next?
```

---

## Reverts

```markdown
## Reversion

Original Audit:

AUDIT-YYYY-MM-DD-NNN

Reason:

The implementation caused regression in the production workflow.

Reverted:

- ...
```

---

## Security Impact

```markdown
## Security Impact

Risk level:

LOW / MEDIUM / HIGH / CRITICAL

Changed:

- Authorization
- Permission
- Token handling

Reason:

...

Verification:

...
```

NEVER record passwords, tokens, private keys, API keys, or other secrets.

---

## Cross-Linking

Documentation should reference audit IDs:
```markdown
This behavior was introduced by:
[AUDIT-2026-08-31-001]
```

Audit entries should reference affected documentation.

Bidirectional trail:
```
Code ↔ Documentation ↔ Audit Trail ↔ Architectural Decision
```

---

## Current State vs History

- `docs/*.md` — Current state (what the system IS)
- `docs/audit/` — Historical changes (how and why it GOT HERE)

Do not turn documentation into a historical dump.

---

## Append-Only History

Historical audit records are append-only.

Do not rewrite old audit entries. Create new ones instead:

```
AUDIT-001 → Feature introduced
AUDIT-015 → Feature modified
AUDIT-029 → Feature deprecated
```

---

## AI Agent Mandatory Behavior

After every meaningful task:

```
IMPLEMENT
   ↓
TEST
   ↓
UPDATE DOCUMENTATION
   ↓
CREATE AUDIT ENTRY
   ↓
UPDATE AUDIT INDEX
   ↓
VERIFY TRACEABILITY
```

---

## Final Verification Checklist

```text
[ ] Code changed correctly
[ ] Tests completed
[ ] Relevant documentation updated
[ ] API documentation updated if required
[ ] Database documentation updated if required
[ ] Security documentation updated if required
[ ] Android documentation updated if required
[ ] Architecture documentation updated if required
[ ] Memory updated if required
[ ] Changelog updated if required
[ ] ADR created if required
[ ] Audit entry created
[ ] Audit index updated
[ ] No secrets recorded
[ ] No unexplained meaningful changes remain
```
