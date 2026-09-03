#!/bin/bash
set -e

docker exec infra-nexus-backend python -c "
import urllib.request, json, uuid

# Login
req = urllib.request.Request('http://127.0.0.1:8080/api/auth/login',
    data=json.dumps({'username':'admin','password':'admin123'}).encode(),
    headers={'Content-Type':'application/json'})
resp = urllib.request.urlopen(req)
token = json.loads(resp.read())['access_token']
print('1. Logged in')

# Create JPEG
jpeg = bytes([0xFF,0xD8,0xFF,0xE0,0x00,0x10,0x4A,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0xFF,0xD9])
boundary = uuid.uuid4().hex
body = (
    '--' + boundary + '\r\nContent-Disposition: form-data; name=\"file\"; filename=\"test.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n'
).encode() + jpeg + ('\r\n--' + boundary + '\r\nContent-Disposition: form-data; name=\"category\"\r\n\r\nuser\r\n--' + boundary + '\r\nContent-Disposition: form-data; name=\"entity_id\"\r\n\r\n7\r\n--' + boundary + '--\r\n').encode()

req2 = urllib.request.Request('http://127.0.0.1:8080/api/approvals/upload-photo',
    data=body,
    headers={
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
    })
resp2 = urllib.request.urlopen(req2)
result = json.loads(resp2.read())
print('2. Upload:', result)

# Check field photos API
req3 = urllib.request.Request('http://127.0.0.1:8080/api/photos/subscriber/17051602',
    headers={'Authorization': 'Bearer ' + token})
resp3 = urllib.request.urlopen(req3)
photos = json.loads(resp3.read())
uploaded = [p for p in photos.get('photos', []) if p.get('uploaded')]
print('3. Uploaded photos:', len(uploaded), 'of', photos.get('total_required'))
for p in uploaded:
    print('   -', p['photo_type'], ':', p['url'])
"
