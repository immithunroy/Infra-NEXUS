from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, pool_pre_ping=True, echo=False, pool_size=10, max_overflow=20)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE tj_boxes ADD COLUMN IF NOT EXISTS splice_per_tray INTEGER NOT NULL DEFAULT 12"))
        # Photo processing status columns for approval requests
        await conn.execute(text("ALTER TABLE fiber_approval_requests ADD COLUMN IF NOT EXISTS photo_processing_status VARCHAR(16) DEFAULT ''"))
        await conn.execute(text("ALTER TABLE fiber_approval_requests ADD COLUMN IF NOT EXISTS photo_processing_error TEXT DEFAULT ''"))
        # Ensure field_photos table exists (for upgrades from older versions)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS field_photos (
                id SERIAL PRIMARY KEY,
                entity_type VARCHAR(32) NOT NULL,
                entity_id VARCHAR(128) NOT NULL,
                photo_type VARCHAR(32) NOT NULL,
                storage_key VARCHAR(256) NOT NULL,
                original_filename VARCHAR(256) DEFAULT '',
                mime_type VARCHAR(64) DEFAULT 'image/jpeg',
                file_size INTEGER DEFAULT 0,
                width INTEGER DEFAULT 0,
                height INTEGER DEFAULT 0,
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                captured_at TIMESTAMPTZ,
                captured_by VARCHAR(128) DEFAULT '',
                uploaded_by INTEGER,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_field_photos_entity ON field_photos (entity_type, entity_id)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_field_photos_entity_type ON field_photos (entity_type, entity_id, photo_type)"))
        await conn.execute(text("ALTER TABLE field_photos ADD COLUMN IF NOT EXISTS pppoe_username VARCHAR(128) DEFAULT ''"))
        await conn.execute(text("ALTER TABLE field_photos ADD COLUMN IF NOT EXISTS gps_accuracy DOUBLE PRECISION"))
        # TJ ID reservations table
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tj_id_reservations (
                id SERIAL PRIMARY KEY,
                unique_id VARCHAR(16) NOT NULL UNIQUE,
                reserved_by VARCHAR(128) DEFAULT '',
                reserved_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL,
                status VARCHAR(16) DEFAULT 'active'
            )
        """))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tj_id_reservations_status ON tj_id_reservations (status)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tj_id_reservations_expires ON tj_id_reservations (expires_at)"))