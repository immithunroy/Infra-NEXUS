#!/bin/bash
set -e

echo "=== Field photos DB ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT id, entity_type, entity_id, photo_type, storage_key, file_size, original_filename FROM field_photos ORDER BY id;"

echo ""
echo "=== Files on disk (inside backend container) ==="
docker exec infra-nexus-backend find /app/uploads/ -type f -ls 2>/dev/null || echo "(none)"

echo ""
echo "=== Backend logs (photo related) ==="
docker logs infra-nexus-backend --tail 30 2>&1 | grep -i "photo\|field\|migrat\|warn\|error" || echo "(none)"

echo ""
echo "=== Test: list subscriber photos API ==="
docker exec infra-nexus-backend python -c "
import urllib.request, json
req = urllib.request.Request('http://127.0.0.1:8080/api/auth/login',
    data=json.dumps({'username':'admin','password':'admin123'}).encode(),
    headers={'Content-Type':'application/json'})
token = json.loads(urllib.request.urlopen(req).read())['access_token']

req2 = urllib.request.Request('http://127.0.0.1:8080/api/photos/subscriber/17051602',
    headers={'Authorization': 'Bearer ' + token})
result = json.loads(urllib.request.urlopen(req2).read())
print(json.dumps(result, indent=2))
"

echo ""
echo "=== Test: try to serve a photo file ==="
docker exec infra-nexus-backend python -c "
import urllib.request, json
req = urllib.request.Request('http://127.0.0.1:8080/api/auth/login',
    data=json.dumps({'username':'admin','password':'admin123'}).encode(),
    headers={'Content-Type':'application/json'})
token = json.loads(urllib.request.urlopen(req).read())['access_token']

try:
    req2 = urllib.request.Request('http://127.0.0.1:8080/api/photos/file/subscriber/17051602/overall.jpg',
        headers={'Authorization': 'Bearer ' + token})
    resp = urllib.request.urlopen(req2)
    print('Status:', resp.status, 'Content-Type:', resp.headers.get('Content-Type'), 'Size:', len(resp.read()))
except Exception as e:
    print('Error:', e)
"

echo ""
echo "=== Onu #11 and #116 ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT id, subscriber, name FROM onus WHERE id IN (11, 116) ORDER BY id;"

echo ""
echo "=== Approvals #7 payload ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -t -c "SELECT payload_json FROM fiber_approval_requests WHERE id=7;"

echo ""
echo "=== Check uploads volume mount ==="
docker inspect infra-nexus-backend --format '{{json .Mounts}}' 2>/dev/null | python3 -m json.tool || echo "(no mounts)"
