import requests
r = requests.post('http://127.0.0.1:8080/api/auth/login', json={'username':'admin','password':'admin123'})
token = r.json()['access_token']
r2 = requests.get('http://127.0.0.1:8080/api/fiber/noc-pop-map', headers={'Authorization': f'Bearer {token}'})
print("Status:", r2.status_code)
print("Response:", r2.json())
