#!/bin/bash
set -e

echo "=== ALL logs from 11:55 to now ==="
docker logs infra-nexus-backend --since "2026-09-01T11:55:00" 2>&1 | tail -40
