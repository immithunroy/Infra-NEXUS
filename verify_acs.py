from app.services.acs import _should_poll_monitoring, _MONITOR_PARAMS
print(f'_should_poll_monitoring exists: True')
print(f'_MONITOR_PARAMS count: {len(_MONITOR_PARAMS)}')
print(f'_MONITOR_PARAMS has WiFi params: {any("WLANConfiguration" in p for p in _MONITOR_PARAMS)}')
print(f'_MONITOR_PARAMS has TotalBytes params: {any("TotalBytes" in p for p in _MONITOR_PARAMS)}')