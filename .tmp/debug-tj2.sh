#!/bin/bash
set -e

echo "=== Docker image built at ==="
docker inspect infra-nexus-backend --format '{{.Created}}'

echo ""
echo "=== Latest approvals ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT id, entity_type, action, status, created_at FROM fiber_approval_requests ORDER BY id DESC LIMIT 5;"

echo ""
echo "=== Field photos TJ ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT * FROM field_photos WHERE entity_type='tj' ORDER BY id;"

echo ""
echo "=== Pending photos ==="
docker exec infra-nexus-backend ls -laR /app/uploads/pending-photos/ 2>/dev/null || echo "(empty)"

echo ""
echo "=== Upload-photo endpoint log (last 20) ==="
docker logs infra-nexus-backend --tail 100 2>&1 | grep -i "upload-photo\|photo\|tj_box\|field photo\|pending" | tail -20 || echo "(none)"

echo ""
echo "=== Any 422 errors ==="
docker logs infra-nexus-backend --tail 200 2>&1 | grep "422\|Unprocessable" | tail -10 || echo "(none)"
