import sys
sys.path.insert(0, '/app')
import asyncio

async def main():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select
    from app.models import OLTDevice
    from app.drivers.bdcom import _snmp_epon_names

    engine = create_async_engine('postgresql+asyncpg://olt:oltpassword@db:5432/infra_nexus')
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        device = (await session.execute(select(OLTDevice).where(OLTDevice.id == 6))).scalar_one()
        result = await _snmp_epon_names(device)

        # Show EPON0/3 entries specifically
        print("=== EPON0/3 entries ===")
        for (pon, onu_id) in sorted(result.keys()):
            if pon == "EPON0/3":
                data = result[(pon, onu_id)]
                print(f"  {pon}:{onu_id} → {data}")

        # Show total counts by PON port
        print("\n=== Counts by PON port ===")
        from collections import Counter
        counts = Counter(pon for (pon, _) in result.keys())
        for pon, count in sorted(counts.items()):
            print(f"  {pon}: {count} ONUs")

        # Show entries with names
        named = {k: v for k, v in result.items() if "name" in v}
        print(f"\n=== Entries with names: {len(named)} out of {len(result)} ===")

asyncio.run(main())
