"""Add noc_id/pop_id to switch_devices."""
import asyncio
from sqlalchemy import text
from app.database import engine


async def migrate():
    async with engine.begin() as conn:
        try:
            await conn.execute(text("ALTER TABLE switch_devices ADD COLUMN noc_id INTEGER"))
        except Exception:
            pass
        try:
            await conn.execute(text("ALTER TABLE switch_devices ADD COLUMN pop_id INTEGER"))
        except Exception:
            pass
        try:
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_switch_devices_noc_id ON switch_devices (noc_id)"))
        except Exception:
            pass
        try:
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_switch_devices_pop_id ON switch_devices (pop_id)"))
        except Exception:
            pass
        print("Migration completed: switch_devices updated with noc_id/pop_id")


if __name__ == "__main__":
    asyncio.run(migrate())
