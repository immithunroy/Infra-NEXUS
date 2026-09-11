import asyncio
from librouteros import connect
from app.database import SessionLocal
from app.models import MikrotikDevice, PppActiveEntry
from app.drivers.mikrotik import MikrotikDriver
from sqlalchemy import select

async def test():
    async with SessionLocal() as db:
        ppp = (await db.execute(
            select(PppActiveEntry).where(PppActiveEntry.subscriber == '26070201')
        )).scalars().first()
        print(f"Subscriber 26070201 -> device_id={ppp.device_id}")

        device = await db.get(MikrotikDevice, ppp.device_id)
        print(f"Device: {device.name} @ {device.ip}:{device.api_port}")

        driver = MikrotikDriver(device)
        iface = await asyncio.to_thread(driver.get_pppoe_interface, '26070201')
        print(f"get_pppoe_interface: '{iface}'")

        # Also test direct connection
        api = connect(host=device.ip, username=device.username, password=device.password,
                      port=device.api_port, ssl=device.use_ssl, timeout=15)
        ifaces = list(api("/interface/print"))
        pppoe = [i for i in ifaces if "pppoe" in i.get("name", "").lower()]
        print(f"Direct: {len(ifaces)} total, {len(pppoe)} pppoe-in")
        match = [i for i in ifaces if "26070201" in i.get("name", "")]
        print(f"Match '26070201': {len(match)} -> {[i.get('name') for i in match]}")
        api.close()

asyncio.run(test())
