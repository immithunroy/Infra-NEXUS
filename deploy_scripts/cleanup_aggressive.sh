#!/bin/bash
echo "=== Before cleanup ==="
df -h /

# 1. Delete ALL stale port RRD files in localhost (23k+ files, ~30GB)
echo ""
echo "=== Removing 23k+ stale port RRD files ==="
rm -f /opt/observium/rrd/localhost/port-*.rrd
echo "Done"

# 2. Clean Docker
echo ""
echo "=== Cleaning Docker ==="
docker volume prune -f
docker builder prune -af
docker system prune -af

# 3. Clean Observium logs
echo ""
echo "=== Cleaning Observium logs ==="
truncate -s 0 /opt/observium/logs/observium.log

# 4. Clean journal logs
echo ""
echo "=== Cleaning journal ==="
journalctl --vacuum-size=50M 2>/dev/null

# 5. Clean apt cache
echo ""
echo "=== Cleaning apt cache ==="
apt-get clean 2>/dev/null

# 6. Remove old tmp files
echo ""
echo "=== Cleaning tmp ==="
find /tmp -type f -atime +1 -delete 2>/dev/null

echo ""
echo "=== After cleanup ==="
df -h /
