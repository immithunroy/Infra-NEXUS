import requests

BASE = "http://127.0.0.1:8080"
r = requests.post(f"{BASE}/api/auth/login", json={"username": "admin", "password": "admin123"})
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# Test create NOC
r = requests.post(f"{BASE}/api/noc-pop/nocs", json={"name": "NOC Barishal", "address": "Barishal City", "gps_lat": 22.701, "gps_lng": 90.353}, headers=headers)
print("Create NOC:", r.json())

# Test list NOCs
r = requests.get(f"{BASE}/api/noc-pop/nocs", headers=headers)
print("List NOCs:", r.json())

# Test create POP
r = requests.post(f"{BASE}/api/noc-pop/pops", json={"name": "POP Sadar", "address": "Sadar Road", "gps_lat": 22.715, "gps_lng": 90.370}, headers=headers)
print("Create POP:", r.json())

# Test list POPs
r = requests.get(f"{BASE}/api/noc-pop/pops", headers=headers)
print("List POPs:", r.json())
