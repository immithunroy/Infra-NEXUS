-- Field photos table for TJ and Subscriber documentation
-- Run on the Docker host: mkdir -p /opt/infra-nexus/uploads/field-photos

CREATE TABLE IF NOT EXISTS field_photos (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(32) NOT NULL,
    entity_id VARCHAR(128) NOT NULL,
    photo_type VARCHAR(32) NOT NULL,
    storage_key VARCHAR(256) NOT NULL,
    original_filename VARCHAR(256) DEFAULT '',
    mime_type VARCHAR(64) DEFAULT 'image/jpeg',
    file_size INTEGER DEFAULT 0,
    width INTEGER DEFAULT 0,
    height INTEGER DEFAULT 0,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    captured_at TIMESTAMPTZ,
    captured_by VARCHAR(128) DEFAULT '',
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_photos_entity ON field_photos (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_field_photos_entity_type ON field_photos (entity_type, entity_id, photo_type);
