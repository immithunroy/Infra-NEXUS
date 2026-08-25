#!/usr/bin/env python3
"""Debug ZIA-EPON-1 rejected ONU detection."""
import sys
sys.path.insert(0, "/opt/olt-commander/backend")
from app.database import SessionLocal
from app.models import OLTDevice
from app.drivers.bdcom import BdcomCliDriver
import asyncio

async def main():
    async with SessionLocal() as db:
        from sqlalchemy import select
        res = await db.execute(select(OLTDevice).where(OLTDevice.id == 4))
        device = res.scalar_one()
        print(f"OLT: {device.name} IP={device.ip} pon_type={device.pon_type} access={device.access_method}")
        driver = BdcomCliDriver(device)
        await driver.connect()

        pon_type = device.pon_type.lower()
        # Try the command
        try:
            out = await driver._exec(f"show {pon_type} onu-information", timeout=60)
            lines = out.splitlines()
            print(f"Output lines: {len(lines)}")
            # Show first 20 and last 20
            for l in lines[:20]:
                print(f"  {l}")
            if len(lines) > 40:
                print(f"  ... ({len(lines) - 40} lines omitted) ...")
            for l in lines[-20:]:
                print(f"  {l}")
        except Exception as e:
            print(f"ERROR: {e}")

        # Also try parsing
        rejected = driver._parse_onu_information(out, pon_type) if 'out' in dir() else []
        print(f"\nRejected ONUs found: {len(rejected)}")
        for r in rejected:
            print(f"  PON={r['pon_port']} ONU={r['onu_id']} SN={r['serial']} reason={r['reason']}")

        driver.close()

asyncio.run(main())
