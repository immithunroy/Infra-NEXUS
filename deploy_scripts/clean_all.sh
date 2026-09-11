#!/bin/bash
cd /opt/observium

# Check DB connection and port table
echo "=== Observium DB tables ==="
mysql -u observium -p'observium' observium -e "SHOW TABLES LIKE '%port%';" 2>/dev/null

echo "=== Ports table row count ==="
mysql -u observium -p'observium' observium -e "SELECT COUNT(*) as total, SUM(deleted=0) as active, SUM(deleted=1) as deleted FROM ports;" 2>/dev/null

echo "=== localhost device status ==="
mysql -u observium -p'observium' observium -e "SELECT device_id, hostname, status, disabled FROM devices WHERE hostname LIKE '%localhost%' OR device_id=1;" 2>/dev/null

echo "=== Docker volumes ==="
docker volume ls

echo "=== Log rotation ==="
journalctl --vacuum-size=100M 2>/dev/null
find /var/log -name "*.gz" -delete 2>/dev/null
find /var/log -name "*.old" -delete 2>/dev/null
echo "Logs cleaned"
