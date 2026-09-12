#!/bin/bash
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT key, value FROM settings WHERE key='timezone';"
echo "---"
docker exec infra-nexus-backend curl -s http://127.0.0.1:8080/api/settings/timezone/options -H "Authorization: Bearer $(docker exec infra-nexus-backend curl -s http://127.0.0.1:8080/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')" 2>/dev/null
