import requests
r = requests.post("https://nexus.qbinternet.com/api/auth/login", json={"username": "admin", "password": "admin123"})
print(f"Status: {r.status_code}")
print(f"Response: {r.json()}")
