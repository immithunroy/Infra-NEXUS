# AGENTS.md — Master Development Rules

## Infra NEXUS — Documentation-First Development Governance

**Project:** Infra NEXUS — ISP Infrastructure Management Platform  
**Production URL:** https://nexus.qbinternet.com  
**Server:** 103.177.54.6 (Docker-based deployment)

---

## THE MASTER RULE

> **NO CODE CHANGE WITHOUT DOCUMENTATION IMPACT ANALYSIS.**

Before modifying code, determine:
1. What part of the system is changing?
2. Which documentation files are affected?
3. Does the change affect the API? Database? Security? Error handling? Architecture? UI? Android integration? Business rules?

After implementing the change, update every affected documentation file.

---

## REQUIRED DEVELOPMENT WORKFLOW

Every future task MUST follow this lifecycle:

```
REQUEST
   ↓
UNDERSTAND EXISTING SYSTEM
   ↓
READ RELEVANT DOCUMENTATION
   ↓
DOCUMENTATION IMPACT ANALYSIS
   ↓
PLAN
   ↓
IMPLEMENT
   ↓
TEST
   ↓
UPDATE DOCUMENTATION
   ↓
VERIFY DOCUMENTATION ↔ CODE CONSISTENCY
   ↓
FINAL CHANGE REPORT
```

---

## BEFORE WRITING CODE

### Step 1 — Read project rules

Read this file (`AGENTS.md`) first.

### Step 2 — Read relevant documentation

| File | When to Read |
|------|-------------|
| `docs/prd.md` | New features, feature changes |
| `docs/architecture.md` | Architecture changes, new services |
| `docs/rules.md` | Code style, conventions |
| `docs/phases.md` | Project timeline, milestones |
| `docs/design.md` | UI/UX changes |
| `docs/memory.md` | Before any significant change |
| `docs/database.md` | Database changes |
| `docs/prompts.md` | AI agent guidance |
| `docs/security.md` | Security-related changes |
| `docs/error-handling.md` | New error conditions |
| `docs/api.md` | API changes |
| `docs/android-api.md` | Backend changes affecting Android |
| `docs/code-documentation.md` | Code commenting standards |

Do not blindly read every file. Read documentation relevant to the requested change.

---

## DOCUMENTATION IMPACT ANALYSIS

Before implementation, create an internal checklist:

```
Feature: Add subscriber photo upload

Affected:

[ ] prd.md
[x] architecture.md
[x] database.md
[x] api.md
[x] android-api.md
[x] security.md
[x] error-handling.md
[x] design.md
[ ] phases.md
[x] memory.md
[x] code-documentation.md
```

Only update files that are actually affected.

---

## DOCUMENTATION MUST MATCH IMPLEMENTATION

> **CODE IS THE SOURCE OF TRUTH FOR CURRENT BEHAVIOR.**

- Documentation must never describe functionality that does not exist.
- If implementation changes, documentation must change.
- If documentation says something exists but code does not implement it, fix the documentation.
- If code and documentation disagree: `UNKNOWN — REQUIRES CONFIRMATION`. Do not invent behavior.

---

## FEATURE COMPLETION REQUIREMENTS

A feature is not considered complete until:

```
Code = Implemented
Tests = Passed
Documentation = Updated
```

---

## API CHANGE RULES

If an API is created, removed, renamed, modified, deprecated, given new parameters, new response fields, new auth requirements, new permissions, or new errors — update:

- `docs/api.md`
- `docs/android-api.md`
- `docs/security.md` (when applicable)
- `docs/error-handling.md` (when applicable)

Document for every API change:
- HTTP method + endpoint
- Authentication + Authorization
- Headers, Parameters, Request body
- Response + Status codes
- Error responses + Validation
- Database impact + Side effects
- Android usage

---

## DATABASE CHANGE RULES

If any database change occurs (new table, new column, removed column, renamed column, new relationship, new index, new constraint, new enum, new migration, changed default, changed data type) — update:

- `docs/database.md`
- `docs/api.md` (when applicable)
- `docs/android-api.md` (when applicable)
- `docs/architecture.md` (when applicable)
- `docs/security.md` (when applicable)

Database documentation must always represent the current schema.

---

## SECURITY CHANGE RULES

Changes involving authentication, authorization, roles, permissions, tokens, passwords, sessions, CORS, CSRF, rate limiting, file uploads, encryption, secrets, API security, or access control must update:

- `docs/security.md`
- `docs/api.md` (when applicable)
- `docs/android-api.md` (when applicable)
- `docs/error-handling.md` (when applicable)

---

## UI/DESIGN CHANGE RULES

