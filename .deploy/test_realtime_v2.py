#!/usr/bin/env python3
"""Test real-time alarm-based rejected ONU discovery."""
import sys
sys.path.insert(0, "/opt/olt-commander/backend")
from app.database import SessionLocal
from app.models import OLTDevice
from app.drivers.bdcom import BdcomCliDriver
import asyncio

async def main():
    async with SessionLocal() as db:
        from sqlalchemy import select
        res = await db.execute(select(OLTDevice).where(OLTDevice.id == 1))
        device = res.scalar_one()
        driver = BdcomCliDriver(device)
        rejected = await driver.get_rejected_onus()
        print(f"Real-time rejected ONUs: {len(rejected)}")
        for r in rejected[:20]:
            print(f"  [{r.get('timestamp','')}] PON={r['pon_port']} ONU={r['onu_id']} SN={r['serial']} reason={r['reason']}")
            print(f"    {r['raw_line'][:120]}")
        driver.close()

asyncio.run(main())
