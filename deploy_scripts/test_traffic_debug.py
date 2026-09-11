import requests, json

base = "https://nexus.qbinternet.com/api"
r = requests.post(f"{base}/auth/login", json={"username": "admin", "password": "admin123"})
token = r.json()["access_token"]
h = {"Authorization": f"Bearer {token}"}

# Show full error response
r = requests.post(f"{base}/subscribers/26070201/traffic/start", headers=h)
print(f"Status: {r.status_code}")
print(f"Response: {r.json()}")
