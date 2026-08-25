#!/usr/bin/env python3
"""Test BDCOM OLT CLI commands for finding rejected/unauthorized ONUs."""
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

        cmds = [
            "show epon onu-information",
            "show epon onu-information | include auth",
            "show epon onu-information | include offline",
            "show epon onu-information | include deregistered",
            "show epon onu-information | include inactive",
            "show epon onu-status-count",
            "show gpon onu-information",
            "show gpon onu-information | include offline",
            "show gpon onu-information | include deregistered",
            "show log | include auth-fail",
            "show log | include onu",
            "show running-config interface epon 0/1",
            "show running-config interface gpon 0/1",
        ]
        for cmd in cmds:
            try:
                out = await driver._exec(cmd, timeout=15)
                print(f"=== {cmd} ===")
                print(out[:3000])
                print("---")
            except Exception as e:
                print(f"=== {cmd} === FAILED: {e}")
                print("---")
        driver.close()

asyncio.run(main())
