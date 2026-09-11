"""Check ppp_active_entries interface values."""
import asyncio
from app.database import SessionLocal
from app.models import PppActiveEntry
from sqlalchemy import select

async def test():
    async with SessionLocal() as db:
        rows = (await db.execute(select(PppActiveEntry).limit(5))).scalars().all()
        for r in rows:
            print(f"subscriber='{r.subscriber}', interface='{r.interface}', len={len(r.interface)}")

asyncio.run(test())
