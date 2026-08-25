import requests
r = requests.post("http://127.0.0.1:8080/api/auth/login", json={"username":"admin","password":"admin123"}, verify=False)
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

cables = requests.get("http://127.0.0.1:8080/api/fiber/cables", headers=headers, verify=False).json()
for c in cables:
    print(f"Deleting old cable {c['id']}: {c['code']}")
    requests.delete(f"http://127.0.0.1:8080/api/fiber/cables/{c['id']}", headers=headers, verify=False)

tjs = requests.get("http://127.0.0.1:8080/api/fiber/tj-boxes", headers=headers, verify=False).json()
print(f"TJ boxes: {len(tjs)}")
for t in tjs:
    print(f"  {t['unique_id']} - {t['name']}")

if len(tjs) >= 2:
    body = {
        "link_name": "Barishal City Trunk",
        "code": "FOC-001",
        "core_count": 12,
        "cable_type": "round",
        "route_type": "driving",
        "src_tj_id": tjs[0]["id"],
        "dst_tj_id": tjs[1]["id"],
        "manufacturer": "FiberHome",
    }
    r = requests.post("http://127.0.0.1:8080/api/fiber/cables", json=body, headers=headers, verify=False)
    c = r.json()
    print(f"Created: {c['link_id']} {c['link_name']} segments={len(c.get('segments',[]))}")
