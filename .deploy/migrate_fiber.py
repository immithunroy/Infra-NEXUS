import asyncio, sqlalchemy
from sqlalchemy.ext.asyncio import create_async_engine

async def migrate():
    engine = create_async_engine("postgresql+asyncpg://olt:oltpassword@localhost:5432/olt_commander")
    async with engine.begin() as conn:
        for table, ddl in [
            ("cables", """
                CREATE TABLE IF NOT EXISTS cables (
                    id SERIAL PRIMARY KEY,
                    code VARCHAR(64) UNIQUE NOT NULL,
                    core_count INTEGER DEFAULT 12,
                    manufacturer VARCHAR(128) DEFAULT '',
                    manufacturing_year INTEGER DEFAULT 0,
                    cable_type VARCHAR(32) DEFAULT 'round',
                    color VARCHAR(32) DEFAULT '',
                    notes TEXT DEFAULT '',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """),
            ("cable_segments", """
                CREATE TABLE IF NOT EXISTS cable_segments (
                    id SERIAL PRIMARY KEY,
                    cable_id INTEGER REFERENCES cables(id) ON DELETE CASCADE,
                    start_lat DOUBLE PRECISION NOT NULL,
                    start_lng DOUBLE PRECISION NOT NULL,
                    end_lat DOUBLE PRECISION NOT NULL,
                    end_lng DOUBLE PRECISION NOT NULL,
                    order_index INTEGER DEFAULT 0
                )
            """),
            ("tj_boxes", """
                CREATE TABLE IF NOT EXISTS tj_boxes (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(128) NOT NULL,
                    box_type VARCHAR(32) DEFAULT 'tj',
                    capacity INTEGER DEFAULT 4,
                    tray_count INTEGER DEFAULT 1,
                    lat DOUBLE PRECISION NOT NULL,
                    lng DOUBLE PRECISION NOT NULL,
                    address VARCHAR(256) DEFAULT '',
                    notes TEXT DEFAULT '',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """),
            ("splitters", """
                CREATE TABLE IF NOT EXISTS splitters (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(128) DEFAULT '',
                    split_ratio INTEGER DEFAULT 2,
                    tj_box_id INTEGER REFERENCES tj_boxes(id) ON DELETE SET NULL,
                    input_core INTEGER DEFAULT 0,
                    output_cores VARCHAR(256) DEFAULT '',
                    lat DOUBLE PRECISION NOT NULL,
                    lng DOUBLE PRECISION NOT NULL,
                    notes TEXT DEFAULT '',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )
            """),
        ]:
            exists = await conn.execute(sqlalchemy.text(
                f"SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name='{table}')"
            ))
            if not exists.scalar():
                await conn.execute(sqlalchemy.text(ddl))
                print(f"CREATED {table}")
            else:
                print(f"{table} already exists")
    await engine.dispose()

asyncio.run(migrate())
