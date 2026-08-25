import requests, json, sys

r = requests.post("http://127.0.0.1:8080/api/auth/login", json={"username": "admin", "password": "admin123"})
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# Test subscriber profile
r2 = requests.get("http://127.0.0.1:8080/api/subscribers/17040102", headers=headers)
print(f"Profile: {r2.status_code}")
if r2.status_code != 200:
    print(r2.text[:500])
else:
    d = r2.json()
    print(f"  subscriber={d.get('subscriber')}, onu_id={d.get('onu_id')}, telemetry_pts={len(d.get('telemetry', []))}")

# Test telemetry endpoint
r3 = requests.get("http://127.0.0.1:8080/api/subscribers/17040102/telemetry?hours=24", headers=headers)
print(f"Telemetry: {r3.status_code}")
if r3.status_code != 200:
    print(r3.text[:500])
else:
    pts = r3.json()
    print(f"  points={len(pts)}")
