#!/bin/bash
set -e
echo "=== Remaining field_photos ==="
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT id, entity_type, entity_id, photo_type, storage_key FROM field_photos ORDER BY id;"

echo ""
echo "=== Files on disk ==="
docker exec infra-nexus-backend find /app/uploads/field-photos/ -type f -ls 2>/dev/null || echo "(none)"
