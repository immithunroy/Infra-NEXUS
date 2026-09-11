"""Debug: test interface stats on RouterOS v7."""
import asyncio, time
from app.database import SessionLocal
from app.models import MikrotikDevice
from sqlalchemy import select


async def test():
    async with SessionLocal() as db:
        device = (await db.execute(select(MikrotikDevice).limit(1))).scalars().first()
        from librouteros import connect
        api = connect(host=device.ip, username=device.username, password=device.password, port=device.api_port, ssl=device.use_ssl, timeout=15)
        try:
            # Find a pppoe-in interface with running=True
            ifaces = list(api("/interface/print"))
            pppoe = [i for i in ifaces if i.get("type") == "pppoe-in" and i.get("running")]
            print(f"Running pppoe-in: {len(pppoe)}")
            if not pppoe:
                pppoe = [i for i in ifaces if i.get("type") == "pppoe-in"][:3]
                print(f"Fallback to first 3 pppoe-in: {len(pppoe)}")
            if not pppoe:
                return

            target = pppoe[0]
            iface_name = target.get("name", "")
            print(f"Target: {iface_name}")

            # Print all keys to understand structure
            print(f"  Keys: {list(target.keys())}")
            print(f"  rx-byte: {target.get('rx-byte')}")
            print(f"  tx-byte: {target.get('tx-byte')}")

            # Take two snapshots 2 seconds apart
            print("\nTaking two snapshots 2s apart...")
            rx1 = int(target.get("rx-byte", 0))
            tx1 = int(target.get("tx-byte", 0))
            t1 = time.time()

            await asyncio.sleep(2)

            ifaces2 = list(api("/interface/print"))
            target2 = next((i for i in ifaces2 if i.get("name") == iface_name), None)
            if target2:
                rx2 = int(target2.get("rx-byte", 0))
                tx2 = int(target2.get("tx-byte", 0))
                t2 = time.time()
                dt = t2 - t1
                rx_bps = (rx2 - rx1) * 8 / dt if rx2 >= rx1 else 0
                tx_bps = (tx2 - tx1) * 8 / dt if tx2 >= tx1 else 0
                print(f"  rx_delta: {rx2 - rx1} bytes, tx_delta: {tx2 - tx1} bytes")
                print(f"  rx_rate: {rx_bps:.0f} bps = {rx_bps/1024/1024:.2f} Mbps")
                print(f"  tx_rate: {tx_bps:.0f} bps = {tx_bps/1024/1024:.2f} Mbps")
            else:
                print("  Interface disappeared between snapshots")

        finally:
            api.close()


if __name__ == "__main__":
    asyncio.run(test())
