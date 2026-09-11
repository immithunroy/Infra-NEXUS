import requests, json, time

base = "https://nexus.qbinternet.com/api"
r = requests.post(f"{base}/auth/login", json={"username": "admin", "password": "admin123"})
token = r.json()["access_token"]
h = {"Authorization": f"Bearer {token}"}

print("=== START (subscriber 26031101 - currently active) ===")
r = requests.post(f"{base}/subscribers/26031101/traffic/start", headers=h)
print(f"Status: {r.status_code}")
d = r.json()
print(f"  subscriber={d.get('subscriber')}, interface={d.get('interface')}, status={d.get('status')}")

if r.status_code == 200:
    print("\n=== WAIT 8s for first samples ===")
    time.sleep(8)
    r = requests.get(f"{base}/subscribers/26031101/traffic/samples", headers=h)
    d = r.json()
    print(f"  status={d['status']}, samples={len(d.get('samples', []))}, elapsed={d['elapsed']}")
    for i, s in enumerate(d.get("samples", [])[-3:]):
        print(f"  sample: rx={s['rx_rate']} bps ({s['rx_rate']/1024:.1f} Kbps), tx={s['tx_rate']} bps ({s['tx_rate']/1024:.1f} Kbps)")

    print("\n=== STOP ===")
    r = requests.delete(f"{base}/subscribers/26031101/traffic/stop", headers=h)
    print(f"  {r.status_code}: {r.json()}")
