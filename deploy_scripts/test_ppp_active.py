"""Debug: see what /ppp/active/print returns from MikroTik."""
import asyncio
from app.database import SessionLocal
from app.models import MikrotikDevice
from app.drivers.mikrotik import MikrotikDriver
from sqlalchemy import select


async def test():
    async with SessionLocal() as db:
        device = (await db.execute(select(MikrotikDevice).limit(1))).scalars().first()
        if not device:
            print("No MikroTik devices")
            return

        print(f"MikroTik: {device.name} ({device.ip})")
        driver = MikrotikDriver(device)
        api = driver._connect()
        try:
            active = list(api("/ppp/active/print"))
            print(f"\n/ppp/active/print returned {len(active)} entries:")
            for i, entry in enumerate(active[:3]):
                print(f"\n  Entry {i}:")
                for k, v in entry.items():
                    print(f"    {k} = {v}")
        finally:
            api.close()


if __name__ == "__main__":
    asyncio.run(test())
