#!/bin/bash
set -e

echo "=== Disk usage ==="
df -h /

echo ""
echo "=== Docker disk usage ==="
docker system df

echo ""
echo "=== Cleaning up ==="
docker builder prune -af 2>&1 | tail -3
docker image prune -af 2>&1 | tail -3
docker volume prune -f 2>&1 | tail -3

echo ""
echo "=== After cleanup ==="
df -h /
docker system df
