"""Test MikroTik traffic monitoring - fixed version."""
import asyncio
import sys

from app.database import SessionLocal
from app.models import MikrotikDevice, PppActiveEntry
from app.drivers.mikrotik import MikrotikDriver
from sqlalchemy import select


async def test():
    async with SessionLocal() as db:
        ppp = (await db.execute(
            select(PppActiveEntry).limit(3)
        )).scalars().all()

        if not ppp:
            print("No active PPPoE sessions found")
            return

        for entry in ppp:
            print(f"\nSubscriber: {entry.subscriber}, DB interface: '{entry.interface}', device_id={entry.device_id}")

            device = await db.get(MikrotikDevice, entry.device_id)
            if not device:
                print(f"  Device {entry.device_id} not found")
                continue

            print(f"  MikroTik: {device.name} ({device.ip})")
            driver = MikrotikDriver(device)

            # Step 1: Find PPPoE interface name
            iface = entry.interface
            if not iface:
                print("  Interface empty in DB, looking up live...")
                try:
                    iface = await asyncio.to_thread(driver.get_pppoe_interface, entry.subscriber)
                    print(f"  Found interface: '{iface}'")
                except Exception as e:
                    print(f"  get_pppoe_interface ERROR: {type(e).__name__}: {e}")
                    continue

            if not iface:
                print("  No interface found, skipping")
                continue

            # Step 2: Monitor traffic
            try:
                data = await driver.monitor_traffic_once(iface)
                print(f"  Traffic data: {data}")
            except Exception as e:
                print(f"  monitor_traffic_once ERROR: {type(e).__name__}: {e}")


if __name__ == "__main__":
    asyncio.run(test())
