#!/bin/bash
TOKEN=$(curl -s -X POST https://nexus.qbinternet.com/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')

echo "=== Scheduler Status ==="
curl -s "https://nexus.qbinternet.com/api/scheduler/status" -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for j in data:
    print(f'{j[\"name\"]:20s} status={j[\"status\"]:10s} last_run={str(j[\"last_run\"] or \"Never\"):s}')
"

echo ""
echo "=== DB State ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT job_id, last_run, status FROM scheduler_job_state ORDER BY job_id;" 2>/dev/null
