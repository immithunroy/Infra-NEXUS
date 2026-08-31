-- Migration: Extend fiber_approval_requests for centralized NOC approval queue
-- Run this on the production database before deploying the new code

-- Add new columns for the centralized approval system
ALTER TABLE fiber_approval_requests ADD COLUMN IF NOT EXISTS submitted_by_name VARCHAR(128) DEFAULT '';
ALTER TABLE fiber_approval_requests ADD COLUMN IF NOT EXISTS previous_data_json TEXT DEFAULT '';
ALTER TABLE fiber_approval_requests ADD COLUMN IF NOT EXISTS priority VARCHAR(16) DEFAULT 'normal';
ALTER TABLE fiber_approval_requests ADD COLUMN IF NOT EXISTS correction_note TEXT DEFAULT '';
ALTER TABLE fiber_approval_requests ADD COLUMN IF NOT EXISTS photos_json TEXT DEFAULT '[]';
ALTER TABLE fiber_approval_requests ADD COLUMN IF NOT EXISTS location_json TEXT DEFAULT '';
ALTER TABLE fiber_approval_requests ADD COLUMN IF NOT EXISTS resubmitted_at TIMESTAMP WITH TIME ZONE;

-- Widen status column to accommodate new statuses (returned_for_correction, resubmitted)
ALTER TABLE fiber_approval_requests ALTER COLUMN status TYPE VARCHAR(32);

-- Widen entity_type column to accommodate new types (tj_splitter, user, user_location, etc.)
ALTER TABLE fiber_approval_requests ALTER COLUMN entity_type TYPE VARCHAR(32);

-- Create upload directory (run on the Docker host, not in DB)
-- mkdir -p /opt/infra-nexus/uploads/approval-photos
