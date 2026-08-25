import re
with open('/opt/olt-commander/backend/app/api/acs.py', 'r') as f:
    content = f.read()

lines = content.split('\n')
new_lines = []
i = 0
while i < len(lines):
    if 'by_instance: dict[int, dict[str, str]] = {}' in lines[i]:
        new_lines.append('    by_instance: dict[int, dict[str, str]] = {}')
        new_lines.append('    for p in rows:')
        new_lines.append('        # WLANConfiguration.<n>.<Rest...> - handle different vendor paths')
        new_lines.append('        parts = p.name.split(".")')
        new_lines.append('        instance = None')
        new_lines.append('        wlan_idx = -1')
        new_lines.append('        for i2, part in enumerate(parts):')
        new_lines.append('            part_lower = part.lower()')
        new_lines.append('            if part_lower == "wlanconfiguration" and i2 + 1 < len(parts):')
        new_lines.append('                try:')
        new_lines.append('                    instance = int(parts[i2 + 1])')
        new_lines.append('                    wlan_idx = i2')
        new_lines.append('                    break')
        new_lines.append('                except ValueError:')
        new_lines.append('                    pass')
        new_lines.append('            elif part_lower.startswith("wlanconfiguration") and len(part_lower) > len("wlanconfiguration"):')
        new_lines.append('                try:')
        new_lines.append('                    instance = int(part_lower.replace("wlanconfiguration", ""))')
        new_lines.append('                    wlan_idx = i2')
        new_lines.append('                    break')
        new_lines.append('                except ValueError:')
        new_lines.append('                    pass')
        new_lines.append('        if instance is None:')
        new_lines.append('            continue')
        new_lines.append('        if wlan_idx >= 0 and wlan_idx + 2 < len(parts):')
        new_lines.append('            key = ".".join(parts[wlan_idx + 2:]).lower()')
        new_lines.append('        else:')
        new_lines.append('            continue')
        new_lines.append('        by_instance.setdefault(instance, {})[key] = p.value')
        
        while i < len(lines) and 'bands:' not in lines[i] and 'bands: list' not in lines[i]:
            i += 1
        continue
    new_lines.append(lines[i])
    i += 1

with open('/opt/olt-commander/backend/app/api/acs.py', 'w') as f:
    f.write('\n'.join(new_lines))

print('Fixed WiFi parameter parsing')