When changing navigation, screens, forms, tables, cards, buttons, colors, typography, components, layout, responsive behavior, or user workflow — review:

- `docs/design.md`
- `docs/prd.md` (when applicable)

---

## ARCHITECTURAL CHANGE RULES

Changes involving new services, new modules, new external integrations, new queues, new cache, new database technology, new infrastructure, new deployment method, new auth mechanism, new communication mechanism, or new background workers must update:

- `docs/architecture.md`
- `docs/memory.md`

---

## BUSINESS RULE CHANGES

If business logic changes, update `docs/rules.md`. Document:
- Previous behavior
- New behavior
- Reason for change
- Affected workflows, roles, API, database

Do not silently change business rules.

---

## ERROR HANDLING CHANGES

Whenever new errors or new failure behavior are introduced, update `docs/error-handling.md`. Document:
- Error condition, HTTP status, error code, error message
- Backend behavior, Frontend behavior, Android behavior
- Retry behavior, Logging behavior

---

## ANDROID API CONTRACT

`docs/android-api.md` is a formal integration document. Any backend change that can affect a future Android application must be reflected there. The Android developer should never have to inspect backend source code to understand the API contract.

---

## API BACKWARD COMPATIBILITY

Before changing an existing API, check:
- Web frontend
- Android application
- External integrations
- Automation, Scripts, Third-party clients

Prefer backward-compatible changes. Do not make compatibility assumptions without checking the codebase.

---

## DEPRECATION

Never silently remove an important API or feature. When deprecating, document:
- Status: DEPRECATED
- Reason, Replacement, Affected clients, Migration instructions, Removal target

Update `docs/api.md`, `docs/android-api.md`, `docs/memory.md`, `docs/phases.md`.

---

## PROJECT MEMORY

`docs/memory.md` is the long-term memory. Record important decisions:
- Date, Decision, Reason, Alternatives considered, Impact

Do not record secrets.

---

## TECHNICAL DEBT

When discovering bugs, workarounds, deprecated dependencies, inconsistent APIs, architectural problems, security weaknesses, performance issues, or missing tests — record them in documentation with priority: CRITICAL, HIGH, MEDIUM, LOW.

Do not fix unrelated technical debt unless explicitly requested.

---

## CHANGE LOG

Maintain `docs/changelog.md` with concise records of meaningful changes. Format:

```markdown
## YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Database
- ...

### API
- ...

### Security
- ...
```

Do not record trivial formatting changes.

---

## ARCHITECTURAL DECISION RECORDS

For major architectural decisions, create `docs/decisions/ADR-NNN-title.md`:

```markdown
# ADR-NNN — Decision Title

## Status
Accepted

## Context
Why was this decision necessary?

## Decision
What was decided?

## Alternatives
What alternatives were considered?

## Consequences
What are the benefits and tradeoffs?

## Date
YYYY-MM-DD
```

Only create ADRs for meaningful architectural decisions.

---

## DEVELOPMENT COMPLETION CHECKLIST

Before declaring any task complete:

```text
[ ] Existing implementation analyzed
[ ] Relevant documentation read
[ ] Documentation impact identified
[ ] Code implemented
[ ] Tests completed
[ ] API documentation updated if required
[ ] Database documentation updated if required
[ ] Security documentation updated if required
[ ] Error handling documentation updated if required
[ ] Android API documentation updated if required
[ ] Architecture documentation updated if required
[ ] Design documentation updated if required
[ ] Business rules updated if required
[ ] Memory updated if required
[ ] Changelog updated if required
[ ] ADR created if required
[ ] Code comments/documentation updated
[ ] No secrets exposed
[ ] No unrelated behavior changed
[ ] Documentation matches actual implementation
```

---

## FINAL VERIFICATION

After implementation, verify:
- API documentation ↔ API implementation
- Database documentation ↔ Database schema
- Architecture documentation ↔ Actual architecture
- Security documentation ↔ Security implementation
- Error documentation ↔ Actual errors
- Android API documentation ↔ API behavior
- Design documentation ↔ UI implementation
- Rules documentation ↔ Business logic

If discrepancies are found, resolve them before completing the task.

---

## FINAL RESPONSE FORMAT

Every development task must finish with:

```markdown
## Implementation Summary

### Changed
- ...

### Files Modified
- ...

### Documentation Updated
- ...

### API Changes
- None / ...

### Database Changes
- None / ...

### Security Changes
- None / ...

### Android Impact
- None / ...

### Tests
- ...

### Documentation Consistency
- Verified

### Known Issues
- None / ...
```

---

## NEVER DO THIS

