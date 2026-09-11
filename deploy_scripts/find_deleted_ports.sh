#!/bin/bash
cd /opt/observium

# Get active port IDs from DB
echo "Getting active port IDs from DB..."
mysql -u observium -p'observium' observium -N -e "SELECT port_id FROM ports WHERE deleted=0;" 2>/dev/null | sort -n > /tmp/active_ports.txt
ACTIVE=$(wc -l < /tmp/active_ports.txt)
echo "Active ports in DB: $ACTIVE"

# Get all RRD port file IDs
ls rrd/localhost/port-*.rrd 2>/dev/null | sed 's/rrd\/localhost\/port-//;s/\.rrd//' | sort -n > /tmp/rrd_ports.txt
TOTAL=$(wc -l < /tmp/rrd_ports.txt)
echo "Total port RRD files: $TOTAL"

# Find which RRD files are NOT in active list (using comm)
comm -23 /tmp/rrd_ports.txt /tmp/active_ports.txt > /tmp/deleted_ports.txt
DELETED=$(wc -l < /tmp/deleted_ports.txt)
echo "Deleted/stale port RRD files: $DELETED"

# Calculate size of deleted files
echo "Calculating size of stale RRD files..."
du -ch $(cat /tmp/deleted_ports.txt | head -1000 | sed 's/^/rrd\/localhost\/port-/;s/$/.rrd/') 2>/dev/null | tail -1
echo "(sampling first 1000 files)"

echo ""
echo "Ready to delete $DELETED stale port RRD files"
echo "Run with --delete flag to actually remove them"
