#!/bin/bash
set -e

docker exec infra-nexus-backend python -c "
import urllib.request, json, uuid, os

req = urllib.request.Request('http://127.0.0.1:8080/api/auth/login',
    data=json.dumps({'username':'admin','password':'admin123'}).encode(),
    headers={'Content-Type':'application/json'})
token = json.loads(urllib.request.urlopen(req).read())['access_token']
headers = {'Authorization': 'Bearer ' + token}

def upload(category, entity_id):
    jpeg = bytes([0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0xFF,0xD9])
    b = uuid.uuid4().hex
    body = ('--'+b+'\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n').encode()+jpeg+('\r\n--'+b+'\r\nContent-Disposition: form-data; name=\"category\"\r\n\r\n'+category+'\r\n--'+b+'\r\nContent-Disposition: form-data; name=\"entity_id\"\r\n\r\n'+str(entity_id)+'\r\n--'+b+'--\r\n').encode()
    r = urllib.request.Request('http://127.0.0.1:8080/api/approvals/upload-photo', data=body,
        headers={**headers, 'Content-Type': 'multipart/form-data; boundary='+b})
    return json.loads(urllib.request.urlopen(r).read())

# Upload 3 subscriber photos
print('=== Upload 3 subscriber photos ===')
for i in range(3):
    r = upload('user', 7)
    print(f'  #{i+1}: {r}')

# Check list API
r2 = urllib.request.Request('http://127.0.0.1:8080/api/photos/subscriber/17051602', headers=headers)
result = json.loads(urllib.request.urlopen(r2).read())
print(f'  totalUploaded: {result[\"totalUploaded\"]} of {result[\"total_required\"]}')
for p in result['photos']:
    print(f'    {p[\"photo_type\"]}: uploaded={p[\"uploaded\"]}')

# Verify file serving
for pt in ['overall', 'equipment', 'identification']:
    try:
        r3 = urllib.request.Request(f'http://127.0.0.1:8080/api/photos/file/subscriber/17051602/{pt}.jpg', headers=headers)
        resp = urllib.request.urlopen(r3)
        print(f'  Serve {pt}: {resp.status} ({len(resp.read())} bytes)')
    except Exception as e:
        print(f'  Serve {pt}: ERROR {e}')

# Check DB and disk consistency
print()
print('=== DB vs Disk ===')
for root, dirs, files in os.walk('/app/uploads/field-photos/'):
    for f in files:
        full = os.path.join(root, f)
        rel = full.replace('/app/uploads/field-photos/', '')
        size = os.path.getsize(full)
        print(f'  DISK: {rel} ({size} bytes)')
"
