import asyncio, sys
sys.path.insert(0, "/opt/olt-commander/backend")
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.drivers.bdcom import BdcomCliDriver

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        r = await conn.execute(text("SELECT id, name, ip, username, password, port, access_method, pon_type FROM olt_devices WHERE id = 2"))
        row = dict(r.mappings().first())
    row["access_method"] = type("M", (), {"value": row["access_method"]})()
    from app.models import OLTDevice
    olt = OLTDevice(**row)
    driver = BdcomCliDriver(olt)
    try:
        result = await driver.delete_onu(pon_port="EPON0/1", onu_id=45)
        print(f"DELETE: {result}")
    except Exception as e:
        print(f"ERROR: {e}")
    finally:
        driver.close()
    await engine.dispose()

asyncio.run(main())
