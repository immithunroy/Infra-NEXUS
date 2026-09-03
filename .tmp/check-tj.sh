#!/bin/bash
set -e

echo "=== Latest TJ approvals ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT id, entity_type, action, status, submitted_by_name, created_at, payload_json FROM fiber_approval_requests WHERE entity_type='tj' ORDER BY id DESC LIMIT 3;"

echo ""
echo "=== Pending photos dir ==="
docker exec infra-nexus-backend ls -laR /app/uploads/pending-photos/ 2>/dev/null || echo "(empty)"

echo ""
echo "=== Approval photos dir (latest) ==="
docker exec infra-nexus-backend ls -lt /app/uploads/approval-photos/ 2>/dev/null | head -10 || echo "(empty)"

echo ""
echo "=== Field photos DB ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT id, entity_type, entity_id, photo_type, storage_key, file_size FROM field_photos WHERE entity_type='tj' ORDER BY id DESC LIMIT 10;"
