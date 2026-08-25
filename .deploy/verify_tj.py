import requests
r = requests.post("http://127.0.0.1:8080/api/auth/login", json={"username":"admin","password":"admin123"}, verify=False)
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

tjs = requests.get("http://127.0.0.1:8080/api/fiber/tj-boxes", headers=headers, verify=False).json()
print(f"TJ Boxes: {len(tjs)}")
for t in tjs:
    print(f"  {t['unique_id']} | {t['name']} | type={t['box_type']} | port={t.get('tj_port','-')} | cap={t['capacity']} | trays={t['tray_count']}")

# Create a test TJ to verify
body = {"name": "Test TJ", "box_type": "dome", "tj_port": 8, "capacity": 24, "tray_count": 4, "lat": 22.71, "lng": 90.37}
r = requests.post("http://127.0.0.1:8080/api/fiber/tj-boxes", json=body, headers=headers, verify=False)
t = r.json()
print(f"\nCreated: {t['unique_id']} | {t['name']} | type={t['box_type']} | port={t.get('tj_port','-')} | cap={t['capacity']}")
# Delete test
requests.delete(f"http://127.0.0.1:8080/api/fiber/tj-boxes/{t['id']}", headers=headers, verify=False)
print("Test TJ deleted.")
