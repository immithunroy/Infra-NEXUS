-- Migration 008: HRM user sync — extend users table
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS hrm_id VARCHAR(64) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_hrm_id ON users(hrm_id) WHERE hrm_id != '';

-- Store HRM DB config in settings table
INSERT INTO settings (key, value) VALUES
  ('hrm_db_host', 'db'),
  ('hrm_db_port', '5432'),
  ('hrm_db_name', 'zkt_payroll'),
  ('hrm_db_user', 'postgres'),
  ('hrm_db_password', 'postgres')
ON CONFLICT (key) DO NOTHING;

COMMIT;
