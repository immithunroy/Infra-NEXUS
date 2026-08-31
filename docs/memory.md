# Development Memory

## Infra NEXUS — Lessons Learned & Key Decisions

**Version:** 1.0  
**Last Updated:** 2026-08-31

---

## 1. Critical Lessons

### 1.1 OLT Session Limitation

**Problem:** BDCOM OLT drops telnet session after ~1 ONU per connection (~36 commands).

**Impact:** Can only reliably configure one ONU per telnet session.

**Solution:** Create new telnet session for each ONU operation.

**Lesson:** Hardware limitations must be discovered through testing, not assumed from documentation.

---

### 1.2 PowerShell SSH Quoting

**Problem:** PowerShell breaks `$`, `{}`, backticks, quotes in SSH commands.

**Impact:** Cannot directly run complex SSH commands from PowerShell.

**Solution:** Write local `.sh`/`.py` scripts, `scp` to server, run remotely.

**Lesson:** Shell quoting differences between Windows and Linux are a major pain point.

---

### 1.3 `write all` is DEFERRED

**Problem:** Running `write all` immediately after OLT configuration causes issues.

**Impact:** Configuration changes may not persist if `write all` runs too early.

**Solution:** Remove `write all` from all OLT driver methods. Only runs via daily scheduler.

**Lesson:** Some operations need delayed execution, not immediate execution.

---

### 1.4 ONU PON Port Format

**Problem:** `pon_port` in database includes `:onu_id` suffix (e.g., `EPON0/5:16`).

**Impact:** Must strip suffix before sending CLI commands to OLT.

**Solution:** `pon_port.split(":")[0]` for CLI, full string for database storage.

**Lesson:** Data storage format may differ from command format.

---

### 1.5 SNMP vs CLI Optical Power

**Problem:** SNMP `.5.1.5` (Rx) gives ONU self-reported values (CTC DDM), not OLT-measured.

**Impact:** SNMP Rx values naturally differ from CLI `show optical-transceiver-diagnosis`.

**Solution:** Accept as expected behavior. CLI check gives OLT-measured values.

**Lesson:** Different data sources may give different values for the same metric.

---

### 1.6 Auto-Uppercasing

**Problem:** Users sometimes enter lowercase cable codes, TJ names, etc.

**Impact:** Inconsistent data makes searching and matching difficult.

**Solution:** Auto-uppercase in Pydantic validators: `code`, `link_name`, `manufacturer`, `name` (TJ/splitter).

**Lesson:** Normalize data at entry point, not at query time.

---

### 1.7 TJ Box Capacity Formula

**Problem:** Initial implementation had static `capacity` field.

**Impact:** Users had to manually calculate capacity when changing trays.

**Solution:** `capacity = tray_count × splice_per_tray` (auto-calculated).

**Lesson:** Derived values should be computed, not stored.

---

### 1.8 Core-to-One Splice Validation

**Problem:** No validation prevented splicing the same core to multiple cores.

**Impact:** Ambiguous fiber paths, impossible physical connections.

**Solution:** Application-level validation checks core occupancy before create/update.

**Lesson:** Business rules often can't be enforced at database level.

---

### 1.9 Field Team GPS Permission

**Problem:** Field team could update GPS on any subscriber.

**Impact:** Potential for unauthorized location changes.

**Solution:** Field team can only update GPS on subscribers assigned to their tickets.

**Lesson:** Granular permissions need careful design.

---

### 1.10 Docker Container Rebuild

**Problem:** Python code changes don't take effect without container rebuild.

**Impact:** `docker compose up -d` only restarts, doesn't rebuild.

**Solution:** Always use `docker compose up -d --build backend` for Python changes.

**Lesson:** Docker caching can cause stale code issues.

---

## 2. Architecture Decisions

### 2.1 No Alembic

**Decision:** Use `Base.metadata.create_all()` + manual SQL migrations.

**Rationale:** 
- Simpler for small team
- No migration conflict resolution
- Manual control over schema changes

**Trade-off:** No automatic schema diffing or rollback.

---

### 2.2 Single Database

**Decision:** Single PostgreSQL database for all data.

