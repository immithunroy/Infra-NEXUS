import sys
sys.path.insert(0, '/app')
import asyncio
from app.drivers.bdcom import BdcomCliDriver
from app.models import OLTDevice

async def main():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    engine = create_async_engine('postgresql+asyncpg://olt:oltpassword@db:5432/infra_nexus')
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        from sqlalchemy import select
        device = (await session.execute(select(OLTDevice).where(OLTDevice.id == 6))).scalar_one()
        driver = BdcomCliDriver(device)
        await driver.connect()
        output = await driver._exec('show epon onu-information', timeout=120)
        print("=== RAW OUTPUT (EPON0/3 section) ===")
        for line in output.splitlines():
            if '0/3' in line.lower():
                print(repr(line))
        print("\n=== PARSE TEST ===")
        parsed = driver._parse_onu_info(output)
        for key in sorted(parsed.keys()):
            if '0/3' in str(key):
                info = parsed[key]
                print(f"  {key}: pon_port={info.pon_port} onu_id={info.onu_id} state={info.state} serial={info.serial} mac={info.extra.get('mac','')} desc={info.description!r}")
        await driver.disconnect()

asyncio.run(main())
