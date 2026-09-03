#!/bin/bash
set -e

docker exec infra-nexus-backend python -c "
import urllib.request, json, uuid

# Login
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

# === Test 1: Subscriber photo ===
print('=== TEST 1: Subscriber photo (approval #7) ===')
r = upload('user', 7)
print('Upload:', r)

# Check DB
import urllib.request as ur
r2 = ur.Request('http://127.0.0.1:8080/api/photos/subscriber/17051602', headers=headers)
result = json.loads(ur.urlopen(r2).read())
uploaded = [p for p in result['photos'] if p.get('uploaded')]
print('Field photos:', len(uploaded), 'of', result['total_required'])
for p in uploaded:
    print('  ', p['photo_type'], '-', p['url'])

# === Test 2: TJ photo ===
print()
print('=== TEST 2: TJ photo (approval #1 - tj) ===')
# Find a TJ approval
r3 = ur.Request('http://127.0.0.1:8080/api/approvals/?status=pending&entity_type=tj&limit=1', headers=headers)
try:
    pending = json.loads(ur.urlopen(r3).read())
    if isinstance(pending, list) and pending:
        tj_id = pending[0]['id']
        print('Found pending TJ approval:', tj_id)
        r = upload('tj_box', tj_id)
        print('Upload:', r)
        # Check pending dir
        import os
        print('Pending dir exists:', os.path.exists(f'/app/uploads/pending-photos/{tj_id}'))
    else:
        print('No pending TJ approvals found - checking all TJ approvals...')
        r4 = ur.Request('http://127.0.0.1:8080/api/approvals/?entity_type=tj&limit=5', headers=headers)
        all_tj = json.loads(ur.urlopen(r4).read())
        if isinstance(all_tj, list):
            for a in all_tj:
                print(f'  #{a[\"id\"]} status={a[\"status\"]} photos_json={a.get(\"photos_json\",\"[]\")[:50]}')
except Exception as e:
    print('Error:', e)
"
