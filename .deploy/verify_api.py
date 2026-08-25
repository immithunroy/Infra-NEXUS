import requests
r = requests.post("http://127.0.0.1:8080/api/auth/login", json={"username":"admin","password":"admin123"}, verify=False)
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

cables = requests.get("http://127.0.0.1:8080/api/fiber/cables", headers=headers, verify=False).json()
print(f"Cables: {len(cables)}")
for c in cables:
    print(f"  {c['link_id']} | {c['link_name']} | cores={c['core_count']} | route={c['route_type']} | segs={len(c.get('segments',[]))} | src={c.get('src_tj_id')} dst={c.get('dst_tj_id')}")

tjs = requests.get("http://127.0.0.1:8080/api/fiber/tj-boxes", headers=headers, verify=False).json()
print(f"TJ Boxes: {len(tjs)}")
for t in tjs:
    print(f"  {t['unique_id']} - {t['name']} ({t['lat']}, {t['lng']})")
