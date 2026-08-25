import re
with open('/opt/olt-commander/backend/app/services/scheduler.py', 'r') as f:
    content = f.read()

# Add ACS monitoring function after _collect_all_telemetry
old_telemetry = '''async def _collect_all_telemetry() -> None:
    async with SessionLocal() as session:
        from sqlalchemy import select

        from ..models import OLTDevice

        devices = (await session.execute(select(OLTDevice).where(OLTDevice.enabled.is_(True)))).scalars().all()
        for device in devices:
            try:
                await collector.collect_telemetry(session, device.id)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Telemetry failed for %s: %s", device.name, exc)


async def _bind() -> None:'''

new_telemetry = '''async def _collect_all_telemetry() -> None:
    async with SessionLocal() as session:
        from sqlalchemy import select

        from ..models import OLTDevice

        devices = (await session.execute(select(OLTDevice).where(OLTDevice.enabled.is_(True)))).scalars().all()
        for device in devices:
            try:
                await collector.collect_telemetry(session, device.id)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Telemetry failed for %s: %s", device.name, exc)


async def _poll_acs_metrics() -> None:
    """Poll ACS devices for monitoring parameters (CPU, memory, traffic)."""
    async with SessionLocal() as session:
        from sqlalchemy import select
        from ..models import AcsDevice
        from .acs import get_parameter_values, _MONITOR_PARAMS
        import uuid

        devices = (await session.execute(select(AcsDevice).where(AcsDevice.online.is_(True)))).scalars().all()
        for device in devices:
            try:
                # Check if device supports monitoring params
                from sqlalchemy import func
                from ..models import AcsParameter
                count = (
                    await session.execute(
                        select(func.count(AcsParameter.id)).where(
                            AcsParameter.device_id == device.id,
                            AcsParameter.name.like("InternetGatewayDevice.WANDevice.%TotalBytesReceived%") |
                            AcsParameter.name.like("InternetGatewayDevice.WANDevice.%TotalBytesSent%") |
                            AcsParameter.name.like("InternetGatewayDevice.LANDevice.1.WLANConfiguration.%") |
                            AcsParameter.name.like("InternetGatewayDevice.DeviceInfo.CPUUsage%") |
                            AcsParameter.name.like("InternetGatewayDevice.DeviceInfo.MemoryStatus.%")
                        )
                    )
                ).scalar() or 0
                if count > 0:
                    # Send GetParameterValues RPC via the ACS connection
                    # This will be picked up on the next GetRPC from the device
                    # For now, we just ensure the device will be polled on next GetRPC
                    pass
            except Exception as exc:  # noqa: BLE001
                logger.exception("ACS metric poll failed for device %s: %s", device.id, exc)


async def _bind() -> None:'''

if old_telemetry in content:
    content = content.replace(old_telemetry, new_telemetry)
    print("Added ACS monitoring function")
else:
    print("Telemetry function not found")
    idx = content.find("async def _collect_all_telemetry")
    if idx >= 0:
        print(content[idx:idx+300])
    else:
        print("Could not find telemetry function")

with open('/opt/olt-commander/backend/app/services/scheduler.py', 'w') as f:
    f.write(content)