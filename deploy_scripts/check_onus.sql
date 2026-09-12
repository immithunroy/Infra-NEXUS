SELECT id, name, olt_id, pon_port, onu_id, state, source, last_seen, serial, mac FROM onus WHERE pon_port = 'EPON0/3' AND onu_id IN (3, 4) ORDER BY onu_id;
SELECT id, name, ip_address, status, last_seen FROM olt_devices WHERE name LIKE '%EPON%1%';
