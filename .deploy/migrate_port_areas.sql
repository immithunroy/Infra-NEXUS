CREATE TABLE IF NOT EXISTS port_areas (
    id BIGSERIAL PRIMARY KEY,
    olt_id BIGINT NOT NULL REFERENCES olt_devices(id) ON DELETE CASCADE,
    port VARCHAR(32) NOT NULL DEFAULT '',
    label VARCHAR(128) NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_olt_port_area ON port_areas (olt_id, port);
CREATE INDEX IF NOT EXISTS ix_port_areas_olt ON port_areas (olt_id);