**Rationale:**
- Simpler deployment
- ACID compliance
- Easier backups

**Trade-off:** May not scale to millions of subscribers.

---

### 2.3 In-Memory Scheduler State

**Decision:** APScheduler job status stored in Python dict, not database.

**Rationale:**
- Simple implementation
- No DB overhead for status checks
- Status is ephemeral anyway

**Trade-off:** Lost on container restart (acceptable).

---

### 2.4 Photo Storage on Local Disk

**Decision:** Store approval photos on local filesystem, not S3.

**Rationale:**
- Simpler setup
- No cloud dependency
- Docker volume mount persists data

**Trade-off:** No CDN, no redundancy, limited scalability.

---

### 2.5 No Rate Limiting

**Decision:** No rate limiting on API endpoints.

**Rationale:**
- Internal ISP tool (not public-facing)
- Small user base
- Nginx can add rate limiting if needed

**Trade-off:** Vulnerable to brute force (mitigated by network isolation).

---

## 3. Technical Debt

### 3.1 Device Passwords in Plaintext

**Status:** Known limitation  
**Risk:** Medium  
**Mitigation:** Docker network isolation, no external exposure  
**Fix:** Application-level encryption (future)

### 3.2 No Authentication on `noc_pop.py`

**Status:** Known limitation  
**Risk:** High  
**Mitigation:** Network isolation  
**Fix:** Add auth guards (future)

### 3.3 No Automated Tests

**Status:** Known limitation  
**Risk:** Medium  
**Mitigation:** Manual testing, TypeScript compilation checks  
**Fix:** Add pytest + React Testing Library (future)

### 3.4 Single-File Frontend Pages

**Status:** Known limitation  
**Risk:** Low  
**Mitigation:** Pages are self-contained  
**Fix:** Component extraction (future)

### 3.5 No Refresh Tokens

**Status:** Known limitation  
**Risk:** Low  
**Mitigation:** 24-hour token expiry acceptable for ISP use case  
**Fix:** Add refresh token endpoint (future)

---

## 4. Performance Notes

### 4.1 Database Connection Pool

- `pool_size=10` — Base connections
- `max_overflow=20` — Burst connections
- `pool_pre_ping=True` — Verify connections

**Tuning:** Increase if concurrent users exceed 20.

### 4.2 Telemetry Retention

- 90 days for optical telemetry
- Pruned automatically during collection job
- ~10M rows at peak (2500 ONUs × 5 min × 90 days)

### 4.3 BGP Snapshot Retention

- 365 days for prefix snapshots
- Pruned during Mikrotik scan
- ~50K rows at peak

### 4.4 Large Table Performance

- `onu_telemetry` — Partitioned by time (implicitly via pruning)
- `bgp_prefix_snapshots` — Partitioned by time
- `scan_logs` — Not pruned (grows indefinitely)

---

## 5. Deployment Notes

### 5.1 CI/CD Pipeline

- Trigger: Push to `main`
- Steps: SSH → git pull → docker compose build → up -d → prune
- No manual intervention

### 5.2 Container Rebuild

- Python changes: `docker compose up -d --build backend`
- Frontend changes: Auto-deploy via CI/CD
- Database migrations: Manual SQL

### 5.3 Backup Strategy

```bash
# Database backup
docker compose exec db pg_dump -U olt infra_nexus > backup_$(date +%Y%m%d).sql

# Photo backup
tar -czf photos_$(date +%Y%m%d).tar.gz /app/uploads/approval-photos/
```

### 5.4 Monitoring

- `GET /api/health` — Backend health
- `GET /api/scheduler/status` — Job status
- `docker compose ps` — Container status
- `docker compose logs -f backend` — Real-time logs

---

## 6. Future Considerations

### 6.1 Scaling

- Add read replicas for PostgreSQL
- Implement Redis for caching
- Add CDN for static assets
- Consider microservices for BGP/ACS

### 6.2 Security

- Migrate to asymmetric JWT (RS256)
- Add refresh tokens
- Implement field-level encryption
- Add API key authentication

### 6.3 Features

- SNMP v3 support
- OLT firmware upgrades
- Geographic outage heatmaps
- Multi-tenant support
- Webhook notifications
