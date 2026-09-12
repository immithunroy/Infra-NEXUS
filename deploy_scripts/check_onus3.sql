SELECT id, name FROM olt_devices;
SELECT id, name, olt_id, pon_port, onu_id, state, source, last_seen, serial, mac FROM onus WHERE pon_port LIKE '%EPON0/3' AND onu_id IN (3, 4);
SELECT id, name, olt_id, pon_port, onu_id, state, source, last_seen, serial, mac FROM onus WHERE olt_id = 1 AND pon_port LIKE '%EPON0/3%' ORDER BY onu_id LIMIT 20;
