"""Add NOC and POP tables, and noc_id/pop_id to olt_devices."""
import asyncio
from sqlalchemy import text
from app.database import engine


async def migrate():
    async with engine.begin() as conn:
        # Create pops table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pops (
                id SERIAL PRIMARY KEY,
                name VARCHAR(128) NOT NULL,
                address TEXT DEFAULT '',
                gps_lat FLOAT,
                gps_lng FLOAT,
                contact_name VARCHAR(128) DEFAULT '',
                contact_phone VARCHAR(64) DEFAULT '',
                notes TEXT DEFAULT '',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_pops_name ON pops (name)"))

        # Create nocs table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS nocs (
                id SERIAL PRIMARY KEY,
                name VARCHAR(128) NOT NULL,
                address TEXT DEFAULT '',
                gps_lat FLOAT,
                gps_lng FLOAT,
                contact_name VARCHAR(128) DEFAULT '',
                contact_phone VARCHAR(64) DEFAULT '',
                notes TEXT DEFAULT '',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_nocs_name ON nocs (name)"))

        # Add noc_id and pop_id to olt_devices
        try:
            await conn.execute(text("ALTER TABLE olt_devices ADD COLUMN noc_id INTEGER"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE olt_devices ADD COLUMN pop_id INTEGER"))
        except Exception:
            pass
        try:
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_olt_devices_noc_id ON olt_devices (noc_id)"))
        except Exception:
            pass
        try:
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_olt_devices_pop_id ON olt_devices (pop_id)"))
        except Exception:
            pass

        print("Migration completed: nocs, pops tables created; olt_devices updated")


if __name__ == "__main__":
    asyncio.run(migrate())
