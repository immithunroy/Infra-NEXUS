import asyncio, sys
sys.path.insert(0, '/app')
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
from app.models import OLTDevice
from app.drivers.bdcom import BdcomCliDriver

async def main():
    engine = create_async_engine('postgresql+asyncpg://olt:oltpassword@db:5432/infra_nexus')
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        device = (await session.execute(select(OLTDevice).where(OLTDevice.id == 6))).scalar_one()
        driver = BdcomCliDriver(device)
        await driver.connect()

        # Test per-ONU command (colon format used by check_onu_realtime)
        cmds = [
            'show epon onu optical-transceiver-diagnosis interface epON 0/1',
            'show epon optical-transceiver-diagnosis interface epon 0/1:1',
            'show epon onu optical-transceiver-diagnosis interface epon 0/1:1',
        ]
        for cmd in cmds:
            try:
                out = await driver._exec(cmd, timeout=15)
                lines = [l for l in out.split(chr(10)) if l.strip()]
                print(f'CMD: {cmd}')
                print(f'  Result: {len(lines)} lines')
                for l in lines[:15]:
                    print(f'    {l}')
                print()
            except Exception as e:
                print(f'CMD: {cmd} -> FAILED: {e}')
                print()

        # Now test: can we get per-ONU RxPower from the bulk command?
        print("=" * 60)
        print("Parse test: EPON bulk 'onu optical-transceiver-diagnosis'")
        print("=" * 60)
        out = await driver._exec('show epon onu optical-transceiver-diagnosis interface epON 0/1', timeout=15)
        parsed = driver._parse_optical(out)
        for (pon, onu_id), (rx, tx) in sorted(parsed.items()):
            print(f'  {pon}:{onu_id}  rx={rx}  tx={tx}')

        driver.close()

asyncio.run(main())
