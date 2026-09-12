#!/bin/bash
# Login
TOKEN=$(curl -s http://127.0.0.1:8050/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
echo "Token: ${TOKEN:0:20}..."
echo ""
echo "=== Timezone options ==="
curl -s http://127.0.0.1:8050/api/settings/timezone/options -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
echo ""
echo "=== Timezone setting ==="
curl -s http://127.0.0.1:8050/api/settings/timezone -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
