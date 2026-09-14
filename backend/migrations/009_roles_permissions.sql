-- Migration 009: Roles & Permissions system
-- Creates the roles table with JSON permissions and seeds built-in roles

CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE,
    label VARCHAR(128) NOT NULL DEFAULT '',
    description VARCHAR(256) NOT NULL DEFAULT '',
    permissions TEXT NOT NULL DEFAULT '[]',
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_roles_name ON roles(name);

-- Seed built-in roles with default permissions
-- Permissions use "resource.action" format, e.g. "users.view", "devices.edit"
-- Wildcard: "*.*" = all permissions

INSERT INTO roles (name, label, description, permissions, is_system, is_active) VALUES
('admin', 'Admin', 'Full access to everything',
 '["*.*"]',
 TRUE, TRUE),

('global_write', 'Global Write', 'Read + write everywhere except user management',
 '["users.view","devices.view","devices.edit","devices.delete","onus.view","onus.edit",
   "fiber.view","fiber.edit","fiber.approve","subscribers.view","subscribers.edit",
   "tickets.view","tickets.create","tickets.edit","tickets.close",
   "map.view","map.edit","reports.view","settings.view","settings.edit",
   "scan.execute","test.execute","down.view","down.execute"]',
 TRUE, TRUE),

('global_read', 'Global Read', 'Read-only access to all modules',
 '["users.view","devices.view","onus.view","fiber.view","subscribers.view",
   "tickets.view","map.view","reports.view","settings.view","down.view"]',
 TRUE, TRUE),

('noc', 'NOC', 'Read + network operations (scan, test, down detection)',
 '["users.view","devices.view","devices.edit","onus.view","onus.edit",
   "fiber.view","fiber.edit","subscribers.view","subscribers.edit",
   "tickets.view","tickets.create","tickets.edit",
   "map.view","map.edit","reports.view","settings.view",
   "scan.execute","test.execute","down.view","down.execute"]',
 TRUE, TRUE),

('field_team', 'Field Team', 'Read + update address & GPS only',
 '["devices.view","onus.view","fiber.view","fiber.edit",
   "subscribers.view","tickets.view","tickets.create",
   "map.view","reports.view"]',
 TRUE, TRUE)
ON CONFLICT (name) DO NOTHING;
