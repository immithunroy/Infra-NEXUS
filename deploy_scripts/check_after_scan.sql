SELECT id, name, olt_id, pon_port, onu_id, state, source, last_seen, mac FROM onus WHERE olt_id = 6 AND pon_port LIKE '%EPON0/3%' ORDER BY onu_id;