- Modify production behavior unnecessarily.
- Skip documentation because a change is "small".
- Change an API without updating API documentation.
- Change a database without updating database documentation.
- Change authentication without updating security documentation.
- Add features without updating PRD when appropriate.
- Make architectural decisions without recording them.
- Allow documentation to become stale.
- Invent API behavior, database structures, or business rules.
- Expose secrets.
- Remove documentation because it is inconvenient.
- Replace accurate documentation with generic descriptions.

---

## SMALL CHANGE EXCEPTION

Not every tiny change requires updating every document. A typo fix may only require code change + tests, not `database.md` or `api.md`. However, the developer/AI must still perform a quick documentation impact check.

---

## DOCUMENTATION-FIRST PRINCIPLE

> **Documentation is part of the implementation.**

```
Feature = Code + Tests + Documentation
API = Implementation + Contract Documentation
Database = Schema + Migration + Documentation
Architecture = Implementation + Architecture Documentation
Security = Implementation + Security Documentation
```

A change is incomplete if the relevant documentation is missing.

---

## FUTURE AI AGENT INSTRUCTION

Any AI coding agent working on this repository MUST:

1. Read `AGENTS.md`.
2. Inspect the existing implementation.
3. Read relevant documentation.
4. Determine documentation impact.
5. Make the smallest safe change.
6. Test the change.
7. Update affected documentation.
8. Verify documentation against implementation.
9. Report the documentation changes.

Never assume the documentation is correct merely because it exists. The agent must verify important claims against the actual code.

---

## PROJECT PRINCIPLE

```
             ┌─────────────────┐
             │  Production App │
             └────────┬────────┘
                      │
          ┌───────────┼───────────┐
          ↓           ↓           ↓
       Backend      Database      UI
          │           │           │
          └───────────┼───────────┘
                      ↓
                Documentation
                      │
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
   Web Developers  AI Agents   Android Developers
```

> **The repository should remain self-documenting, AI-readable, developer-friendly, API-ready, and production-safe.**

---

## PROJECT AUDIT TRAIL

Every meaningful development action must leave a traceable history in `docs/audit/`.

### Audit Entry Naming

```
AUDIT-YYYY-MM-DD-NNN
```

### Directory Structure

```
docs/audit/
├── README.md              — Audit system documentation
├── index.md               — Chronological index of all entries
└── 2026/
    ├── 08/
    │   ├── AUDIT-2026-08-31-001-documentation-governance.md
    │   └── AUDIT-2026-08-31-002-noc-approval-queue.md
    └── 09/
```

### When to Create an Audit Entry

Always record:
- Feature creation, modification, removal
- Bug fixes (significant ones)
- Refactoring
- Configuration changes
- Database migrations, schema changes
- API endpoint changes
- Authentication/authorization changes
- Security fixes
- Docker/deployment changes
- Documentation creation/modification
- Architectural decisions

Do NOT record:
- Typo fixes
- Formatting changes
- Whitespace adjustments
- Import reordering

### Audit Entry Format

```markdown
# AUDIT-YYYY-MM-DD-NNN

## Timestamp
YYYY-MM-DD HH:MM +TZ

## Type
Feature / Bug Fix / API / Database / Security / Documentation / Architecture

## Title
Brief description

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
- Files changed

### Database
- Migration or "None"

### API
- Added / Modified / Removed endpoints

### Configuration
- Changes or "None"

## Documentation Updated
| Documentation | Action | Reason |
|---|---|---|

## Tests
How was it verified?

## Result
SUCCESS / PARTIAL / FAILED / REVERTED

## Known Issues
- None or list

## Follow-up
- None or list

## Related Decisions
- ADR-NNN

## Related Audit Entries
- AUDIT-...
```

### Audit Index

Maintain `docs/audit/index.md` with chronological table of all entries.

### Cross-Linking

- Documentation should reference audit IDs when explaining behavior origins
- Audit entries should reference affected documentation
- Bidirectional trail: Code ↔ Documentation ↔ Audit Trail ↔ ADRs

### Three Levels of Project Knowledge

| Level | Location | Purpose |
|-------|----------|---------|
| **Governance** | `AGENTS.md` | How every future developer/AI must work |
| **Current State** | `docs/*.md` | What the system currently is |
| **History** | `docs/audit/` + `docs/decisions/` | How and why the system got here |

### AI Agent Mandatory Behavior

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

### Final Verification Checklist

```text
[ ] Code changed correctly
[ ] Tests completed
[ ] Relevant documentation updated
[ ] Audit entry created
[ ] Audit index updated
[ ] No secrets recorded
[ ] No unexplained meaningful changes remain
```
