CREATE TABLE IF NOT EXISTS acs_devices (
    id BIGSERIAL PRIMARY KEY,
    serial_number VARCHAR(128) NOT NULL DEFAULT '',
    manufacturer VARCHAR(128) NOT NULL DEFAULT '',
    oui VARCHAR(32) NOT NULL DEFAULT '',
    product_class VARCHAR(64) NOT NULL DEFAULT '',
    model_name VARCHAR(128) NOT NULL DEFAULT '',
    hardware_version VARCHAR(64) NOT NULL DEFAULT '',
    software_version VARCHAR(64) NOT NULL DEFAULT '',
    ip VARCHAR(64) NOT NULL DEFAULT '',
    mac VARCHAR(32) NOT NULL DEFAULT '',
    subscriber VARCHAR(128) NOT NULL DEFAULT '',
    onu_id BIGINT REFERENCES onus(id) ON DELETE SET NULL,
    online BOOLEAN NOT NULL DEFAULT FALSE,
    last_inform TIMESTAMPTZ,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_cpu DOUBLE PRECISION,
    last_mem_used DOUBLE PRECISION,
    last_mem_total DOUBLE PRECISION,
    last_rx_bytes DOUBLE PRECISION,
    last_tx_bytes DOUBLE PRECISION,
    last_rx_rate DOUBLE PRECISION,
    last_tx_rate DOUBLE PRECISION
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acs_serial ON acs_devices (serial_number);
CREATE INDEX IF NOT EXISTS ix_acs_devices_onu ON acs_devices (onu_id);

CREATE TABLE IF NOT EXISTS acs_parameters (
    id BIGSERIAL PRIMARY KEY,
    device_id BIGINT NOT NULL REFERENCES acs_devices(id) ON DELETE CASCADE,
    name VARCHAR(512) NOT NULL DEFAULT '',
    value TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_acs_param ON acs_parameters (device_id, name);
CREATE INDEX IF NOT EXISTS ix_acs_parameters_dev ON acs_parameters (device_id);

CREATE TABLE IF NOT EXISTS acs_metrics (
    id BIGSERIAL PRIMARY KEY,
    device_id BIGINT NOT NULL REFERENCES acs_devices(id) ON DELETE CASCADE,
    sampled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cpu DOUBLE PRECISION,
    mem_used DOUBLE PRECISION,
    mem_total DOUBLE PRECISION,
    rx_bytes DOUBLE PRECISION,
    tx_bytes DOUBLE PRECISION,
    rx_rate DOUBLE PRECISION,
    tx_rate DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS ix_acs_metrics_dev ON acs_metrics (device_id, sampled_at DESC);

CREATE TABLE IF NOT EXISTS acs_jobs (
    id BIGSERIAL PRIMARY KEY,
    device_id BIGINT NOT NULL REFERENCES acs_devices(id) ON DELETE CASCADE,
    action VARCHAR(32) NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    result TEXT NOT NULL DEFAULT '',
    command_key VARCHAR(64) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_acs_jobs_dev ON acs_jobs (device_id, created_at DESC);
