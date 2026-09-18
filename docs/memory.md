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

---

## 7. Key Architecture Decisions

### 7.1 Subscriber List Source of Truth

**Date:** 2026-09-18

**Decision:** Changed subscriber list endpoint to query from `subscribers` table (MikroTik secrets) instead of `onus` table.

**Previous behavior:** Subscribers only appeared in the UI when an ONU record had a matching MAC bound to an active PPPoE session. This required two conditions: (1) MikroTik scan, (2) MAC binding match.

**New behavior:** Every PPPoE secret synced from MikroTik appears in the UI immediately on the next scan, regardless of ONU binding or PPPoE connection status.

**Reason:** Operators need to see all provisioned subscribers, not just those currently connected. A subscriber created on MikroTik (via WinBox) should be visible in the web UI without requiring an active connection.

**Impact:** `GET /api/subscribers` now queries `subscribers` table as source of truth, LEFT JOINs with `ppp_active_entries` (connection status) and `onus` (ONU binding). Response includes new fields: `connected` (bool), `onu_binded` (bool). Tabs changed from "active/unbound/disabled" to "connected/disconnected/disabled".

### 7.2 Multi-Subscriber ONU Support

**Date:** 2026-09-18

**Decision:** Added `onu_subscribers` table (many-to-many: ONU ↔ Subscriber) to support multiple subscribers behind one ONU via switch.

**Problem:** When multiple subscribers share one ONU (via switch), they all have the same MAC address. The original `mac_binding.py` stored only one session per MAC in `active_by_mac`, so only one subscriber got bound to the ONU. Other subscribers appeared as "disconnected" even though they were physically connected.

**Solution:** 
1. New `onu_subscribers` table with `UNIQUE(onu_id, pppoe_username)` constraint
2. `mac_binding.py` now stores ALL sessions per MAC (list, not single tuple)
3. When a MAC matches an ONU, ALL matching subscribers are added to `onu_subscribers`
4. `list_subscribers` checks both `Onu.subscriber` (backward compat) and `onu_subscribers` for `onu_binded` status

**Impact:** All subscribers behind the same ONU now correctly show `onu_binded = true` and the OLT/PORT column links to the ONU profile.

### 7.3 Subscriber Tags from MikroTik Firewall Address-Lists

**Date:** 2026-09-18

**Decision:** Added subscriber tagging system that reads 'multi' and 'suspect' address lists from MikroTik and tags matching subscribers.

**Problem:** Operators maintain firewall address-lists on MikroTik to flag subscribers using multiple routers (`multi`) or suspected of overusage (`suspect`). These flags need to be visible in the web UI.

**Solution:**
1. `MikrotikDriver.collect_firewall_address_lists()` fetches `/ip/firewall/address-list`
2. `subscriber_tag.py` service matches IPs to active PPPoE sessions
3. `subscribers.tag` column stores comma-separated tags (e.g., "multi,suspect")
4. Scheduled job runs with MikroTik scan interval
5. Manual refresh via `POST /api/subscribers/tags/refresh`

**Impact:** Tagged subscribers show "Multi Router" and/or "Suspect" badges in subscriber list and profile.
