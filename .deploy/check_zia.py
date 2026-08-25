import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        r = await conn.execute(text("SELECT id, name, ip, username, password, port, access_method, vendor FROM olt_devices WHERE id = 4"))
        row = r.mappings().first()
        print(dict(row))
    await engine.dispose()

asyncio.run(main())
