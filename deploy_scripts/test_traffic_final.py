import requests

base = "https://nexus.qbinternet.com/api"
r = requests.post(f"{base}/auth/login", json={"username": "admin", "password": "admin123"})
token = r.json()["access_token"]
h = {"Authorization": f"Bearer {token}"}

print("=== START ===")
r = requests.post(f"{base}/subscribers/26070201/traffic/start", headers=h)
print(r.status_code)
d = r.json()
print(f"  subscriber={d['subscriber']}, interface={d['interface']}, status={d['status']}")
if not d["interface"]:
    print("  FAIL: interface still empty!")

import time
print("\n=== POLL ===")
time.sleep(6)
r = requests.get(f"{base}/subscribers/26070201/traffic/samples", headers=h)
d = r.json()
print(f"  status={d['status']}, samples={len(d.get('samples', []))}, elapsed={d['elapsed']}")
if d.get("samples"):
    s = d["samples"][-1]
    print(f"  last sample: rx={s['rx_rate']} bps, tx={s['tx_rate']} bps")

print("\n=== STOP ===")
r = requests.delete(f"{base}/subscribers/26070201/traffic/stop", headers=h)
print(r.status_code, r.json())
