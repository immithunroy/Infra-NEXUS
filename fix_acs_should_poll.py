import re
with open('/opt/olt-commander/backend/app/services/acs.py', 'r') as f:
    content = f.read()

# Fix 2: Add _should_poll_monitoring function before _next_job
old_func = '''async def _next_job(session: AsyncSession, device: AcsDevice) -> AcsJob | None:'''

new_func = '''async def _should_poll_monitoring(session: AsyncSession, device: AcsDevice) -> bool:
    """Check if device supports monitoring parameters to avoid Fault 9814."""
    # Check if device has reported any monitoring-related parameters
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
    return count > 0


async def _next_job(session: AsyncSession, device: AcsDevice) -> AcsJob | None:'''

if old_func in content:
    content = content.replace(old_func, new_func)
    print("Added _should_poll_monitoring function")
else:
    print("Old _next_job function not found")
    idx = content.find("async def _next_job")
    if idx >= 0:
        print(content[idx:idx+200])
    else:
        print("Could not find _next_job")

with open('/opt/olt-commander/backend/app/services/acs.py', 'w') as f:
    f.write(content)