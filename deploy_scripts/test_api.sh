#!/bin/bash
TOKEN=$(curl -s http://localhost:8080/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "=== Subscribers list ==="
curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:8080/api/subscribers?limit=3' | python3 -m json.tool | head -40
echo ""
echo "=== Test profile of first subscriber ==="
FIRST_SUB=$(curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:8080/api/subscribers?limit=1' | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["subscriber"] if d else "")')
if [ -n "$FIRST_SUB" ]; then
  ENCODED=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$FIRST_SUB'))")
  curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/subscribers/$ENCODED" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(f"OK: subscriber={d.get(\"subscriber\")}, onu_id={d.get(\"onu_id\")}")' 2>&1 || echo "FAILED to load profile"
else
  echo "No subscribers found"
fi
echo ""
echo "=== Test ONUs list ==="
curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:8080/api/onus?limit=2' | python3 -m json.tool | head -20
