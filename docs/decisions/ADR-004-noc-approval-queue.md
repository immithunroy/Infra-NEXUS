# ADR-004 — Centralized NOC Approval Queue

## Status

Accepted

## Context

Field team members (Android app users) need to submit infrastructure changes:
- New TJ boxes, splitters, cables
- Subscriber location updates
- Cable cut records
- Other fiber infrastructure changes

Initially, `fiber_approvals.py` handled fiber-specific approvals. However:
- Only supported fiber infrastructure entity types
- No photo upload capability
- No correction/resubmission workflow
- No GPS tagging on submissions
- No pending count for dashboard

## Decision

Create centralized `approvals.py` router that handles ALL Android/field submissions:
- Supports 11 entity types (tj, tj_splitter, cable, user, user_location, splitter, splice_box, infrastructure, loop, cable_cut, other)
- Photo upload with GPS tagging (max 10MB)
- Return-for-correction workflow
- Resubmission workflow
- Pending count endpoint for dashboard badge
- Comparison view (previous data vs new data)

Keep `fiber_approvals.py` for backward compatibility but mark as legacy.

## Alternatives Considered

1. **Extend fiber_approvals.py** — Add new entity types to existing router
   - Rejected: Too many changes, would break existing API contract

2. **Separate approval queue per entity type** — Different queues for different data
   - Rejected: Increases complexity, no unified view for NOC

3. **Direct database writes** — No approval queue, field team writes directly
   - Rejected: No audit trail, no quality control, security risk

## Consequences

### Benefits
- Single approval queue for all field submissions
- Photo evidence for all changes
- Correction workflow reduces rejected submissions
- Pending count enables dashboard visibility
- Comparison view helps NOC make informed decisions

### Tradeoffs
- Two approval routers (legacy + new) may cause confusion
- Photo storage requires Docker volume mount
- More complex than direct writes

## Date

2026-08-31
