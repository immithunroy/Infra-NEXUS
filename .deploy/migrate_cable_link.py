import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE cables ADD COLUMN IF NOT EXISTS link_id VARCHAR(32) DEFAULT ''"))
        await conn.execute(text("ALTER TABLE cables ADD COLUMN IF NOT EXISTS link_name VARCHAR(128) DEFAULT ''"))
        await conn.execute(text("ALTER TABLE cables ADD COLUMN IF NOT EXISTS route_type VARCHAR(16) DEFAULT 'driving'"))
        # Backfill link_id for existing cables
        await conn.execute(text("""
            UPDATE cables SET link_id = 'LINK-' || (id + 1001) WHERE link_id = ''
        """))
        await conn.execute(text("ALTER TABLE cables ALTER COLUMN link_id SET NOT NULL"))
        await conn.execute(text("ALTER TABLE cables ADD CONSTRAINT uq_cables_link_id UNIQUE (link_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_cables_link_id ON cables(link_id)"))
    await engine.dispose()
    print("OK")

asyncio.run(main())
