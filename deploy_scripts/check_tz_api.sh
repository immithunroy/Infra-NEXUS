#!/bin/bash
TOKEN=$(docker exec infra-nexus-backend curl -s http://127.0.0.1:8080/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
echo "=== Timezone options ==="
docker exec infra-nexus-backend curl -s http://127.0.0.1:8080/api/settings/timezone/options -H "Authorization: Bearer $TOKEN"
echo ""
echo "=== Timezone setting ==="
docker exec infra-nexus-backend curl -s http://127.0.0.1:8080/api/settings/timezone -H "Authorization: Bearer $TOKEN"
