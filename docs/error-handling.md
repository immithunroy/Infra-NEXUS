# Error Handling Documentation

## Infra NEXUS — Error Handling Reference

**Version:** 1.0  
**Last Updated:** 2026-08-31

---

## 1. HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful GET/PUT |
| 201 | Created | Successful POST (resource created) |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Invalid request body/format |
| 401 | Unauthorized | Missing/invalid JWT token |
| 403 | Forbidden | Insufficient role permissions |
| 404 | Not Found | Resource doesn't exist |
| 413 | Payload Too Large | File upload > 10MB |
| 422 | Unprocessable Entity | Validation error |
| 500 | Internal Server Error | Unhandled exceptions |

---

## 2. Backend Error Format

All errors returned as JSON:

```json
{
  "detail": "Human-readable error message"
}
```

### 2.1 Authentication Errors

**401 Unauthorized:**
```json
{
  "detail": "Could not validate credentials"
}
```

**Causes:**
- Missing `Authorization` header
- Malformed `Bearer` token
- Expired JWT token
- User no longer exists in database

**Frontend Handling:**
```typescript
if (response.status === 401) {
  localStorage.removeItem('token');
  navigate('/login');
}
```

### 2.2 Authorization Errors

**403 Forbidden:**
```json
{
  "detail": "Your role does not permit this action"
}
```

**Causes:**
- User role doesn't match required permission
- Field team trying to access admin-only endpoint
- Read-only user trying to write

**Frontend Handling:**
```typescript
if (response.status === 403) {
  showToast('You do not have permission to perform this action');
}
```

### 2.3 Bad Request Errors

**400 Bad Request:**
```json
{
  "detail": "A cable with code 'XYZ-123' already exists"
}
```

**Causes:**
- Duplicate unique constraint violation (e.g., cable code)
- Invalid input data that passes Pydantic validation but fails business rules

**Frontend Handling:**
```typescript
if (response.status === 400) {
  showToast(response.data.detail, 'error');
}
```

### 2.4 Validation Errors

**422 Unprocessable Entity:**
```json
{
  "detail": [
    {
      "loc": ["body", "name"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

**Frontend Handling:**
```typescript
if (response.status === 422) {
  const errors = response.data.detail;
  errors.forEach(err => {
    const field = err.loc[1];
    setFieldError(field, err.msg);
  });
}
```

---

## 3. Database Errors

### 3.1 Connection Errors

**Symptoms:**
- Backend logs: `sqlalchemy.exc.OperationalError`
- API returns 500

**Causes:**
- PostgreSQL container not running
- Wrong `DATABASE_URL` in environment
- Connection pool exhausted

**Recovery:**
```bash
# Check database container
docker compose ps db

# Restart database
docker compose restart db

# Check connection pool
docker compose logs backend | grep "pool"
```

### 3.2 Unique Constraint Violations

**Symptoms:**
- `sqlalchemy.exc.IntegrityError`
- Duplicate key value violates unique constraint

**Examples:**
- Creating OLT with same IP as existing
- Creating ONU with same pon_port + onu_id on same OLT
- Creating user with same username

**Backend Handling:**
```python
try:
    session.add(new_record)
    await session.commit()
except IntegrityError:
    await session.rollback()
    raise HTTPException(400, "Record already exists")
```

### 3.3 Foreign Key Violations

**Symptoms:**
- `sqlalchemy.exc.IntegrityError`
- violates foreign key constraint

**Causes:**
- Referencing non-existent device/user
- Deleting parent with children (if not CASCADE)

**Backend Handling:**
```python
# Use CASCADE deletes
ondelete="CASCADE"

# Or SET NULL for optional references
ondelete="SET NULL"
```

---

## 4. Device Communication Errors

### 4.1 OLT Connection Errors

**Symptoms:**
- `telnetlib` connection timeout
- SSH connection refused

**Causes:**
- OLT IP unreachable
- Wrong credentials
- OLT overloaded/unresponsive
- Firewall blocking port 23/22

**Backend Handling:**
```python
try:
    driver = await build_driver(device)
    onus = await driver.get_onus()
except Exception as e:
    log.status = "failed"
    log.message = str(e)
```

**Frontend Handling:**
```typescript
try {
  await api.post(`/devices/olts/${oltId}/scan`);
} catch (error) {
  if (error.response?.status === 500) {
    showToast('OLT scan failed - device may be unreachable');
  }
}
```

### 4.2 Mikrotik API Errors

**Symptoms:**
- `routeros_api` connection timeout
- Authentication failed

**Causes:**
- Wrong API port (default 8728)
- SSL mismatch
- API user disabled

### 4.3 SNMP Errors

**Symptoms:**
- `pysnmp` timeout
- No response from agent

**Causes:**
- Wrong community string
- SNMP disabled on device
- Firewall blocking UDP 161

**Backend Handling:**
```python
# SNMP is best-effort — don't fail entire scan
try:
    rx_power = await snmp_walk(olt, OID_RX)
