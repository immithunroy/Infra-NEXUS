-- PostgreSQL trigger on HRM Employee table
-- Sends NOTIFY on channel 'hrm_employee_changed' for any INSERT/UPDATE/DELETE

CREATE OR REPLACE FUNCTION notify_hrm_employee_change() RETURNS trigger AS $$
DECLARE
    payload json;
BEGIN
    IF TG_OP = 'DELETE' THEN
        payload := json_build_object('op', TG_OP, 'id', OLD.id);
    ELSE
        payload := json_build_object('op', TG_OP, 'id', NEW.id);
    END IF;
    PERFORM pg_notify('hrm_employee_changed', payload::text);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_hrm_employee_change ON "Employee";

CREATE TRIGGER trg_hrm_employee_change
    AFTER INSERT OR UPDATE OR DELETE ON "Employee"
    FOR EACH ROW
    EXECUTE FUNCTION notify_hrm_employee_change();
