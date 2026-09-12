import sys
sys.path.insert(0, '/app')
import asyncio

async def main():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select
    from app.models import OLTDevice
    from app.drivers.bdcom import BdcomCliDriver

    engine = create_async_engine('postgresql+asyncpg://olt:oltpassword@db:5432/infra_nexus')
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        device = (await session.execute(select(OLTDevice).where(OLTDevice.id == 6))).scalar_one()
        driver = BdcomCliDriver(device)
        await driver.connect()
        output = await driver._exec('show epon onu-information', timeout=120)
        print("=== FULL OUTPUT ===")
        print(output)
        print("=== END OUTPUT ===")
        print(f"\n=== OUTPUT LENGTH: {len(output)} chars ===")
        
        print("\n=== PARSED ONUs ===")
        parsed = driver._parse_onu_info(output)
        for key in sorted(parsed.keys()):
            info = parsed[key]
            print(f"  {key}: pon_port={info.pon_port} onu_id={info.onu_id} state={info.state} serial={info.serial} mac={info.extra.get('mac','')} desc={info.description!r}")
        
        print(f"\n=== TOTAL PARSED: {len(parsed)} ===")
        await driver.close()

asyncio.run(main())
