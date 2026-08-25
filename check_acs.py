from app.database import SessionLocal
from app.models import AcsDevice, AcsParameter, AcsMetric
from sqlalchemy import select

async def check():
    async with SessionLocal() as session:
        devices = (await session.execute(select(AcsDevice))).scalars().all()
        print(f'Devices: {len(devices)}')
        for d in devices:
            print(f'  Device {d.id}: serial={d.serial_number}, online={d.online}, ip={d.ip}')
            params = (await session.execute(select(AcsParameter).where(AcsParameter.device_id == d.id))).scalars().all()
            print(f'    Parameters: {len(params)}')
            for p in params[:10]:
                print(f'      {p.name} = {p.value[:50]}')
            if len(params) > 10:
                print(f'      ... and {len(params) - 10} more')
            metrics = (await session.execute(select(AcsMetric).where(AcsMetric.device_id == d.id))).scalars().all()
            print(f'    Metrics: {len(metrics)}')

import asyncio
asyncio.run(check())