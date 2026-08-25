import re
with open('/opt/olt-commander/backend/app/services/acs.py', 'r') as f:
    content = f.read()

# Add uuid import
old_imports = """from __future__ import annotations

import json
import logging
import re"""

new_imports = """from __future__ import annotations

import json
import logging
import re
import uuid"""

if old_imports in content:
    content = content.replace(old_imports, new_imports)
    print("Added uuid import")
else:
    print("Import section not found")

with open('/opt/olt-commander/backend/app/services/acs.py', 'w') as f:
    f.write(content)