#!/usr/bin/env python3
"""Dump full show alarm output."""
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
        await driver.connect()
        out = await driver._exec("show alarm", timeout=30)
        lines = out.splitlines()
        print(f"Total alarm lines: {len(lines)}")
        for l in lines:
            print(l)
        driver.close()

asyncio.run(main())
