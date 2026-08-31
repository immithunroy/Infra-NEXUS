# ADR-001 — Documentation-First Development Governance

## Status

Accepted

## Context

Infra NEXUS is a production ISP infrastructure management platform with:
- Backend: FastAPI + PostgreSQL + SQLAlchemy 2.0
- Frontend: React 18 + TypeScript + Tailwind CSS
- Deployment: Docker + GitHub Actions CI/CD
- Future: Android mobile app for field team

The project has grown to 35+ database tables, ~120 API endpoints, and 10+ frontend pages. Without structured documentation, new developers and AI agents must rediscover the system from scratch, leading to:
- Inconsistent code patterns
- Undocumented business rules
- Stale documentation that doesn't match implementation
- Security knowledge gaps
- Android integration confusion

## Decision

Implement a **Documentation-First Development Governance** system where:
1. `AGENTS.md` at project root defines mandatory development workflow
2. Every code change requires documentation impact analysis
3. Documentation is part of the implementation (not a separate task)
4. `docs/` directory serves as living source of truth
5. `docs/changelog.md` tracks meaningful changes
6. `docs/decisions/` records architectural decisions (ADRs)

## Alternatives Considered

1. **No documentation governance** — Continue ad-hoc documentation
   - Rejected: Documentation already stale, new features undocumented

2. **README-only documentation** — Single file for everything
   - Rejected: Too large, no structure, hard to maintain

3. **Wiki-based documentation** — External wiki system
   - Rejected: Adds dependency, not version-controlled, not co-located with code

4. **Inline code comments only** — Documentation in code
   - Rejected: No high-level architecture, no business rules, no API contract

## Consequences

### Benefits
- New developers can understand system from documentation alone
- AI agents have clear instructions for code changes
- Android developers have formal API contract
- Business rules documented and traceable
- Architectural decisions recorded for future reference
- Documentation stays current with implementation

### Tradeoffs
- Requires discipline to update documentation with every change
- Small changes may feel over-documented
- Initial investment to create comprehensive documentation

## Date

2026-08-31
