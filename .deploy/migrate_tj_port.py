import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE tj_boxes ADD COLUMN IF NOT EXISTS tj_port INTEGER DEFAULT 4"))
    await engine.dispose()
    print("OK")

asyncio.run(main())
