# Security Documentation

## Infra NEXUS — Security Reference

**Version:** 1.0  
**Last Updated:** 2026-08-31

---

## 1. Authentication

### 1.1 JWT Token Authentication

- **Algorithm:** HS256 (HMAC-SHA256)
- **Expiry:** 24 hours (1440 minutes)
- **Token Format:** `eyJhbGciOiJIUzI1NiIs...`

**Token Payload:**
```json
{
  "sub": "1",          // User ID
  "username": "admin", // Username
  "role": "admin",     // User role
  "exp": 1725187200,   // Expiry timestamp
  "iat": 1725100800    // Issued at timestamp
}
```

**Token Validation:**
1. Decode JWT with configured secret
2. Check `exp` claim against current time
3. Look up `sub` (user ID) in database
4. Verify user still exists

### 1.2 Password Hashing

- **Algorithm:** bcrypt
- **Rounds:** Default (10)
- **Storage:** Only hashed passwords in `users.password_hash`

```python
# Hashing
password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())

# Verification
bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
```

### 1.3 Login Flow

```
Client → POST /api/auth/login {username, password}
Server → SELECT user WHERE username = ?
Server → bcrypt.checkpw(password, user.password_hash)
Server → jwt.encode({sub, username, role, exp, iat})
Client ← {access_token, token_type: "bearer"}
```

---

## 2. Authorization (RBAC)

### 2.1 Role Hierarchy

```
admin (highest)
  ↓
global_write
  ↓
noc
  ↓
field_team
  ↓
global_read (lowest)
```

### 2.2 Role Permissions

| Permission | admin | global_write | noc | field_team | global_read |
|-----------|-------|-------------|-----|------------|-------------|
| **User Management** | | | | | |
| Create user | ✅ | ❌ | ❌ | ❌ | ❌ |
| Update user | ✅ | ❌ | ❌ | ❌ | ❌ |
| Delete user | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Device Management** | | | | | |
| CRUD OLT/Mikrotik/Switch | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Operations** | | | | | |
| Run scans | ✅ | ✅ | ✅ | ❌ | ❌ |
| Test connectivity | ✅ | ✅ | ✅ | ❌ | ❌ |
| Live down detection | ✅ | ✅ | ✅ | ❌ | ❌ |
| OLT write-all | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Subscriber Data** | | | | | |
| Update GPS/address | ✅ | ✅ | ❌ | ✅* | ❌ |
| **Fiber Infrastructure** | | | | | |
| CRUD cables/TJ/splitters | ✅ | ✅ | ❌ | ❌ | ❌ |
| **Approval Queue** | | | | | |
| Submit for approval | ✅ | ✅ | ❌ | ✅ | ❌ |
| Approve/reject | ✅ | ✅ | ✅ | ❌ | ❌ |
| Return for correction | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Read Access** | | | | | |
| View all data | ✅ | ✅ | ✅ | ✅ | ✅ |

*field_team can update GPS/address only on subscribers assigned to their tickets

### 2.3 Permission Guard Functions

```python
# security.py
def require_write(user: User) -> User:
    """admin, global_write only"""
    
def require_ops(user: User) -> User:
    """admin, global_write, noc"""
    
def require_gps_write(user: User) -> User:
    """admin, global_write, field_team"""
    
def require_admin(user: User) -> User:
    """admin only"""
    
def require_fiber_request(user: User) -> User:
    """admin, global_write, field_team"""
    
def require_noc_approval(user: User) -> User:
    """admin, global_write, noc"""
    
def require_approval_submit(user: User) -> User:
    """admin, global_write, field_team"""
```

---

## 3. Data Security

### 3.1 Sensitive Data Handling

| Data | Storage | Transmission | Notes |
|------|---------|-------------|-------|
| Passwords | bcrypt hash | Never sent after auth | Only in login request |
| JWT Secret | Environment variable | N/A | Never in code |
| SNMP Community | Encrypted DB column | SNMP v2c | Stored as plaintext in DB |
| Device passwords | DB column | Telnet/SSH | Stored as plaintext in DB |
| GPS coordinates | DB column | HTTPS | Accuracy < 9m required |

### 3.2 Data Exposure Risks

**Current Risks (known):**
1. Device passwords stored as plaintext in DB
2. SNMP community strings stored as plaintext
3. `noc_pop.py` endpoints have no authentication
4. No rate limiting on any endpoints
5. No CORS restriction beyond origins list

**Mitigations:**
1. Use Docker network isolation
2. Only expose port 8050 via nginx
3. Use HTTPS via Nginx Proxy Manager
4. Limit database access to backend container only

---

## 4. Network Security

### 4.1 Production Network

```
Internet → NPM (SSL) → :8050 → Frontend Container :80
                                              ↕
                                    Backend Container :8080
                                              ↕
                                    PostgreSQL Container :5432
```

### 4.2 Docker Network Isolation

