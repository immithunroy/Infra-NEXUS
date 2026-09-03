#!/bin/bash
set -e

echo "=== Backend logs (photo/approval related, last 50) ==="
docker logs infra-nexus-backend --tail 50 2>&1 | grep -i "photo\|upload\|field\|pending\|tj_box\|migrat\|warn\|error" || echo "(none)"

echo ""
echo "=== All backend logs since 11:40 ==="
docker logs infra-nexus-backend --since "2026-09-01T11:40:00" 2>&1 | grep -i "photo\|upload\|approval" || echo "(none)"
