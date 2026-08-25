import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        result = await conn.execute(
            text("UPDATE scan_logs SET status = 'failed', message = 'Stale running entry cleaned', finished_at = NOW() WHERE status = 'running'")
        )
        print(f"Fixed {result.rowcount} stale running logs")
    await engine.dispose()

asyncio.run(main())
