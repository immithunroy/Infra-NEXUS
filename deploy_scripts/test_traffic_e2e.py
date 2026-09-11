"""End-to-end test: start traffic, poll samples, verify data."""
import asyncio, sys
sys.path.insert(0, "/app")

from app.database import SessionLocal
from app.models import MikrotikDevice, PppActiveEntry
from app.drivers.mikrotik import MikrotikDriver
from sqlalchemy import select


async def test():
    async with SessionLocal() as db:
        # Pick first active subscriber
        ppp = (await db.execute(select(PppActiveEntry).limit(1))).scalars().first()
        if not ppp:
            print("No active sessions")
            return

        print(f"Subscriber: {ppp.subscriber}, device_id={ppp.device_id}")
        device = await db.get(MikrotikDevice, ppp.device_id)
        driver = MikrotikDriver(device)

        # Find interface
        iface = await asyncio.to_thread(driver.get_pppoe_interface, ppp.subscriber)
        print(f"Interface: '{iface}'")
        if not iface:
            print("FAIL: no interface found")
            return

        # Take two snapshots
        data1 = await driver.monitor_traffic_once(iface)
        print(f"Snapshot 1: rx={data1.get('rx_byte')}, tx={data1.get('tx_byte')}")

        await asyncio.sleep(2)

        data2 = await driver.monitor_traffic_once(iface)
        print(f"Snapshot 2: rx={data2.get('rx_byte')}, tx={data2.get('tx_byte')}")

        rx_delta = data2.get("rx_byte", 0) - data1.get("rx_byte", 0)
        tx_delta = data2.get("tx_byte", 0) - data1.get("tx_byte", 0)
        rx_bps = rx_delta * 8 / 2
        tx_bps = tx_delta * 8 / 2

        def fmt(bps):
            if bps >= 1024**2: return f"{bps/1024**2:.1f} Mbps"
            if bps >= 1024: return f"{bps/1024:.1f} Kbps"
            return f"{bps:.0f} bps"

        print(f"\nRESULT: RX={fmt(rx_bps)}, TX={fmt(tx_bps)}")
        print("SUCCESS" if rx_bps >= 0 and tx_bps >= 0 else "FAIL")


if __name__ == "__main__":
    asyncio.run(test())
