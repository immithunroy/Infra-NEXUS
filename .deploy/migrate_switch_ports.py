import asyncio, sqlalchemy
from sqlalchemy.ext.asyncio import create_async_engine

async def migrate():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        exists = await conn.execute(sqlalchemy.text(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name='switch_ports')"
        ))
        if exists.scalar():
            print("switch_ports table already exists")
        else:
            await conn.execute(sqlalchemy.text("""
                CREATE TABLE switch_ports (
                    id SERIAL PRIMARY KEY,
                    switch_id INTEGER REFERENCES switch_devices(id) ON DELETE CASCADE,
                    name VARCHAR(64) NOT NULL,
                    status VARCHAR(32) DEFAULT 'unknown',
                    speed VARCHAR(32) DEFAULT '',
                    vlan VARCHAR(32) DEFAULT '',
                    mac_address VARCHAR(32) DEFAULT '',
                    description VARCHAR(256) DEFAULT '',
                    rx_bytes INTEGER DEFAULT 0,
                    tx_bytes INTEGER DEFAULT 0,
                    last_scan_at TIMESTAMPTZ
                )
            """))
            print("CREATED switch_ports table")
    await engine.dispose()

asyncio.run(migrate())
