"""Debug: find PPPoE client interface for a subscriber."""
import asyncio
from app.database import SessionLocal
from app.models import MikrotikDevice
from app.drivers.mikrotik import MikrotikDriver
from sqlalchemy import select


async def test():
    async with SessionLocal() as db:
        device = (await db.execute(select(MikrotikDevice).limit(1))).scalars().first()
        driver = MikrotikDriver(device)
        api = driver._connect()
        try:
            # Check pppoe-client interfaces
            clients = list(api("/interface/pppoe-client/print"))
            print(f"/interface/pppoe-client/print returned {len(clients)} entries")
            if clients:
                for k, v in clients[0].items():
                    print(f"  {k} = {v}")

            # Check pppoe-server interfaces
            servers = list(api("/interface/pppoe-server/print"))
            print(f"\n/interface/pppoe-server/print returned {len(servers)} entries")
            if servers:
                for k, v in servers[0].items():
                    print(f"  {k} = {v}")

            # Try /interface print with pppoe type
            ifaces = list(api("/interface/print"))
            pppoe_ifaces = [i for i in ifaces if "pppoe" in i.get("type", "").lower() or "pppoe" in i.get("name", "").lower()]
            print(f"\nInterfaces with 'pppoe': {len(pppoe_ifaces)}")
            for i in pppoe_ifaces[:5]:
                print(f"  name={i.get('name')} type={i.get('type')}")

            # Try monitor-traffic on a known interface
            print("\n--- Testing monitor-traffic ---")
            for iface_name in ["pppoe-out1", "pppoe-server1"]:
                try:
                    result = list(api(f"/interface/monitor-traffic once interface={iface_name}"))
                    if result:
                        print(f"  {iface_name}: {result[0]}")
                    else:
                        print(f"  {iface_name}: empty result")
                except Exception as e:
                    print(f"  {iface_name}: ERROR {e}")

        finally:
            api.close()


if __name__ == "__main__":
    asyncio.run(test())
