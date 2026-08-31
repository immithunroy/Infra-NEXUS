# Android App API Guide

## Infra NEXUS — Android Integration Reference

**Base URL:** `https://nexus.qbinternet.com/api`  
**Auth:** JWT Bearer token  
**Target:** Android field team app (Kotlin/Java)

---

## 1. Overview

The Android app is used by field team members to:
- View subscriber and infrastructure data
- Submit field changes for NOC approval
- Capture photos with GPS tagging
- Update subscriber address and location

All field submissions go through the **NOC Approval Queue** — nothing is written directly to the database without NOC review.

---

## 2. Authentication

### Login

```
POST /api/auth/login
Content-Type: application/json

{
  "username": "field_user",
  "password": "password123"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

**Storage:** Store `access_token` in SharedPreferences or EncryptedSharedPreferences.

### Using the Token

```
GET /api/onus
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Token Expiry

- Tokens expire after **24 hours** (1440 minutes)
- On 401 response, redirect to login screen
- Refresh requires re-login (no refresh token endpoint)

---

## 3. Android-Specific API Endpoints

The Android app uses the same REST API as the web dashboard, with special attention to these endpoints:

### 3.1 Core Read Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/onus` | GET | List ONUs with filters |
| `/api/onus/{id}` | GET | Get ONU detail |
| `/api/subscribers` | GET | List subscribers |
| `/api/subscribers/{subscriber}` | GET | Full subscriber profile |
| `/api/subscribers/{subscriber}/telemetry` | GET | Optical telemetry data |
| `/api/fiber/tj-boxes` | GET | List TJ boxes |
| `/api/fiber/splitters` | GET | List splitters |
| `/api/fiber/cables` | GET | List fiber cables |
| `/api/tickets` | GET | List assigned tickets |
| `/api/tickets/{id}` | GET | Get ticket detail |
| `/api/dashboard` | GET | Dashboard summary |
| `/api/search?q=` | GET | Global search |

### 3.2 Write Endpoints (Direct — No Approval)

These endpoints write directly to the database. Only available to `admin` and `global_write` roles:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/onus/{id}` | PUT | Update subscriber GPS/address |
| `/api/tickets/{id}` | PUT | Update ticket status |
| `/api/downs/areas` | PUT | Update area label |

**Note:** The `field_team` role can update GPS/address only on subscribers assigned to their tickets.

### 3.3 Approval Queue Endpoints (Field Team)

All field team submissions go through the NOC approval queue:

#### Submit for Approval

```
POST /api/approvals/submit
Authorization: Bearer <token>
Content-Type: application/json

{
  "action": "create",
  "entity_type": "tj",
  "entity_id": null,
  "payload_json": "{\"name\": \"New TJ Box\", \"lat\": 23.8103, \"lng\": 90.4125, \"tj_port\": 8, \"box_type\": \"regular_tj\"}",
  "previous_data_json": "",
  "priority": "normal",
  "photos_json": ["1725100000_photo1.jpg"],
  "location_json": "{\"lat\": 23.8103, \"lng\": 90.4125}"
}
```

**Response:**
```json
{
  "id": 42,
  "action": "create",
  "entity_type": "tj",
  "entity_id": null,
  "status": "pending",
  "priority": "normal",
  "created_at": "2026-08-31T10:00:00Z"
}
```

#### Upload Photo

```
POST /api/approvals/upload-photo
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <image_binary>
```

**Response:**
```json
{
  "filename": "1725100000_photo1.jpg",
  "url": "/api/approvals/photos/1725100000_photo1.jpg"
}
```

**Constraints:**
- Max file size: **10MB**
- Supported formats: JPEG, PNG, WebP
- Photo is stored locally on the server

#### View Own Submissions

```
GET /api/approvals?status=pending
Authorization: Bearer <token>
```

**Note:** `field_team` role can only see their own submissions.

#### Resubmit Corrected Data

```
PUT /api/approvals/{id}/resubmit
Authorization: Bearer <token>
Content-Type: application/json

{
  "payload_json": "{\"name\": \"New TJ Box - corrected\", ...}",
  "photos_json": ["1725100001_new_photo.jpg"]
}
```

---

## 4. Entity Types Reference

When submitting to the approval queue, use these `entity_type` values:

| Entity Type | Description | Key Payload Fields |
|-------------|-------------|-------------------|
| `tj` | TJ splice box | name, box_type, tj_port, tray_count, splice_per_tray, lat, lng, address |
| `tj_splitter` | Splitter in TJ | name, split_ratio, tj_box_id, input_core, output_cores, lat, lng |
| `cable` | Fiber cable | link_name, code, core_count, manufacturer, cable_type, route_type, src_tj_id, dst_tj_id, segments[] |
| `splitter` | Standalone splitter | name, split_ratio, lat, lng |
| `splice_box` | Splice box (legacy) | name, capacity, lat, lng |
| `loop` | Fiber loop | cable_id, segment_index, lat, lng, loop_length_m |
| `cable_cut` | Cable cut event | cable_id, lat, lng, status, notes |
| `user` | Subscriber | name, phone, email, govt_id_type, govt_id_number |
| `user_location` | Subscriber location | subscriber, address, lat, lng, gps_accuracy |
| `infrastructure` | General infrastructure | Any custom data |
| `other` | Other changes | Any custom data |

---

## 5. Workflow Examples

### 5.1 Adding a New TJ Box

```
Step 1: Capture photo
POST /api/approvals/upload-photo
→ filename: "1725100000_tj_photo.jpg"

