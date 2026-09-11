"""Test MikroTik traffic monitoring via API."""
import asyncio
import sys

from app.database import SessionLocal
from app.models import MikrotikDevice, PppActiveEntry
from app.drivers.mikrotik import MikrotikDriver
from sqlalchemy import select


async def test():
    async with SessionLocal() as db:
        ppp = (await db.execute(
            select(PppActiveEntry).limit(5)
        )).scalars().all()

        if not ppp:
            print("No active PPPoE sessions found")
            return

        for entry in ppp:
            print(f"\nPPPoE Active: subscriber={entry.subscriber}, interface={entry.interface}, device_id={entry.device_id}")

            device = await db.get(MikrotikDevice, entry.device_id)
            if not device:
                print(f"  Device {entry.device_id} not found")
                continue

            print(f"  MikroTik: {device.name} ({device.ip})")

            driver = MikrotikDriver(device)
            try:
                data = await driver.monitor_traffic_once(entry.interface)
                print(f"  monitor_traffic_once result: {data}")
            except Exception as e:
                print(f"  monitor_traffic_once ERROR: {type(e).__name__}: {e}")

            # Also try reading interface stats directly
            try:
                api = driver._connect()
                try:
                    interfaces = list(api("/interface/print", detail=True))
                    pppoe_ifaces = [i for i in interfaces if entry.interface in i.get("name", "")]
                    if pppoe_ifaces:
                        print(f"  Interface stats: {pppoe_ifaces[0]}")
                    else:
                        for iface in interfaces:
                            if iface.get("name", "") == entry.interface:
                                print(f"  Interface stats: {iface}")
                                break
                        else:
                            print(f"  Interface '{entry.interface}' not found in {len(interfaces)} interfaces")
                            for i in interfaces[:5]:
                                print(f"    {i.get('name', '?')} type={i.get('type', '?')}")
                finally:
                    api.close()
            except Exception as e:
                print(f"  Interface read ERROR: {type(e).__name__}: {e}")

            break


if __name__ == "__main__":
    asyncio.run(test())
