import urllib.request, json

base = "http://127.0.0.1:8080"
data = json.dumps({"username":"admin","password":"admin123"}).encode()
req = urllib.request.Request(f"{base}/api/auth/login", data=data, headers={"Content-Type":"application/json"})
resp = json.loads(urllib.request.urlopen(req).read())
token = resp["access_token"]
h = {"Authorization": f"Bearer {token}"}

# Get ONUs with various distance ranges
req2 = urllib.request.Request(f"{base}/api/onus?limit=2000", headers=h)
onus = json.loads(urllib.request.urlopen(req2).read())

distances = [o['distance'] for o in onus if o.get('distance') is not None]
print(f"Total ONUs with distance: {len(distances)}")
print(f"Min: {min(distances)}, Max: {max(distances)}, Avg: {sum(distances)/len(distances):.2f}")

# Check for any that look like meters (> 10 km would be suspicious for GPON/EPON)
big = [d for d in distances if d > 10]
if big:
    print(f"\nValues > 10 (possible meters?): {sorted(set(big))}")
else:
    print("\nNo values > 10 km (all look like km)")

# Check cable lengths from DB
req3 = urllib.request.Request(f"{base}/api/fiber/cables?limit=5", headers=h)
try:
    cables = json.loads(urllib.request.urlopen(req3).read())
    print(f"\n=== Cable info (first 5) ===")
    for c in cables:
        print(f"  {c.get('code')}: segments={len(c.get('segments', []))}")
except Exception as e:
    print(f"Cable error: {e}")
    if hasattr(e, 'read'):
        print(e.read().decode()[:500])

# Check map points link_length
req4 = urllib.request.Request(f"{base}/api/map/points?limit=3", headers=h)
try:
    points = json.loads(urllib.request.urlopen(req4).read())
    print(f"\n=== Map points (first 3) ===")
    for p in points[:3]:
        print(f"  {p.get('name')}: distance={p.get('distance')}, type={p.get('type')}")
except Exception as e:
    print(f"Map points error: {e}")
    if hasattr(e, 'read'):
        print(e.read().decode()[:500])