Step 2: Get GPS coordinates
LocationManager → lat: 23.8103, lng: 90.4125

Step 3: Submit for approval
POST /api/approvals/submit
{
  "action": "create",
  "entity_type": "tj",
  "payload_json": "{\"name\": \"Rampura TJ-01\", \"box_type\": \"regular_tj\", \"tj_port\": 8, \"tray_count\": 1, \"splice_per_tray\": 12, \"lat\": 23.8103, \"lng\": 90.4125, \"address\": \"Rampura, Dhaka\"}",
  "photos_json": ["1725100000_tj_photo.jpg"],
  "location_json": "{\"lat\": 23.8103, \"lng\": 90.4125}",
  "priority": "normal"
}

Step 4: Wait for NOC approval
GET /api/approvals/{id}
→ status: "pending" → "approved"
```

### 5.2 Recording a Cable Cut

```
POST /api/approvals/submit
{
  "action": "create",
  "entity_type": "cable_cut",
  "payload_json": "{\"cable_id\": 5, \"lat\": 23.8150, \"lng\": 90.4180, \"status\": \"cut\", \"notes\": \"Road work damage\"}",
  "photos_json": ["1725100001_cut_photo.jpg"],
  "priority": "high"
}
```

### 5.3 Updating Subscriber Location

```
POST /api/approvals/submit
{
  "action": "update",
  "entity_type": "user_location",
  "entity_id": 15,
  "payload_json": "{\"subscriber\": \"user@isp\", \"address\": \"123 Main St, Rampura\", \"lat\": 23.8103, \"lng\": 90.4125}",
  "previous_data_json": "{\"address\": \"Old Address\", \"lat\": 23.8100, \"lng\": 90.4120}",
  "photos_json": [],
  "location_json": "{\"lat\": 23.8103, \"lng\": 90.4125}"
}
```

### 5.4 Handling Returned Correction

```
Step 1: Check submission status
GET /api/approvals/{id}
→ status: "returned_for_correction"
→ correction_note: "Please re-check the cable code - incorrect"

Step 2: Capture new photo (if needed)
POST /api/approvals/upload-photo
→ filename: "1725100002_corrected_photo.jpg"

Step 3: Resubmit with corrections
PUT /api/approvals/{id}/resubmit
{
  "payload_json": "{\"name\": \"Rampura TJ-01\", ...corrected data...}",
  "photos_json": ["1725100002_corrected_photo.jpg"]
}
```

---

## 6. Data Models

### 6.1 ONU Object

```json
{
  "id": 1,
  "olt_id": 1,
  "olt_name": "OLT-01",
  "source": "auto",
  "state": "active",
  "name": "Customer Name",
  "serial": "BDFO-12345678",
  "mac": "AA:BB:CC:DD:EE:FF",
  "pon_port": "EPON0/1:5",
  "onu_id": 5,
  "vlan": 100,
  "rx_power": -18.5,
  "tx_power": 2.3,
  "distance": 5.2,
  "subscriber": "user@isp",
  "bound": true,
  "down_reason": "",
  "address": "123 Main St, Rampura",
  "gps_lat": 23.8103,
  "gps_lng": 90.4125,
  "phone": "01712345678",
  "email": "user@example.com"
}
```

### 6.2 Subscriber Profile

```json
{
  "subscriber": "user@isp",
  "onu": { ... },
  "telemetry": [
    {
      "sampled_at": "2026-08-31T10:00:00Z",
      "rx_power": -18.5,
      "tx_power": 2.3
    }
  ],
  "mac_history": [
    {
      "mac": "AA:BB:CC:DD:EE:FF",
      "changed_at": "2026-08-01T00:00:00Z"
    }
  ]
}
```

### 6.3 Approval Request

```json
{
  "id": 42,
  "requested_by": 5,
  "submitted_by_name": "Field User",
  "action": "create",
  "entity_type": "tj",
  "entity_id": null,
  "status": "pending",
  "priority": "normal",
  "payload_json": "{...}",
  "previous_data_json": "",
  "photos_json": ["photo1.jpg"],
  "location_json": "{\"lat\": 23.8103, \"lng\": 90.4125}",
  "created_at": "2026-08-31T10:00:00Z"
}
```

---

## 7. Error Handling

### Common Error Codes

| Code | Meaning | Android Action |
|------|---------|---------------|
| 400 | Bad request | Show validation error message |
| 401 | Unauthorized | Redirect to login, clear token |
| 403 | Forbidden | Show "insufficient permissions" message |
| 404 | Not found | Show "record not found" message |
| 413 | Payload too large | Show "photo too large" message |
| 422 | Validation error | Show field-specific errors |
| 500 | Server error | Show "server error, try again" |

### Error Response Format

```json
{
  "detail": "Your role does not permit this action"
}
```

### Network Error Handling

```kotlin
try {
    val response = api.login(username, password)
    if (response.isSuccessful) {
        val token = response.body()?.access_token
        saveToken(token)
    } else {
        when (response.code()) {
            401 -> showLoginError("Invalid credentials")
            500 -> showServerError()
        }
    }
} catch (e: IOException) {
    showNetworkError("No internet connection")
}
```

---

## 8. Offline Support

The Android app should implement offline queue for:

1. **Photo captures** — Store locally until upload is possible
2. **Approval submissions** — Queue locally and sync when online
3. **GPS coordinates** — Cache last known location

### Recommended Architecture

```
Room Database (SQLite)
├── PendingSubmissions
│   ├── entity_type
│   ├── payload_json
│   ├── photos (local paths)
│   ├── gps_lat, gps_lng
│   └── status: queued | synced | failed
└── CachedPhotos
    ├── filename
    └── local_path
