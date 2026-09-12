-- Migration 007: tickets v4 — ticket_ref, comment_type, history filters
BEGIN;

-- Add ticket_ref column (TT-YYMMDDNNN format)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ticket_ref VARCHAR(20) NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS ix_tickets_ticket_ref ON tickets(ticket_ref) WHERE ticket_ref != '';

-- Add comment_type column to ticket_comments
ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS comment_type VARCHAR(32) NOT NULL DEFAULT 'general';

-- Backfill ticket_ref for existing tickets (sequential by created_at)
DO $$
DECLARE
    rec RECORD;
    cnt INTEGER := 0;
    prev_date TEXT := '';
    day_seq INTEGER := 0;
BEGIN
    FOR rec IN SELECT id, created_at FROM tickets ORDER BY created_at ASC LOOP
        IF TO_CHAR(rec.created_at, 'YYMMDD') != prev_date THEN
            prev_date := TO_CHAR(rec.created_at, 'YYMMDD');
            day_seq := 0;
        END IF;
        day_seq := day_seq + 1;
        UPDATE tickets SET ticket_ref = 'TT-' || TO_CHAR(rec.created_at, 'YYMMDD') || LPAD(day_seq::TEXT, 3, '0')
        WHERE id = rec.id;
    END LOOP;
END $$;

-- Backfill comment_type from is_internal
UPDATE ticket_comments SET comment_type = 'employee' WHERE is_internal = TRUE AND comment_type = 'general';

COMMIT;
