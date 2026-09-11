import asyncio
from app.database import SessionLocal
from app.models import PppActiveEntry, MikrotikDevice
from app.drivers.mikrotik import MikrotikDriver
from sqlalchemy import select

async def test():
    async with SessionLocal() as db:
        ppp = (await db.execute(
            select(PppActiveEntry).where(PppActiveEntry.subscriber == '26070201')
        )).scalars().first()
        print(f"ppp.device_id={ppp.device_id}, ppp.interface='{ppp.interface}'")

        device = await db.get(MikrotikDevice, ppp.device_id)
        print(f"device: id={device.id}, name={device.name}, ip={device.username}@{device.ip}:{device.api_port} ssl={device.use_ssl}")
        print(f"device routeros_version={device.routeros_version}")

        driver = MikrotikDriver(device)
        try:
            iface = await asyncio.to_thread(driver.get_pppoe_interface, '26070201')
            print(f"get_pppoe_interface result: '{iface}'")
        except Exception as e:
            import traceback
            traceback.print_exc()

asyncio.run(test())