```

### Sync Strategy

```
1. App starts → check for queued submissions
2. If online → upload photos → submit to /api/approvals/submit
3. If成功 → mark as synced
4. If失败 → retry with exponential backoff
5. If offline → keep in queue
```

---

## 9. GPS Integration

### Getting GPS Coordinates

```kotlin
val locationManager = getSystemService(LOCATION_SERVICE) as LocationManager

// Request updates
locationManager.requestLocationUpdates(
    LocationManager.GPS_PROVIDER,
    1000L, // min time interval (ms)
    1.0f   // min distance (m)
) { location ->
    val lat = location.latitude
    val lng = location.longitude
    val accuracy = location.accuracy
    
    // Only submit if accuracy < 9 meters
    if (accuracy < 9.0f) {
        // Use this location
    }
}
```

### GPS Accuracy Requirement

- `gps_accuracy` must be **< 9 meters** for the location to be accepted
- The backend stores `gps_accuracy` and validates on update
- If accuracy is > 9m, the field user should wait for better signal

---

## 10. Photo Capture

### Camera Integration

```kotlin
// Create photo file
val photoFile = File(
    cacheDir,
    "${System.currentTimeMillis()}_photo.jpg"
)

// Capture
val uri = FileProvider.getUriForFile(
    context,
    "${packageName}.fileprovider",
    photoFile
)
cameraLauncher.launch(uri)
```

### Upload Photo

```kotlin
suspend fun uploadPhoto(file: File): String {
    val requestFile = file.asRequestBody("image/jpeg".toMediaTypeOrNull())
    val body = MultipartBody.Part.createFormData("file", file.name, requestFile)
    
    val response = api.uploadPhoto(
        authorization = "Bearer $token",
        file = body
    )
    
    return response.body()?.filename ?: throw Exception("Upload failed")
}
```

### Photo Naming Convention

Use timestamp prefix: `{timestamp}_{description}.jpg`  
Example: `1725100000_tj_rampura.jpg`

---

## 11. Permission Checks

Before showing UI elements, check user role:

```kotlin
val token = getToken()
val payload = JWT.decode(token)
val role = payload.getClaim("role").asString()

// Check permissions
val canSubmit = role in listOf("admin", "global_write", "field_team")
val canApprove = role in listOf("admin", "global_write", "noc")
val canWrite = role in listOf("admin", "global_write")
```

---

## 12. API Endpoint Quick Reference

### Authentication
- `POST /api/auth/login` — Login
- `GET /api/auth/me` — Get current user

### Submissions
- `POST /api/approvals/submit` — Submit for approval
- `POST /api/approvals/upload-photo` — Upload photo
- `GET /api/approvals` — List own submissions
- `GET /api/approvals/{id}` — Get submission detail
- `PUT /api/approvals/{id}/resubmit` — Resubmit corrected data

### Read Data
- `GET /api/onus` — List ONUs
- `GET /api/onus/{id}` — Get ONU detail
- `GET /api/subscribers` — List subscribers
- `GET /api/subscribers/{subscriber}` — Subscriber profile
- `GET /api/fiber/tj-boxes` — List TJ boxes
- `GET /api/fiber/cables` — List cables
- `GET /api/fiber/splitters` — List splitters
- `GET /api/tickets` — List assigned tickets
- `GET /api/dashboard` — Dashboard summary
- `GET /api/search?q=` — Global search

### Direct Write (admin/global_write only)
- `PUT /api/onus/{id}` — Update subscriber GPS/address
- `PUT /api/tickets/{id}` — Update ticket status

### Field Photos
- `POST /api/photos/{entity_type}/{entity_id}?photo_type={type}` — Upload field photo (multipart/form-data)
- `GET /api/photos/{entity_type}/{entity_id}` — List photos with completion status
- `GET /api/photos/file/{path}` — Download photo file
- `DELETE /api/photos/{entity_type}/{entity_id}/{photo_type}` — Delete a photo
