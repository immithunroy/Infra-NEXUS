#!/bin/bash
# Test subscriber photos fix

TOKEN=$(curl -s -X POST https://nexus.qbinternet.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "=== Check existing subscriber photos for ONU #116 (abeldere16) ==="
curl -s "https://nexus.qbinternet.com/api/photos/subscriber/abeldere16" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null || echo "(empty or error)"

echo ""
echo "=== Check field-photos directory ==="
ls -la /app/uploads/field-photos/subscriber/ 2>/dev/null || echo "No subscriber dirs"

echo ""
echo "=== Check approval-photos directory (raw uploads) ==="
ls -la /app/uploads/approval-photos/ 2>/dev/null | head -20 || echo "No approval photos"

echo ""
echo "=== List all pending user approvals ==="
curl -s "https://nexus.qbinternet.com/api/approvals/?status=pending&entity_type=user&limit=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', data) if isinstance(data, dict) else data
if isinstance(items, list):
    for r in items:
        print(f'  #{r.get(\"id\")} | {r.get(\"entity_type\")} | sub={r.get(\"subscriber_name\",\"\")} | payload={r.get(\"payload_json\",\"\")[:100]}')
else:
    print('  (no results)')
" 2>/dev/null

echo ""
echo "=== List all approved user approvals ==="
curl -s "https://nexus.qbinternet.com/api/approvals/?status=approved&entity_type=user&limit=5" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
items = data.get('items', data) if isinstance(data, dict) else data
if isinstance(items, list):
    for r in items:
        photos = r.get('photos_json', '[]')
        print(f'  #{r.get(\"id\")} | {r.get(\"entity_type\")} | sub={r.get(\"subscriber_name\",\"\")} | photos={photos[:80]}')
else:
    print('  (no results)')
" 2>/dev/null
