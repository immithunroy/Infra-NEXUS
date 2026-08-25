import requests, sys
r = requests.post("http://127.0.0.1:8080/api/auth/login", json={"username":"admin","password":"admin123"})
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# List cables
cables = requests.get("http://127.0.0.1:8080/api/fiber/cables", headers=headers).json()
for c in cables:
    print(f"Cable {c['id']}: {c['code']} src={c.get('src_tj_id')} dst={c.get('dst_tj_id')} segments={len(c.get('segments',[]))}")

# Delete all existing cables and recreate
for c in cables:
    print(f"Deleting cable {c['id']}...")
    requests.delete(f"http://127.0.0.1:8080/api/fiber/cables/{c['id']}", headers=headers)
    print(f"  Deleted.")

# List TJ boxes
tjs = requests.get("http://127.0.0.1:8080/api/fiber/tj-boxes", headers=headers).json()
for t in tjs:
    print(f"TJ {t['id']}: {t['unique_id']} - {t['name']}")

# Create cable between first two TJs
if len(tjs) >= 2:
    src, dst = tjs[0], tjs[1]
    body = {
        "code": f"{src['unique_id']}>{dst['unique_id']}",
        "core_count": 12,
        "cable_type": "round",
        "src_tj_id": src["id"],
        "dst_tj_id": dst["id"],
    }
    r = requests.post("http://127.0.0.1:8080/api/fiber/cables", json=body, headers=headers)
    new_cable = r.json()
    print(f"Created cable {new_cable['id']}: {new_cable['code']} segments={len(new_cable.get('segments',[]))}")
