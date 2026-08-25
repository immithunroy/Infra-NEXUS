import requests
r = requests.post("http://127.0.0.1:8080/api/auth/login", json={"username":"admin","password":"admin123"}, verify=False)
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# Check map points
points = requests.get("http://127.0.0.1:8080/api/map/points", headers=headers, verify=False).json()
print(f"Map points: {len(points.get('points', []))}")
for p in points.get("points", [])[:10]:
    print(f"  {p['name'][:30]:30s} | status={p['status']:12s} | down_reason={p['down_reason'] or '(none)'}")

# Count by status
from collections import Counter
status_counts = Counter(p['status'] for p in points.get('points', []))
print(f"\nStatus counts: {dict(status_counts)}")
