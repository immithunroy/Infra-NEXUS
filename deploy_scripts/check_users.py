from app.database import SessionLocal
from app.models import User
from sqlalchemy import select
import asyncio

async def t():
    async with SessionLocal() as db:
        users = (await db.execute(select(User))).scalars().all()
        for u in users:
            print(f'id={u.id} username={u.username} role={u.role} disabled={u.disabled}')

asyncio.run(t())
