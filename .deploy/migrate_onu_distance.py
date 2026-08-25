import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE onus ADD COLUMN IF NOT EXISTS distance DOUBLE PRECISION"))
    await engine.dispose()
    print("OK")

asyncio.run(main())
