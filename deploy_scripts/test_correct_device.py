import asyncio
from librouteros import connect
from app.database import SessionLocal
from app.models import MikrotikDevice
from sqlalchemy import select

async def test():
    async with SessionLocal() as db:
        devices = (await db.execute(select(MikrotikDevice))).scalars().all()
        for d in devices:
            print(f"Device id={d.id}: {d.name} @ {d.ip}:{d.api_port} ssl={d.use_ssl} v={d.routeros_version}")

        device = (await db.execute(select(MikrotikDevice).where(MikrotikDevice.ip == '103.177.54.49'))).scalars().first()
        if not device:
            print("QB-Access not found!")
            return

        print(f"\nConnecting to {device.ip} ({device.name})")
        api = connect(host=device.ip, username=device.username, password=device.password,
                      port=device.api_port, ssl=device.use_ssl, timeout=15)
        ifaces = list(api("/interface/print"))
        pppoe = [i for i in ifaces if "pppoe" in i.get("name", "").lower()]
        print(f"Total: {len(ifaces)}, PPPoE-in: {len(pppoe)}")
        if pppoe:
            print(f"Sample: {pppoe[0].get('name', '')}")
        api.close()

asyncio.run(test())