except Exception:
    rx_power = None  # Continue with other ONUs
```

---

## 5. Scheduler Errors

### 5.1 Job Execution Failures

**Symptoms:**
- Job shows `status: "failed"` in `/api/scheduler/status`
- Error message in job status

**Causes:**
- Database connection lost
- Device unreachable
- Unhandled exception in job function

**Backend Handling:**
```python
async def _scan_all_olts():
    try:
        for olt in enabled_olts:
            await collector.scan_olt(session, olt.id)
    except Exception as e:
        logger.error("Scan all OLTs failed: %s", e)
```

### 5.2 Job Stuck in "running"

**Symptoms:**
- `max_instances=1` prevents duplicate runs
- Job shows `status: "running"` indefinitely

**Recovery:**
```bash
# Restart backend to reset job state
docker compose restart backend
```

---

## 6. File Upload Errors

### 6.1 Photo Too Large

**Error Response:**
```json
{
  "detail": "File size exceeds 10MB limit"
}
```

**Frontend Handling:**
```typescript
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
if (file.size > MAX_SIZE) {
  showToast('Photo must be under 10MB');
  return;
}
```

### 6.2 Invalid File Type

**Error Response:**
```json
{
  "detail": "Only JPEG, PNG, and WebP images are accepted"
}
```

### 6.3 Storage Full

**Symptoms:**
- `OSError: No space left on device`
- Backend container logs show disk error

**Recovery:**
```bash
# Check disk usage
df -h

# Clean old photos
find /app/uploads/approval-photos -mtime +90 -delete

# Clean Docker images
docker image prune -f
```

---

## 7. Network Errors

### 7.1 CORS Errors

**Symptoms:**
- Browser console: `Access-Control-Allow-Origin` error
- API request blocked by browser

**Causes:**
- Origin not in `CORS_ORIGINS` list
- Missing `Authorization` header

**Fix:**
```python
# Add origin to CORS_ORIGINS in .env
CORS_ORIGINS=https://nexus.qbinternet.com,http://localhost:5173
```

### 7.2 Timeout Errors

**Symptoms:**
- Request timeout after 30s
- Gateway timeout (504)

**Causes:**
- Slow database query
- Device communication timeout
- Large data transfer

**Mitigation:**
```python
# Set appropriate timeouts
httpx.Client(timeout=30.0)
telnetlib.Telnet(host, port, timeout=10)
```

---

## 8. Frontend Error Handling

### 8.1 Global Error Boundary

```tsx
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  
  render() {
    if (this.state.hasError) {
      return <CrashScreen error={this.state.error} />;
    }
    return this.props.children;
  }
}
```

### 8.2 API Error Interceptor

```typescript
// api.ts
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

### 8.3 Toast Notifications

```typescript
// Success
showToast('OLT scan started', 'success');

// Error
showToast('Failed to connect to OLT', 'error');

// Warning
showToast('GPS accuracy is low (< 9m)', 'warning');
```

---

## 9. Logging

### 9.1 Backend Logging

```python
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("olt_commander")

# Usage
logger.info("Scan complete: %d ONUs found", len(onus))
logger.error("OLT scan failed: %s", str(e))
```

### 9.2 Log Levels

| Level | When to Use |
|-------|-------------|
| `DEBUG` | Detailed diagnostic info |
| `INFO` | Normal operation (scan start/complete) |
| `WARNING` | Unexpected but recoverable |
| `ERROR` | Operation failed |
| `CRITICAL` | System-level failure |

### 9.3 Docker Logs

```bash
# View backend logs
docker compose logs -f backend

# View last 100 lines
docker compose logs --tail 100 backend

# View database logs
docker compose logs -f db
```

---

## 10. Recovery Procedures

### 10.1 Backend Crash

```bash
# Check status
docker compose ps backend

# View crash logs
docker compose logs --tail 50 backend

# Restart
docker compose restart backend

# Full rebuild if needed
docker compose up -d --build backend
```

### 10.2 Database Corruption

```bash
# Backup current database
docker compose exec db pg_dump -U olt infra_nexus > backup.sql

# Restore from backup
docker compose exec -T db psql -U olt infra_nexus < backup.sql
```

### 10.3 Disk Space Exhaustion

```bash
# Find large files
du -sh /* | sort -rh | head

# Clean Docker
docker system prune -a

# Clean old logs
journalctl --vacuum-time=7d

# Clean old telemetry (already auto-pruned at 90 days)
```
