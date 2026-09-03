#!/bin/bash
TOKEN=$(curl -s http://localhost:8050/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
echo "=== Health ==="
curl -s http://localhost:8050/api/health
echo ""
echo "=== Pending Count ==="
curl -s http://localhost:8050/api/approvals/pending-count -H "Authorization: Bearer $TOKEN"
echo ""
echo "=== Approval List ==="
curl -s "http://localhost:8050/api/approvals?status=pending" -H "Authorization: Bearer $TOKEN"
echo ""
echo "=== Submit Test ==="
curl -s -X POST http://localhost:8050/api/approvals/submit -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"entity_type":"tj","action":"create","payload":{"name":"TEST-TJ-001","box_type":"regular_tj","tj_port":8,"capacity":12,"tray_count":1,"lat":22.7,"lng":90.3,"address":"Test Address"}}'
echo ""
echo "=== Pending Count After Submit ==="
curl -s http://localhost:8050/api/approvals/pending-count -H "Authorization: Bearer $TOKEN"
echo ""
