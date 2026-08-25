import re
with open('/opt/olt-commander/backend/app/services/acs.py', 'r') as f:
    content = f.read()

# Fix 1: Modify the GetRPC handler to optionally poll for monitoring parameters
# Find the section where it returns empty when no job
old_getrpc = '''        job = await _next_job(session, device)
        if job is None:
            # No pending work: end the session silently. Do NOT issue a
            # GetParameterValues poll here - these basic CPEs (Baseline/
            # EthernetLAN-only models) reject unsupported parameter requests
            # with Fault 9814 on every cycle.
            return ""
        # Fail fast when the device's reported TR-069 model does not expose the
        # parameters this job needs (avoids pointless Fault round-trips).'''

new_getrpc = '''        job = await _next_job(session, device)
        if job is None:
            # No pending work: check if we should poll for monitoring parameters
            # Only poll for devices that have previously reported monitoring params
            # to avoid Fault 9814 on basic CPEs.
            if await _should_poll_monitoring(session, device):
                return get_parameter_values(soap_id or str(uuid.uuid4()), _MONITOR_PARAMS)
            # No pending work and no monitoring poll needed: end session silently
            return ""
        # Fail fast when the device's reported TR-069 model does not expose the
        # parameters this job needs (avoids pointless Fault round-trips).'''

if old_getrpc in content:
    content = content.replace(old_getrpc, new_getrpc)
    print("Fixed GetRPC handler for monitoring")
else:
    print("Old GetRPC handler not found")
    idx = content.find("No pending work: end the session silently")
    if idx >= 0:
        print(content[idx:idx+300])
    else:
        print("Could not find GetRPC section")

with open('/opt/olt-commander/backend/app/services/acs.py', 'w') as f:
    f.write(content)