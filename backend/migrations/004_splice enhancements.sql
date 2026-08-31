-- Migration 004: Extend Splice model for splitter support and tray assignment
-- Date: 2026-08-31

-- Add splitter support to splices
-- A splice can now connect: cable<->cable, cable<->splitter, splitter<->cable, splitter<->splitter

ALTER TABLE splices ADD COLUMN splitter_a_id INTEGER REFERENCES splitters(id) ON DELETE SET NULL;
ALTER TABLE splices ADD COLUMN splitter_b_id INTEGER REFERENCES splitters(id) ON DELETE SET NULL;

-- Port numbers for splitter connections (input=0, output=1,2,3...)
ALTER TABLE splices ADD COLUMN port_a INTEGER DEFAULT 0;
ALTER TABLE splices ADD COLUMN port_b INTEGER DEFAULT 0;

-- Tray assignment for splice tray visualization
ALTER TABLE splices ADD COLUMN tray_id INTEGER DEFAULT 1;

-- Index for faster queries
CREATE INDEX ix_splices_splitter_a ON splices(splitter_a_id);
CREATE INDEX ix_splices_splitter_b ON splices(splitter_b_id);
