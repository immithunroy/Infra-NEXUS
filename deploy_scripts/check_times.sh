#!/bin/bash
echo "=== Host time ==="
date
timedatectl 2>/dev/null | head -5

echo ""
echo "=== Backend container ==="
docker exec infra-nexus-backend date
docker exec infra-nexus-backend python -c "
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
print(f'UTC now:  {datetime.now(timezone.utc).strftime(\"%Y-%m-%d %H:%M:%S %Z\")}')
print(f'BDT now:  {datetime.now(ZoneInfo(\"Asia/Dhaka\")).strftime(\"%Y-%m-%d %H:%M:%S %Z\")}')
"

echo ""
echo "=== DB container ==="
docker exec infra-nexus-db date
docker exec infra-nexus-db psql -U olt -d infra_nexus -c "SELECT NOW() as db_utc, NOW() AT TIME ZONE 'Asia/Dhaka' as db_bdt;"

echo ""
echo "=== Frontend container ==="
docker exec infra-nexus-frontend date
