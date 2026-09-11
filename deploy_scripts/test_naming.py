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

        # Check what pppoe-in interfaces look like
        ifaces = list(api("/interface/print"))
        pppoe = [i for i in ifaces if i.get("type") == "pppoe-in"]
        print(f"pppoe-in type: {len(pppoe)}")
        print(f"Sample names: {[i.get('name') for i in pppoe[:5]]}")

        # Also check /ppp/active for 26070201
        active = list(api("/ppp/active/print"))
        a26 = [a for a in active if a.get("name") == "26070201"]
        print(f"\nppp/active for 26070201: {len(a26)}")
        if a26:
            print(f"  keys: {list(a26[0].keys())}")
            print(f"  values: {a26[0]}")

        # Check if interface field is present for ANY active session
        with_iface = [a for a in active if a.get("interface")]
        print(f"\nppp/active with interface field: {len(with_iface)} of {len(active)}")
        if with_iface:
            print(f"  Sample: {with_iface[0]}")

        api.close()

asyncio.run(test())
