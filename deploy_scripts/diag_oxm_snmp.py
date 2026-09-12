import sys
sys.path.insert(0, '/app')
import asyncio

async def main():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select
    from app.models import OLTDevice
    from app.drivers.bdcom import (
        _snmp_epon_names, EPON_ONU_MAC_OID, EPON_ONU_NAME_OID, EPON_ONU_STATUS_OID,
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

        print(f"=== SNMP walk on {ip} community={community} ===\n")

        # Walk ifName
        if_rows = await snmp_walk(ip, community, "1.3.6.1.2.1.2.2.1.2", port, timeout=OPTICAL_SNMP_TIMEOUT)
        ifnames = {}
        for oid_str, name in if_rows:
            idx = int(oid_str.split(".")[-1])
            ifnames[idx] = name
        # Show only EPON entries
        epon_ifnames = {k: v for k, v in ifnames.items() if "epon" in v.lower()}
        print(f"EPON ifNames: {len(epon_ifnames)} entries")
        for idx in sorted(epon_ifnames.keys())[:5]:
            print(f"  ifIndex={idx} → {epon_ifnames[idx]}")
        print(f"  ... ({len(epon_ifnames)} total)\n")

        # Walk ONU MAC
        mac_rows = await snmp_walk(ip, community, EPON_ONU_MAC_OID, port, timeout=OPTICAL_SNMP_TIMEOUT)
        mac_by_idx = {}
        for oid_str, val in mac_rows:
            idx = int(oid_str.split(".")[-1])
            mac_raw = val.strip().replace(" ", ":").replace("-", ":").lower()
            mac_by_idx[idx] = mac_raw
        print(f"ONU MAC: {len(mac_by_idx)} entries")
        for idx in sorted(mac_by_idx.keys())[:5]:
            print(f"  idx={idx} → mac={mac_by_idx[idx]}")
        print(f"  ... ({len(mac_by_idx)} total)\n")

        # Walk ONU name
        name_rows = await snmp_walk(ip, community, EPON_ONU_NAME_OID, port, timeout=OPTICAL_SNMP_TIMEOUT)
        name_by_idx = {}
        for oid_str, val in name_rows:
            idx = int(oid_str.split(".")[-1])
            name_text = val.strip()
            if name_text and name_text != "N/A":
                name_by_idx[idx] = name_text
        print(f"ONU Name: {len(name_by_idx)} entries")
        for idx in sorted(name_by_idx.keys())[:5]:
            print(f"  idx={idx} → name={name_by_idx[idx]!r}")
        print(f"  ... ({len(name_by_idx)} total)\n")

        # Walk ONU status
        status_rows = await snmp_walk(ip, community, EPON_ONU_STATUS_OID, port, timeout=OPTICAL_SNMP_TIMEOUT)
        status_by_idx = {}
        EPON_SNMP_STATUS_MAP = {"0": "auth", "1": "registered", "2": "deregistered", "3": "auto_config", "4": "lost", "5": "standby"}
        for oid_str, val in status_rows:
            idx = int(oid_str.split(".")[-1])
            status_by_idx[idx] = EPON_SNMP_STATUS_MAP.get(str(val).strip(), f"unknown({val})")
        print(f"ONU Status: {len(status_by_idx)} entries")
        for idx in sorted(status_by_idx.keys())[:5]:
            print(f"  idx={idx} → status={status_by_idx[idx]}")
        print(f"  ... ({len(status_by_idx)} total)\n")

        # Test correlation: do the indices match?
        mac_indices = set(mac_by_idx.keys())
        ifname_indices = set(epon_ifnames.keys())
        common = mac_indices & ifname_indices
        print(f"Correlation: MAC indices={len(mac_indices)}, ifName indices={len(ifname_indices)}, common={len(common)}")

        # Show sample correlation
        sample_indices = sorted(common)[:3]
        print(f"\nSample correlated entries:")
        for idx in sample_indices:
            print(f"  idx={idx}: ifName={epon_ifnames[idx]}, mac={mac_by_idx.get(idx, 'N/A')}, name={name_by_idx.get(idx, 'N/A')}, status={status_by_idx.get(idx, 'N/A')}")

        # Test the full function
        print(f"\n=== _snmp_epon_names() result ===")
        result = await _snmp_epon_names(device)
        for key in sorted(result.keys())[:10]:
            print(f"  {key}: {result[key]}")
        print(f"  ... ({len(result)} total)")

asyncio.run(main())
