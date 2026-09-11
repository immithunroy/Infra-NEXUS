#!/bin/bash
cd /opt/observium

echo "=== Before ==="
echo "Port RRDs: $(ls rrd/localhost/port-*.rrd 2>/dev/null | wc -l)"
echo "Ports in DB: $(mysql -u observium -p'ncP05wKEIoUvA9Z' observium -N -e 'SELECT COUNT(*) FROM ports WHERE deleted=0;' 2>/dev/null)"

# Get active port IDs
mysql -u observium -p'ncP05wKEIoUvA9Z' observium -N -e "SELECT port_id FROM ports WHERE deleted=0;" 2>/dev/null | sort -n > /tmp/active_ids.txt

# Remove RRDs not in active list
ACTIVE_COUNT=0
DELETED_COUNT=0
for f in rrd/localhost/port-*.rrd; do
    pid=$(echo "$f" | sed 's/rrd\/localhost\/port-//;s/\.rrd//')
    if grep -qx "$pid" /tmp/active_ids.txt 2>/dev/null; then
        ACTIVE_COUNT=$((ACTIVE_COUNT + 1))
    else
        rm -f "$f"
        DELETED_COUNT=$((DELETED_COUNT + 1))
    fi
done

echo ""
echo "=== After ==="
echo "Kept: $ACTIVE_COUNT active port RRDs"
echo "Deleted: $DELETED_COUNT stale port RRDs"
echo "Remaining: $(ls rrd/localhost/port-*.rrd 2>/dev/null | wc -l)"
echo ""
df -h /
