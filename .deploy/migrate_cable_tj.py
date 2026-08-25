import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE cables ADD COLUMN IF NOT EXISTS src_tj_id INTEGER REFERENCES tj_boxes(id) ON DELETE SET NULL"))
        await conn.execute(text("ALTER TABLE cables ADD COLUMN IF NOT EXISTS dst_tj_id INTEGER REFERENCES tj_boxes(id) ON DELETE SET NULL"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cables_src_tj_id ON cables(src_tj_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cables_dst_tj_id ON cables(dst_tj_id)"))
    await engine.dispose()
    print("OK")

asyncio.run(main())
