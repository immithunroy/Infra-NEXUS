#!/bin/bash
cd /opt/observium

# Check if observium has its own DB or uses a container
echo "=== Observium config ==="
cat config.php 2>/dev/null | grep -E 'db_|mysql' | head -10

echo "=== MySQL status ==="
systemctl status mysql 2>/dev/null | head -5 || systemctl status mariadb 2>/dev/null | head -5 || echo "No MySQL/MariaDB service"

echo "=== MySQL databases ==="
mysql -e "SHOW DATABASES;" 2>/dev/null || echo "Cannot connect to MySQL"

echo "=== Observium docker ==="
docker ps -a --filter "name=observium" --format "{{.Names}} {{.Status}}" 2>/dev/null

echo "=== Disk usage after log cleanup ==="
df -h /

echo "=== /opt breakdown ==="
du -sh /opt/observium/rrd 2>/dev/null
du -sh /opt/observium/logs 2>/dev/null
