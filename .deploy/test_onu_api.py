import requests
r = requests.post("http://127.0.0.1:8080/api/auth/login", json={"username":"admin","password":"admin123"}, verify=False)
token = r.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# Test get single ONU
r = requests.get("http://127.0.0.1:8080/api/onus/1", headers=headers, verify=False)
print(f"Status: {r.status_code}")
if r.status_code != 200:
    print(f"Error: {r.text}")
else:
    data = r.json()
    print(f"ONU: {data.get('name')} | port={data.get('pon_port')} | status={data.get('status')}")
