import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        result = await conn.execute(
            text("UPDATE onus SET down_reason = '' WHERE state = 'active' AND down_reason != ''")
        )
        print(f"Cleared down_reason for {result.rowcount} active ONUs")
    await engine.dispose()

asyncio.run(main())
