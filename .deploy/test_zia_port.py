import asyncio
import sys
sys.path.insert(0, "/opt/olt-commander/backend")

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.drivers.bdcom import BdcomCliDriver

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        r = await conn.execute(text("SELECT id, name, ip, username, password, port, access_method FROM olt_devices WHERE id = 5"))
        row = dict(r.mappings().first())

    row["access_method"] = type("M", (), {"value": row["access_method"]})()

    from app.models import OLTDevice
    olt = OLTDevice(**row)

    driver = BdcomCliDriver(olt)
    try:
        await driver.connect()
        await driver._exec("enable", timeout=10)
        out = await driver._exec("show running-config interface gpon 0/2:5", timeout=10)
        print(out)
    except Exception as e:
        print(f"ERROR: {e}")
    finally:
        driver.close()
    await engine.dispose()

asyncio.run(main())
