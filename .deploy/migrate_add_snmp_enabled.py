import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
import sqlalchemy

async def main():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        exists = await conn.execute(sqlalchemy.text(
            "SELECT column_name FROM information_schema.columns WHERE table_name='olt_devices' AND column_name='snmp_enabled'"
        ))
        if exists.scalar():
            print("COLUMN snmp_enabled already exists, skipping")
        else:
            await conn.execute(sqlalchemy.text(
                "ALTER TABLE olt_devices ADD COLUMN snmp_enabled BOOLEAN NOT NULL DEFAULT FALSE"
            ))
            print("ADDED snmp_enabled column")
    await engine.dispose()

asyncio.run(main())
