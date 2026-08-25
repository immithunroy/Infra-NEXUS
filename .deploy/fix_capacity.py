import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
import sqlalchemy

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        await conn.execute(sqlalchemy.text(
            "UPDATE olt_devices SET port_capacity = CASE WHEN pon_type = 'gpon' THEN 128 ELSE 64 END"
        ))
        result = await conn.execute(sqlalchemy.text("SELECT name, pon_type, port_capacity FROM olt_devices"))
        for row in result:
            print(f"{row[0]}: pon_type={row[1]}, capacity={row[2]}")
    await engine.dispose()

asyncio.run(main())
