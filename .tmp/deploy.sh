#!/bin/bash
set -e

docker builder prune -af 2>&1 | tail -1
docker image prune -af 2>&1 | tail -1

cd /opt/infra-nexus
docker compose up -d --build --force-recreate backend 2>&1 | tail -5

sleep 5
docker logs infra-nexus-backend --tail 3 2>&1
