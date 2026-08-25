import urllib.request, json

req = urllib.request.Request("http://127.0.0.1:8080/api/auth/login",
    data=json.dumps({"username":"admin","password":"admin123"}).encode(),
    headers={"Content-Type":"application/json"})
token = json.loads(urllib.request.urlopen(req).read())["access_token"]

for ep in ["cables", "tj-boxes", "splitters"]:
    req2 = urllib.request.Request(f"http://127.0.0.1:8080/api/fiber/{ep}",
        headers={"Authorization": f"Bearer {token}"})
    data = json.loads(urllib.request.urlopen(req2).read())
    print(f"{ep}: {len(data)} items")

print("OK")
