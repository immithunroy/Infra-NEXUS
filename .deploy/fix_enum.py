import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
import sqlalchemy

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        await conn.execute(sqlalchemy.text("ALTER TYPE accessmethod ADD VALUE IF NOT EXISTS 'both'"))
        await conn.execute(sqlalchemy.text("UPDATE olt_devices SET access_method = 'telnet' WHERE access_method = 'snmp'"))
        print("DONE: added 'both', converted old 'snmp' to 'telnet'")
    await engine.dispose()

asyncio.run(main())
