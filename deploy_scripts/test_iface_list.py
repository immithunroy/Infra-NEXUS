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
            ifaces = list(api("/interface/print"))
            pppoe_in = [i for i in ifaces if "pppoe" in i.get("name", "").lower()]
            print(f"Total interfaces: {len(ifaces)}")
            print(f"PPPoE interfaces: {len(pppoe_in)}")
            for i in pppoe_in[:5]:
                print(f"  {i.get('name', '')} type={i.get('type', '')} running={i.get('running', '')}")
            # Also search specifically for 26070201
            target = "<pppoe-26070201>"
            found = [i for i in ifaces if i.get("name", "") == target]
            print(f"\nExact match for '{target}': {len(found)}")
            # Search partial
            partial = [i for i in ifaces if "26070201" in i.get("name", "")]
            print(f"Partial match for '26070201': {len(partial)}")
            for i in partial:
                print(f"  {i.get('name', '')}")
        finally:
            api.close()

asyncio.run(test())
