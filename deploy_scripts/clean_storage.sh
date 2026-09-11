#!/bin/bash
echo "=== Port RRD files in localhost ==="
ls /opt/observium/rrd/localhost/port-*.rrd 2>/dev/null | wc -l

echo "=== Port RRD total size ==="
du -sh /opt/observium/rrd/localhost/port-*.rrd 2>/dev/null | awk '{sum += $1} END {print sum "M"}'

echo "=== Count dirs in localhost ==="
ls -d /opt/observium/rrd/localhost/*/ 2>/dev/null | wc -l

echo "=== Top 10 biggest in localhost ==="
du -sh /opt/observium/rrd/localhost/* 2>/dev/null | sort -rh | head -10

echo "=== Docker sizes ==="
docker system df 2>/dev/null

echo "=== Journal logs size ==="
journalctl --disk-usage 2>/dev/null

echo "=== /var/cache ==="
du -sh /var/cache/* 2>/dev/null | sort -rh | head -5

echo "=== Observium deleted ports in DB ==="
cd /opt/observium && php includes/html/table/port.inc.php 2>/dev/null || true
