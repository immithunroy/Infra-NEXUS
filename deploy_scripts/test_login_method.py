import asyncio
from librouteros import connect
from app.database import SessionLocal
from app.models import MikrotikDevice
from sqlalchemy import select

async def test():
    async with SessionLocal() as db:
        device = (await db.execute(select(MikrotikDevice).limit(1))).scalars().first()
        print(f"Connecting to {device.ip} as {device.username}, routeros_version={device.routeros_version}")

        # Method 1: with login_method="routeros" (what MikrotikDriver does)
        try:
            api = connect(host=device.ip, username=device.username, password=device.password,
                          port=device.api_port, ssl=device.use_ssl, timeout=15,
                          login_method="routeros")
            ifaces = list(api("/interface/print"))
            pppoe = [i for i in ifaces if "pppoe" in i.get("name", "").lower()]
            print(f"\nlogin_method='routeros': {len(ifaces)} total, {len(pppoe)} pppoe-in")
            api.close()
        except Exception as e:
            print(f"login_method='routeros' failed: {e}")

        # Method 2: without login_method
        try:
            api = connect(host=device.ip, username=device.username, password=device.password,
                          port=device.api_port, ssl=device.use_ssl, timeout=15)
            ifaces = list(api("/interface/print"))
            pppoe = [i for i in ifaces if "pppoe" in i.get("name", "").lower()]
            print(f"no login_method: {len(ifaces)} total, {len(pppoe)} pppoe-in")
            api.close()
        except Exception as e:
            print(f"no login_method failed: {e}")

asyncio.run(test())
