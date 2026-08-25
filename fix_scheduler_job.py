import re
with open('/opt/olt-commander/backend/app/services/scheduler.py', 'r') as f:
    content = f.read()

# Add ACS monitoring job to scheduler
old_scheduler = '''    if settings.telemetry_interval > 0:
        # Offset the first run so SNMP telemetry doesn't collide with the
        # startup burst of OLT/Mikrotik scans (sporadic SNMP timeouts).
        scheduler.add_job(
            _collect_all_telemetry,
            IntervalTrigger(seconds=settings.telemetry_interval),
            id="telemetry",
            replace_existing=True,
            misfire_grace_time=30,
            next_run_time=utcnow() + timedelta(seconds=90),
        )
    scheduler.start()'''

new_scheduler = '''    if settings.telemetry_interval > 0:
        # Offset the first run so SNMP telemetry doesn't collide with the
        # startup burst of OLT/Mikrotik scans (sporadic SNMP timeouts).
        scheduler.add_job(
            _collect_all_telemetry,
            IntervalTrigger(seconds=settings.telemetry_interval),
            id="telemetry",
            replace_existing=True,
            misfire_grace_time=30,
            next_run_time=utcnow() + timedelta(seconds=90),
        )
    if settings.telemetry_interval > 0:
        scheduler.add_job(
            _poll_acs_metrics,
            IntervalTrigger(seconds=settings.telemetry_interval),
            id="acs_metrics",
            replace_existing=True,
            misfire_grace_time=30,
            next_run_time=utcnow() + timedelta(seconds=120),
        )
    scheduler.start()'''

if old_scheduler in content:
    content = content.replace(old_scheduler, new_scheduler)
    print("Added ACS metrics job to scheduler")
else:
    print("Scheduler section not found")
    idx = content.find("if settings.telemetry_interval > 0:")
    if idx >= 0:
        print(content[idx:idx+300])
    else:
        print("Could not find telemetry interval")

with open('/opt/olt-commander/backend/app/services/scheduler.py', 'w') as f:
    f.write(content)