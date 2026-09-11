import requests

base = "https://nexus.qbinternet.com/api"
r = requests.post(f"{base}/auth/login", json={"username": "admin", "password": "admin123"})
token = r.json()["access_token"]
h = {"Authorization": f"Bearer {token}"}

print("=== START ===")
r = requests.post(f"{base}/subscribers/26070201/traffic/start", headers=h)
print(r.status_code, r.json())

import time
print("\n=== POLL x3 ===")
for i in range(3):
    time.sleep(3)
    r = requests.get(f"{base}/subscribers/26070201/traffic/samples", headers=h)
    d = r.json()
    n = len(d.get("samples", []))
    print(f"  poll {i+1}: status={d['status']}, samples={n}, elapsed={d['elapsed']}, remaining={d['remaining']}")
    if n > 0:
        s = d["samples"][-1]
        print(f"    last: rx={s['rx_rate']} bps ({s['rx_rate']/1024/1024:.2f} Mbps), tx={s['tx_rate']} bps ({s['tx_rate']/1024/1024:.2f} Mbps)")

print("\n=== STOP ===")
r = requests.delete(f"{base}/subscribers/26070201/traffic/stop", headers=h)
print(r.status_code, r.json())
