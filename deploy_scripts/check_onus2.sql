SELECT id, name, olt_id, pon_port, onu_id, state, source, last_seen, serial, mac FROM onus WHERE name LIKE '%OXM%' OR pon_port LIKE '%0/3%' LIMIT 20;
SELECT id, name, status, last_seen FROM olt_devices;
