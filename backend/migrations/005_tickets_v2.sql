-- Ticket module v2: categories, SLA, comments, activity log, templates
-- Run: docker exec -i infra-nexus-db psql -U olt -d infra_nexus < /tmp/005_tickets_v2.sql

-- 1. Extend tickets table
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category VARCHAR(32) DEFAULT '';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS department VARCHAR(32) DEFAULT '';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS customer_satisfaction INTEGER;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_reopened BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS ix_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS ix_tickets_priority ON tickets(priority);
CREATE INDEX IF NOT EXISTS ix_tickets_category ON tickets(category);
CREATE INDEX IF NOT EXISTS ix_tickets_created_at ON tickets(created_at);

-- 2. Ticket comments
CREATE TABLE IF NOT EXISTS ticket_comments (
    id BIGSERIAL PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    body TEXT DEFAULT '',
    is_internal BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_ticket_comments_ticket_id ON ticket_comments(ticket_id);

-- 3. Ticket activity log
CREATE TABLE IF NOT EXISTS ticket_activities (
    id BIGSERIAL PRIMARY KEY,
    ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(32) DEFAULT '',
    field VARCHAR(64) DEFAULT '',
    old_value TEXT DEFAULT '',
    new_value TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_ticket_activities_ticket_id ON ticket_activities(ticket_id);

-- 4. Ticket templates
CREATE TABLE IF NOT EXISTS ticket_templates (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(128) DEFAULT '',
    title VARCHAR(256) DEFAULT '',
    description TEXT DEFAULT '',
    priority VARCHAR(32) DEFAULT 'normal',
    category VARCHAR(32) DEFAULT '',
    department VARCHAR(32) DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
