docker exec -i infra-nexus-db psql -U olt -d infra_nexus -t -A -c "SELECT key, value FROM settings WHERE key='timezone';"
