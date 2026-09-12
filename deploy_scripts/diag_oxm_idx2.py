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
        EPON_ONU_BIND_DIID_OID, OPTICAL_SNMP_TIMEOUT
    )
    from app.drivers.snmp import snmp_walk

    engine = create_async_engine('postgresql+asyncpg://olt:oltpassword@db:5432/infra_nexus')
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        device = (await session.execute(select(OLTDevice).where(OLTDevice.id == 6))).scalar_one()
        ip = device.ip
        community = device.snmp_community or "public"
        port = device.snmp_port or 161

        # Walk ALL name table OIDs (full OID including index)
        name_rows = await snmp_walk(ip, community, EPON_ONU_NAME_OID, port, timeout=OPTICAL_SNMP_TIMEOUT)
        print("=== Raw name OID entries (first 15) ===")
        for oid_str, val in name_rows[:15]:
            print(f"  OID={oid_str}  value={val.strip()!r}")

        # Walk ALL DIID entries
        diid_rows = await snmp_walk(ip, community, EPON_ONU_BIND_DIID_OID, port, timeout=OPTICAL_SNMP_TIMEOUT)
        print(f"\n=== Raw DIID entries (first 15) ===")
        for oid_str, val in diid_rows[:15]:
            print(f"  OID={oid_str}  DIID={val.strip()}")

        # Walk ALL MAC entries
        mac_rows = await snmp_walk(ip, community, EPON_ONU_MAC_OID, port, timeout=OPTICAL_SNMP_TIMEOUT)
        print(f"\n=== Raw MAC entries (first 15) ===")
        for oid_str, val in mac_rows[:15]:
            mac_raw = val.strip().replace(" ", ":").replace("-", ":").lower()
            print(f"  OID={oid_str}  MAC={mac_raw}")

        # Check: is there a MAC field in the name table? Walk the name table with more columns
        # The binding table has: .1=DIID, .2=seq, .3=MAC, .4=name
        print("\n=== Name table .3 (MAC in bind table) ===")
        bind_mac_oid = "1.3.6.1.4.1.3320.101.11.1.1.3"
        bind_mac_rows = await snmp_walk(ip, community, bind_mac_oid, port, timeout=OPTICAL_SNMP_TIMEOUT)
        for oid_str, val in bind_mac_rows[:10]:
            mac_raw = val.strip().replace(" ", ":").replace("-", ":").lower()
            print(f"  OID={oid_str}  MAC={mac_raw}")
        print(f"  ... ({len(bind_mac_rows)} total)")

        # Now: match name table MAC → ifName to get (pon_port, onu_id)
        # Build ifName map
        if_rows = await snmp_walk(ip, community, "1.3.6.1.2.1.2.2.1.2", port, timeout=OPTICAL_SNMP_TIMEOUT)
        ifnames = {}
        for oid_str, name in if_rows:
            idx = int(oid_str.split(".")[-1])
            ifnames[idx] = name

        # Build MAC → ifName
        mac_to_ifname = {}
        for oid_str, val in mac_rows:
            idx = int(oid_str.split(".")[-1])
            mac_raw = val.strip().replace(" ", ":").replace("-", ":").lower()
            ifname = ifnames.get(idx, "")
            if ifname and ":" in ifname:
                mac_to_ifname[mac_raw] = ifname

        # Match bind table MAC → name
        print("\n=== Bind table MAC → name correlation ===")
        name_by_idx = {int(oid_str.split(".")[-1]): val.strip() for oid_str, val in name_rows}
        bind_mac_by_idx = {}
        for oid_str, val in bind_mac_rows:
            idx = int(oid_str.split(".")[-1])
            bind_mac_by_idx[idx] = val.strip().replace(" ", ":").replace("-", ":").lower()

        matched = 0
        for idx in sorted(bind_mac_by_idx.keys()):
            mac = bind_mac_by_idx[idx]
            name = name_by_idx.get(idx, "")
            ifname = mac_to_ifname.get(mac, "?")
            if "?" not in ifname:
                matched += 1
                if matched <= 10:
                    print(f"  idx={idx}: MAC={mac} → {ifname} name={name!r}")
        print(f"  ... {matched} matched out of {len(bind_mac_by_idx)}")

asyncio.run(main())
