import sys
sys.path.insert(0, '/app')
import asyncio

async def main():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select
    from app.models import OLTDevice
    from app.drivers.bdcom import (
        EPON_ONU_MAC_OID, EPON_ONU_NAME_OID, EPON_ONU_STATUS_OID,
        EPON_ONU_DEREG_REASON_OID, EPON_ONU_BIND_DIID_OID,
        OPTICAL_SNMP_TIMEOUT
    )
    from app.drivers.snmp import snmp_walk

    engine = create_async_engine('postgresql+asyncpg://olt:oltpassword@db:5432/infra_nexus')
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        device = (await session.execute(select(OLTDevice).where(OLTDevice.id == 6))).scalar_one()
        ip = device.ip
        community = device.snmp_community or "public"
        port = device.snmp_port or 161

        # Walk DIID (bind table index)
        diid_rows = await snmp_walk(ip, community, EPON_ONU_BIND_DIID_OID, port, timeout=OPTICAL_SNMP_TIMEOUT)
        diid_by_idx = {}
        for oid_str, val in diid_rows:
            idx = int(oid_str.split(".")[-1])
            diid_by_idx[idx] = val.strip()
        print(f"DIID: {len(diid_by_idx)} entries")
        for idx in sorted(diid_by_idx.keys())[:5]:
            print(f"  idx={idx} → diid={diid_by_idx[idx]}")

        # Walk name
        name_rows = await snmp_walk(ip, community, EPON_ONU_NAME_OID, port, timeout=OPTICAL_SNMP_TIMEOUT)
        name_by_idx = {}
        for oid_str, val in name_rows:
            idx = int(oid_str.split(".")[-1])
            name_by_idx[idx] = val.strip()
        print(f"\nName: {len(name_by_idx)} entries")
        for idx in sorted(name_by_idx.keys())[:10]:
            print(f"  idx={idx} → name={name_by_idx[idx]!r}")

        # Walk MAC
        mac_rows = await snmp_walk(ip, community, EPON_ONU_MAC_OID, port, timeout=OPTICAL_SNMP_TIMEOUT)
        mac_by_idx = {}
        for oid_str, val in mac_rows:
            idx = int(oid_str.split(".")[-1])
            mac_raw = val.strip().replace(" ", ":").replace("-", ":").lower()
            mac_by_idx[idx] = mac_raw
        print(f"\nMAC: {len(mac_by_idx)} entries")
        for idx in sorted(mac_by_idx.keys())[:5]:
            print(f"  idx={idx} → mac={mac_by_idx[idx]}")

        # Check if name indices overlap with MAC indices
        name_set = set(name_by_idx.keys())
        mac_set = set(mac_by_idx.keys())
        print(f"\nName indices range: {min(name_set)}-{max(name_set)}")
        print(f"MAC indices range: {min(mac_set)}-{max(mac_set)}")
        print(f"Overlap: {len(name_set & mac_set)}")

        # Try DIID → ifName correlation
        from app.drivers.snmp import snmp_walk as sw
        if_rows = await sw(ip, community, "1.3.6.1.2.1.2.2.1.2", port, timeout=OPTICAL_SNMP_TIMEOUT)
        ifnames = {}
        for oid_str, name in if_rows:
            idx = int(oid_str.split(".")[-1])
            ifnames[idx] = name

        print(f"\n=== DIID → ifName correlation ===")
        for idx in sorted(diid_by_idx.keys())[:10]:
            diid = diid_by_idx[idx]
            ifname = ifnames.get(int(diid) if diid.isdigit() else -1, "?")
            print(f"  name_idx={idx} → DIID={diid} → ifName={ifname}")

asyncio.run(main())
