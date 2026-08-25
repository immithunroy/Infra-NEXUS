#!/usr/bin/env python3
"""Quick test for rejected ONU API endpoint."""
import requests
import json
import sys

BASE = "http://localhost:8080"

# Login
r = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
if r.status_code != 200:
    print(f"LOGIN FAILED: {r.status_code} {r.text}")
    sys.exit(1)
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# List OLTs
r = requests.get(f"{BASE}/api/devices/olts", headers=headers)
olts = r.json()
print(f"OLTs found: {len(olts)}")
for o in olts:
    print(f"  id={o['id']} name={o['name']} ip={o['ip']} vendor={o.get('vendor','')}")

# Try rejected endpoint for each OLT
for o in olts:
    print(f"\n--- Discovering rejected ONUs on {o['name']} (id={o['id']}) ---")
    try:
        r = requests.get(f"{BASE}/api/devices/olts/{o['id']}/rejected", headers=headers, timeout=120)
        if r.status_code == 200:
            rejected = r.json()
            print(f"  Found {len(rejected)} rejected ONUs")
            for rr in rejected[:5]:
                print(f"    PON={rr['pon_port']} ONU={rr['onu_id']} SN={rr['serial']} reason={rr['reason']}")
        else:
            print(f"  ERROR {r.status_code}: {r.text[:200]}")
    except Exception as e:
        print(f"  EXCEPTION: {e}")
