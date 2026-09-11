#!/bin/bash
echo "=== Observium ports status ==="
mysql -u observium -p'ncP05wKEIoUvA9Z' observium -e "SELECT COUNT(*) as total, SUM(deleted=0) as active, SUM(deleted=1) as deleted FROM ports;" 2>/dev/null

echo ""
echo "=== Port RRD files remaining ==="
ls /opt/observium/rrd/localhost/port-*.rrd 2>/dev/null | wc -l

echo ""
echo "=== Current disk ==="
df -h /

echo ""
echo "=== Running housekeeping now ==="
cd /opt/observium
php housekeeping.php -yrptb 2>&1 | tail -20

echo ""
echo "=== Port RRD files after housekeeping ==="
ls rrd/localhost/port-*.rrd 2>/dev/null | wc -l

echo ""
echo "=== Disk after ==="
df -h /
