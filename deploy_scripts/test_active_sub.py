import asyncio
from librouteros import connect
from app.database import SessionLocal
from app.models import MikrotikDevice
from sqlalchemy import select

async def test():
    async with SessionLocal() as db:
        device = (await db.execute(
            select(MikrotikDevice).where(MikrotikDevice.ip == '103.177.54.49')
        )).scalars().first()

        api = connect(host=device.ip, username=device.username, password=device.password,
                      port=device.api_port, ssl=device.use_ssl, timeout=15)

        # Get first active subscriber
        active = list(api("/ppp/active/print"))
        if active:
            sub = active[0].get("name", "")
            print(f"Testing with subscriber: {sub}")
            # Check interface exists
            target = f"<pppoe-{sub}>"
            ifaces = list(api("/interface/print"))
            found = [i for i in ifaces if i.get("name") == target]
            print(f"Interface '{target}': {'found' if found else 'NOT found'}")

            # Try byte counters
            if found:
                iface = found[0]
                print(f"  rx-byte={iface.get('rx-byte', 0)}, tx-byte={iface.get('tx-byte', 0)}")

        api.close()

asyncio.run(test())
