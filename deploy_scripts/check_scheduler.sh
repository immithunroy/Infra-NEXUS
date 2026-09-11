#!/bin/bash
echo "=== 1. Scheduler status API ==="
TOKEN=$(curl -s -X POST https://nexus.qbinternet.com/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
curl -s "https://nexus.qbinternet.com/api/scheduler/status" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool 2>/dev/null

echo ""
echo "=== 2. Backend logs (last 50 lines, grep for scheduler/OLT) ==="
docker logs infra-nexus-backend --tail 200 2>&1 | grep -iE 'scheduler|scan_olt|telemetry|write_all|olt_write|NameError|error|fail' | tail -30

echo ""
echo "=== 3. Check if OLT devices exist ==="
docker exec infra-nexus-backend python -c "
import asyncio
from app.database import SessionLocal
from app.models import OLTDevice
from sqlalchemy import select
async def t():
    async with SessionLocal() as db:
        olts = (await db.execute(select(OLTDevice))).scalars().all()
        print(f'OLT devices: {len(olts)}')
        for o in olts:
            print(f'  id={o.id} name={o.name} enabled={o.enabled}')
asyncio.run(t())
" 2>&1

echo ""
echo "=== 4. Check settings intervals ==="
docker exec infra-nexus-backend python -c "
import asyncio
from app.database import SessionLocal
from app.models import Setting
from sqlalchemy import select
async def t():
    async with SessionLocal() as db:
        settings = (await db.execute(select(Setting))).scalars().all()
        for s in settings:
            if 'interval' in s.key or 'scan' in s.key or 'telemetry' in s.key or 'write' in s.key or 'olt' in s.key:
                print(f'{s.key} = {s.value}')
asyncio.run(t())
" 2>&1
