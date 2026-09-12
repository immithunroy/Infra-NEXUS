import sys
sys.path.insert(0, '/app')
import asyncio

async def main():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select
    from app.models import OLTDevice, Onu
    from app.services.collector import scan_olt

    engine = create_async_engine('postgresql+asyncpg://olt:oltpassword@db:5432/infra_nexus')
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        # Trigger a scan
        print("=== Triggering OXM-EPON-1 scan ===")
        log = await scan_olt(session, 6)
        print(f"Scan result: {log.status} - {log.message}")

        # Check the two ONUs
        print("\n=== EPON0/3 ONUs after scan ===")
        for onu_id in [3, 4]:
            res = await session.execute(
                select(Onu).where(Onu.olt_id == 6, Onu.pon_port == 'EPON0/3', Onu.onu_id == onu_id)
            )
            onu = res.scalar_one_or_none()
            if onu:
                print(f"  EPON0/3:{onu_id}: state={onu.state}, name={onu.name!r}, mac={onu.mac}, last_seen={onu.last_seen}")
            else:
                print(f"  EPON0/3:{onu_id}: NOT FOUND")

        # Count total ONUs
        res = await session.execute(select(Onu).where(Onu.olt_id == 6))
        all_onus = res.scalars().all()
        print(f"\n=== Total ONUs: {len(all_onus)} ===")
        named = [o for o in all_onus if o.name]
        print(f"ONUs with names: {len(named)}")
        with_state = [o for o in all_onus if o.state != 'unknown']
        print(f"ONUs with non-unknown state: {len(with_state)}")

asyncio.run(main())
