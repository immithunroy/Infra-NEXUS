-- 011_backup_records.sql
-- Backup & Restore tracking table

CREATE TABLE IF NOT EXISTS backup_records (
    id SERIAL PRIMARY KEY,
    backup_id VARCHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'pending',
    trigger VARCHAR(20) DEFAULT 'manual',
    app_version VARCHAR(32) DEFAULT '',
    total_files INT DEFAULT 0,
    total_records INT DEFAULT 0,
    total_size_bytes BIGINT DEFAULT 0,
    checksum VARCHAR(128) DEFAULT '',
    local_status VARCHAR(20) DEFAULT 'pending',
    cloud_status VARCHAR(20) DEFAULT 'disabled',
    file_details TEXT DEFAULT '[]',
    error_message TEXT DEFAULT '',
    restored_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_backup_records_backup_id ON backup_records(backup_id);
CREATE INDEX IF NOT EXISTS idx_backup_records_created_at ON backup_records(created_at DESC);
