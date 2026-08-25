import asyncio, sqlalchemy
from sqlalchemy.ext.asyncio import create_async_engine

async def migrate():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        exists = await conn.execute(sqlalchemy.text(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name='switch_devices')"
        ))
        if exists.scalar():
            print("switch_devices table already exists, skipping")
        else:
            await conn.execute(sqlalchemy.text("""
                CREATE TABLE switch_devices (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(128) NOT NULL,
                    ip VARCHAR(64) NOT NULL,
                    vendor VARCHAR(32) DEFAULT 'generic',
                    port_count INTEGER DEFAULT 24,
                    access_method VARCHAR(16) DEFAULT 'telnet',
                    port INTEGER DEFAULT 23,
                    username VARCHAR(128) DEFAULT '',
                    password VARCHAR(256) DEFAULT '',
                    enable_password VARCHAR(256) DEFAULT '',
                    snmp_enabled BOOLEAN DEFAULT FALSE,
                    snmp_community VARCHAR(64) DEFAULT 'public',
                    snmp_version VARCHAR(8) DEFAULT '2c',
                    snmp_port INTEGER DEFAULT 161,
                    enabled BOOLEAN DEFAULT TRUE,
                    status VARCHAR(32) DEFAULT 'unknown',
                    last_scan_at TIMESTAMPTZ,
                    last_message TEXT DEFAULT '',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """))
            print("CREATED switch_devices table")
    await engine.dispose()

asyncio.run(migrate())
