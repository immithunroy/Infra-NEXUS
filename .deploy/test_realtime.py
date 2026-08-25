#!/usr/bin/env python3
"""Test BDCOM real-time rejected ONU commands."""
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
            "show epon authentication-failure",
            "show epon onu-authen-failure",
            "show log",
            "show log | include EPON-ONUAUTHEN",
            "show log | include AUTHEN",
            "show log | include fail",
            "show alarm",
            "show alarm active",
            "show epon pending-onu",
            "show epon onu-pending",
            "show epon unauthenticated",
            "show epon auth-fail",
            "show gpon auth-fail",
            "show gpon pending-onu",
        ]
        for cmd in cmds:
            try:
                out = await driver._exec(cmd, timeout=15)
                lines = out.strip().splitlines()
                print(f"=== {cmd} === ({len(lines)} lines)")
                # Print first 15 lines
                for l in lines[:15]:
                    print(f"  {l}")
                if len(lines) > 15:
                    print(f"  ... ({len(lines) - 15} more lines)")
                print("---")
            except Exception as e:
                print(f"=== {cmd} === FAILED: {e}")
                print("---")
        driver.close()

asyncio.run(main())
