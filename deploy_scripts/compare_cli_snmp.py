import sys, asyncio
sys.path.insert(0, '/app')

async def main():
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy import select
    from app.models import OLTDevice, Onu
    from app.drivers.bdcom import BdcomCliDriver, _snmp_optical_epon, _snmp_optical_gpon, OPTICAL_SNMP_TIMEOUT
    from app.drivers.snmp import snmp_walk

    engine = create_async_engine('postgresql+asyncpg://olt:oltpassword@db:5432/infra_nexus')
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        # Use OXM-EPON-1 (id=6) — has EPON ONUs with known truncation issue
        device = (await session.execute(select(OLTDevice).where(OLTDevice.id == 6))).scalar_one()
        driver = BdcomCliDriver(device)

        # === CLI PATH ===
        print("=" * 70)
        print("CLI PATH: show epon optical-transceiver-diagnosis")
        print("=" * 70)
        await driver.connect()
        cli_optical = {}
        for pon in ["EPON0/1", "EPON0/2", "EPON0/3", "EPON0/4"]:
            try:
                out = await driver._exec(f"show epon optical-transceiver-diagnosis interface epON {pon.replace('EPON', '')}", timeout=12)
                parsed = driver._parse_optical(out)
                for (base, onu_id), (rx, tx) in parsed.items():
                    cli_optical[(base, onu_id)] = (rx, tx)
            except Exception as e:
                print(f"  {pon}: FAILED - {e}")
        driver.close()

        print(f"\nCLI collected rx/tx for {len(cli_optical)} ONUs")
        # Show first 5
        for (pon, onu_id) in sorted(cli_optical.keys())[:5]:
            rx, tx = cli_optical[(pon, onu_id)]
            print(f"  {pon}:{onu_id}  rx={rx}  tx={tx}")

        # === SNMP PATH ===
        print("\n" + "=" * 70)
        print("SNMP PATH: walk .101.10.5.1.5 (RxPower) / .101.10.5.1.6 (TxPower)")
        print("=" * 70)
        ip = device.ip
        community = device.snmp_community or "public"
        port = device.snmp_port or 161

        # Walk ifName for index mapping
        if_rows = await snmp_walk(ip, community, "1.3.6.1.2.1.2.2.1.2", port, timeout=OPTICAL_SNMP_TIMEOUT)
        ifnames = {int(o.split(".")[-1]): n for o, n in if_rows}

        # Walk RxPower
        rx_rows = await snmp_walk(ip, community, "1.3.6.1.4.1.3320.101.10.5.1.5", port, timeout=OPTICAL_SNMP_TIMEOUT)
        tx_rows = await snmp_walk(ip, community, "1.3.6.1.4.1.3320.101.10.5.1.6", port, timeout=OPTICAL_SNMP_TIMEOUT)

        def dbm(raw):
            try:
                v = float(raw)
                if v == 0 or v == 99.999:
                    return None
                return round(v / 10, 2)  # 0.1dB units
            except:
                return None

        snmp_optical = {}
        for oid_str, val in rx_rows:
            idx = int(oid_str.split(".")[-1])
            ifname = ifnames.get(idx, "")
            if "epon" not in ifname.lower() or ":" not in ifname:
                continue
            parts = ifname.upper().replace(" ", "").split(":")
            rx = dbm(val)
            # Find matching tx
            tx = None
            for t_oid, t_val in tx_rows:
                t_idx = int(t_oid.split(".")[-1])
                if t_idx == idx:
                    tx = dbm(t_val)
                    break
            pon_port = parts[0]
            onu_id = int(parts[1])
            snmp_optical[(pon_port, onu_id)] = (rx, tx, ifname)

        print(f"\nSNMP collected rx/tx for {len(snmp_optical)} ONUs")
        for (pon, onu_id) in sorted(snmp_optical.keys())[:5]:
            rx, tx, ifname = snmp_optical[(pon, onu_id)]
            print(f"  {ifname}  rx={rx}  tx={tx}")

        # === COMPARE ===
        print("\n" + "=" * 70)
        print("COMPARISON: CLI vs SNMP for ONUs found by BOTH")
        print("=" * 70)
        common = set(cli_optical.keys()) & set(snmp_optical.keys())
        print(f"Common ONUs: {len(common)} (CLI={len(cli_optical)}, SNMP={len(snmp_optical)})")

        mismatches = 0
        for (pon, onu_id) in sorted(common)[:15]:
            cli_rx, cli_tx = cli_optical[(pon, onu_id)]
            snmp_rx, snmp_tx, ifname = snmp_optical[(pon, onu_id)]
            rx_match = "✓" if cli_rx == snmp_rx else "✗"
            tx_match = "✓" if cli_tx == snmp_tx else "✗"
            if cli_rx != snmp_rx or cli_tx != snmp_tx:
                mismatches += 1
            print(f"  {ifname}  CLI: rx={cli_rx:>7} tx={cli_tx:>7}  SNMP: rx={snmp_rx:>7} tx={snmp_tx:>7}  rx={rx_match} tx={tx_match}")

        # === ONUs only in SNMP (CLI truncated) ===
        snmp_only = set(snmp_optical.keys()) - set(cli_optical.keys())
        if snmp_only:
            print(f"\n{'=' * 70}")
            print(f"ONUs ONLY in SNMP (CLI truncated): {len(snmp_only)}")
            print("=" * 70)
            for (pon, onu_id) in sorted(snmp_only)[:10]:
                rx, tx, ifname = snmp_optical[(pon, onu_id)]
                print(f"  {ifname}  rx={rx}  tx={tx}")

        # === DB current values ===
        print(f"\n{'=' * 70}")
        print("DB current rx_power/tx_power (from last telemetry)")
        print("=" * 70)
        res = await session.execute(select(Onu).where(Onu.olt_id == 6).order_by(Onu.pon_port, Onu.onu_id))
        db_onus = res.scalars().all()
        for onu in db_onus[:10]:
            print(f"  {onu.pon_port}  rx={onu.rx_power}  tx={onu.tx_power}  state={onu.state}  name={onu.name[:30] if onu.name else '':<30}")

asyncio.run(main())
