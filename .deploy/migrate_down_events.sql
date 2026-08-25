CREATE TABLE IF NOT EXISTS onu_down_events (
    id BIGSERIAL PRIMARY KEY,
    olt_id BIGINT NOT NULL REFERENCES olt_devices(id) ON DELETE CASCADE,
    olt_name VARCHAR(128) NOT NULL DEFAULT '',
    pon_port VARCHAR(32) NOT NULL DEFAULT '',
    onu_id INTEGER NOT NULL DEFAULT 0,
    serial VARCHAR(64) NOT NULL DEFAULT '',
    name VARCHAR(256) NOT NULL DEFAULT '',
    kind VARCHAR(16) NOT NULL DEFAULT 'down',
    reason VARCHAR(64) NOT NULL DEFAULT '',
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_seconds INTEGER,
    outage_id BIGINT
);
CREATE INDEX IF NOT EXISTS ix_onu_down_events_olt ON onu_down_events (olt_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS ix_onu_down_events_port ON onu_down_events (pon_port, detected_at DESC);
CREATE INDEX IF NOT EXISTS ix_onu_down_events_outage ON onu_down_events (outage_id);

CREATE TABLE IF NOT EXISTS onu_outages (
    id BIGSERIAL PRIMARY KEY,
    olt_id BIGINT NOT NULL REFERENCES olt_devices(id) ON DELETE CASCADE,
    olt_name VARCHAR(128) NOT NULL DEFAULT '',
    pon_port VARCHAR(32) NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    onu_count INTEGER NOT NULL DEFAULT 0,
    resolved_at TIMESTAMPTZ,
    resolved BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS ix_onu_outages_olt ON onu_outages (olt_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_onu_outages_port ON onu_outages (pon_port, started_at DESC);
