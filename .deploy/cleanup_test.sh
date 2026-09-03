#!/bin/bash
TOKEN=$(curl -s http://localhost:8050/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
echo "=== Reject test TJ ==="
curl -s -X PUT http://localhost:8050/api/approvals/2/reject -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"review_note":"Test cleanup"}'
echo ""
echo "=== Final pending count ==="
curl -s http://localhost:8050/api/approvals/pending-count -H "Authorization: Bearer $TOKEN"
echo ""
