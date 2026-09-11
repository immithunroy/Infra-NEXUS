#!/bin/bash
echo "=== 1. Containers ==="
docker ps --filter 'name=infra-nexus' --format '{{.Names}} {{.Status}}'

echo ""
echo "=== 2. Scheduler status ==="
TOKEN=$(curl -s -X POST https://nexus.qbinternet.com/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s "https://nexus.qbinternet.com/api/scheduler/status" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null

echo ""
echo "=== 3. scheduler_job_state table ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT * FROM scheduler_job_state;" 2>/dev/null

echo ""
echo "=== 4. Backend logs (scheduler) ==="
docker logs infra-nexus-backend --tail 30 2>&1 | grep -iE 'scheduler|scan_olt|telemetry|write_all|olt_write|NameError|error|fail|persist|load_job' | tail -15

echo ""
echo "=== 5. Disk ==="
df -h /
