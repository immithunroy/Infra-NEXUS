ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'admin';
-- Backfill: users flagged is_admin keep admin; others default to global_read.
UPDATE users SET role = 'admin' WHERE is_admin = TRUE AND role = 'admin';
UPDATE users SET role = 'global_read' WHERE is_admin = FALSE AND role = 'admin';