- `nexus_internal` — Internal bridge (backend ↔ database)
- `proxy_npm_network` — External (frontend → NPM)
- Database port 5432 is **not exposed** to host

### 4.3 SSH Access

- Production server accessed via SSH key (not password)
- Key: `.deploy/olt_commander_ed25519`
- User: `root`

---

## 5. Input Validation

### 5.1 Pydantic Validation

All request bodies validated via Pydantic models:

```python
class OLTDeviceCreate(BaseModel):
    name: str = Field(..., max_length=128)
    ip: str = Field(..., pattern=r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")
    vendor: str = "bdcom"
    pon_type: str = Field("gpon", pattern=r"^(gpon|epon)$")
    access_method: AccessMethod = AccessMethod.telnet
    port: int = Field(23, ge=1, le=65535)
    username: str = ""
    password: str = ""
```

### 5.2 Auto-Uppercasing

These fields are automatically uppercased:
- `code` (cable)
- `link_name` (cable)
- `manufacturer` (cable)
- `name` (TJ box, splitter)

### 5.3 Numeric Validation

- `tj_port` must be in {2, 4, 8, 10, 12}
- `capacity` = `tray_count × splice_per_tray`
- `gps_accuracy` must be < 9 meters
- `core_count` must be > 0

---

## 6. API Security

### 6.1 CORS Configuration

```python
CORS_ORIGINS: str = "https://nexus.qbinternet.com,http://localhost:3000,http://localhost:5173"
```

- Only specified origins allowed
- Credentials allowed (for JWT cookies)

### 6.2 Request Size Limits

- No global request size limit configured
- Photo upload limit: **10MB** (enforced in handler)
- No body size limit on other endpoints

### 6.3 Rate Limiting

**Not implemented.** All endpoints have unlimited request rates.

### 6.4 SQL Injection Protection

- SQLAlchemy ORM with parameterized queries
- No raw SQL in application code
- AsyncPG driver handles parameter escaping

---

## 7. File Upload Security

### 7.1 Photo Upload

- **Endpoint:** `POST /api/approvals/upload-photo`
- **Max Size:** 10MB
- **Storage:** `/app/uploads/approval-photos/`
- **Filename:** Server-generated (timestamp + random)
- **Docker Volume:** Mounted from host

### 7.2 File Type Validation

- Only image files accepted (JPEG, PNG, WebP)
- Content-Type header validated
- File extension not relied upon

---

## 8. Audit Trail

### 8.1 Approval Queue

All field submissions tracked:
- `requested_by` — Who submitted
- `submitted_by_name` — Cached name
- `reviewed_by` — Who approved/rejected
- `created_at` — Submission time
- `reviewed_at` — Review time
- `previous_data_json` — Before state (for comparison)

### 8.2 Scan Logs

All device scans logged:
- `scan_type` — olt/mikrotik/bind
- `device_id` — Which device
- `status` — running/success/failed
- `started_at` / `finished_at` — Timing

### 8.3 OLT Write Logs

All OLT provisioning changes logged:
- `olt_id` — Which OLT
- `status` — running/success/failed
- `message` — Result details

---

## 9. Security Best Practices (Recommendations)

### 9.1 Immediate

1. **Add authentication to `noc_pop.py`** — Currently no auth on any endpoint
2. **Add rate limiting** — Prevent brute force on login
3. **Encrypt device passwords** — Use application-level encryption
4. **Add request size limits** — Configure in nginx

### 9.2 Short-term

1. **Implement refresh tokens** — Currently requires re-login after 24h
2. **Add API key authentication** — For Android app
3. **Implement request logging** — Audit all API calls
4. **Add CSRF protection** — For web dashboard

### 9.3 Long-term

1. **Migrate to asymmetric JWT** — RS256 instead of HS256
2. **Implement OAuth2/OIDC** — For enterprise SSO
3. **Add field-level encryption** — For sensitive device credentials
4. **Security scanning** — Automated vulnerability assessment
5. **Penetration testing** — Annual security audit

---

## 10. Incident Response

### 10.1 Compromised Token

```bash
# 1. Force user to re-login by changing JWT secret
# 2. Update JWT_SECRET in .env
# 3. Restart backend container
docker compose up -d --build backend
```

### 10.2 Database Breach

```bash
# 1. Stop backend container
docker compose stop backend

# 2. Change all passwords
# 3. Rotate JWT secret
# 4. Review access logs
# 5. Notify affected users
```

### 10.3 Unauthorized Access

```bash
# 1. Check user roles
psql -U olt -d infra_nexus -c "SELECT username, role FROM users;"

# 2. Revoke suspicious accounts
psql -U olt -d infra_nexus -c "DELETE FROM users WHERE username = 'suspicious';"

# 3. Review approval queue
curl -H "Authorization: Bearer $TOKEN" https://nexus.qbinternet.com/api/approvals?status=pending
```
