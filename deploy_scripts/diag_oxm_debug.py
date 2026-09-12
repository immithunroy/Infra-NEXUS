import sys
sys.path.insert(0, '/app')
import asyncio

async def main():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select
    from app.models import OLTDevice
    from app.drivers.bdcom import (
        EPON_ONU_NAME_OID, EPON_ONU_MAC_OID, EPON_ONU_STATUS_OID,
        OPTICAL_SNMP_TIMEOUT, _bytes_to_mac
    )
    from app.drivers.snmp import snmp_walk

    engine = create_async_engine('postgresql+asyncpg://olt:oltpassword@db:5432/infra_nexus')
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        device = (await session.execute(select(OLTDevice).where(OLTDevice.id == 6))).scalar_one()
        ip = device.ip
        community = device.snmp_community or "public"
        port = device.snmp_port or 161

        # Walk name OID (.11.1.1.4)
        name_rows = await snmp_walk(ip, community, EPON_ONU_NAME_OID, port, timeout=OPTICAL_SNMP_TIMEOUT)
        name_base = EPON_ONU_NAME_OID
        print(f"Name OID base: {name_base}")
        print(f"Name base len: {len(name_base)}")
        print(f"\nFirst 3 name OID strings:")
        for oid_str, val in name_rows[:3]:
            suffix = oid_str[len(name_base) + 1:]
            print(f"  Full OID: {oid_str}")
            print(f"  Suffix:   {suffix}")
            print(f"  Value:    {val.strip()!r}")
            print()

        # Walk bind MAC OID (.11.1.1.3)
        bind_mac_oid = "1.3.6.1.4.1.3320.101.11.1.1.3"
        bind_mac_rows = await snmp_walk(ip, community, bind_mac_oid, port, timeout=OPTICAL_SNMP_TIMEOUT)
        bind_mac_base = bind_mac_oid.rsplit(".", 1)[0]
        print(f"Bind MAC OID base: {bind_mac_base}")
        print(f"\nFirst 3 bind MAC OID strings:")
        for oid_str, val in bind_mac_rows[:3]:
            suffix = oid_str[len(bind_mac_base) + 1:]
            mac = _bytes_to_mac(val)
            print(f"  Full OID: {oid_str}")
            print(f"  Suffix:   {suffix}")
            print(f"  Raw val:  {val!r}")
            print(f"  MAC:      {mac}")
            print()

        # Check if suffixes match
        name_suffixes = set()
        for oid_str, _ in name_rows:
            s = oid_str[len(name_base) + 1:]
            name_suffixes.add(s)
        mac_suffixes = set()
        for oid_str, _ in bind_mac_rows:
            s = oid_str[len(bind_mac_base) + 1:]
            mac_suffixes.add(s)
        print(f"Name suffixes: {len(name_suffixes)}, first 3: {list(name_suffixes)[:3]}")
        print(f"MAC suffixes:  {len(mac_suffixes)}, first 3: {list(mac_suffixes)[:3]}")
        print(f"Overlap: {len(name_suffixes & mac_suffixes)}")

asyncio.run(main())
