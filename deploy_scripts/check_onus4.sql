SELECT id, name, olt_id, pon_port, onu_id, state, source, last_seen, serial, mac FROM onus WHERE olt_id = 6 ORDER BY pon_port, onu_id;
