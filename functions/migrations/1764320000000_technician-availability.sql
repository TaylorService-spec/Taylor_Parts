-- Up Migration
-- TECHNICIAN AVAILABILITY (Owner ruling DECISION 5, 2026-09-30: TECHNICIAN AVAILABILITY MODEL APPROVED).
--
-- The SMALLEST PostgreSQL representation governed Service scheduling needs: when an Employee normally works, and
-- when they are unavailable. It is NOT a second Employee identity and NOT an HR / timekeeping system. Every row is
-- keyed by the canonical Employee (eos_workforce.employees (tenant_id, id)); nothing here names a Firebase uid, a
-- fieldops_technicians id, a Principal as the subject, or a Security Role.
--
-- THREE RELATIONS, TWO AUTHORITIES (the Firebase ND-22 split, kept):
--
--   technician_working_schedules   the RECURRING authority's header: one weekly schedule for one Employee, in ONE
--                                  IANA time zone, effective over a DATE range [effective_from, effective_to)
--                                  (effective_to EXCLUSIVE, NULL = open-ended), optionally applicable to ONE
--                                  operating company (NULL = every company the Employee works for).
--   technician_working_hours       the schedule's weekly intervals: weekday (0 = Sunday .. 6 = Saturday, JavaScript
--                                  Date.getDay()), start_time < end_time as LOCAL wall-clock time in the schedule's
--                                  zone (end_time may be 24:00). More than one interval per weekday expresses a gap
--                                  (an unpaid lunch). IMMUTABLE once written: a schedule is replaced, never edited.
--   technician_unavailability      the DATED exception authority: one absolute [starts_at, ends_at) window with a
--                                  closed kind (the Firebase BLOCKED_TIME_KINDS vocabulary, reused -- no second one).
--                                  Overlapping periods are LEGITIMATE (Owner ruling 2026-09-12). Never deleted: an
--                                  unavailability is ENDED (ended_at, clamped to [starts_at, ends_at]); ending it at
--                                  its own start withdraws it entirely, and the withdrawal stays on the record.
--
-- HISTORY IS APPEND / CLOSE-ONLY, AT THE DATABASE. A schedule is ENDED (effective_to set once, with who and why),
-- never edited and never deleted; its interval rows are never updated or deleted; an unavailability is ended once.
-- Triggers below refuse every other UPDATE and every DELETE, so "what did we believe this technician's hours were
-- on the day we scheduled that job" stays answerable.
--
-- ABSENT IS NOT EMPTY, AND ABSENT REFUSES. An Employee with no schedule governing a date has NO CONFIGURED
-- AVAILABILITY there -- not zero hours and not 24/7. DECISION 5: a governed placement for such a date is REFUSED
-- (AVAILABILITY_NOT_CONFIGURED); synthetic acceptance availability is configured explicitly, like any other.
--
-- NO NEW CAPABILITY. Configuring availability is the DISPATCHER-BUCKET act it was in Firebase (schedulingCommands.ts
-- requireDispatcher: the admin/dispatcher bucket that also schedules), so it is governed by the existing
-- workOrder.lifecycle.schedule; reads accept workOrder.lifecycle.schedule or workOrder.lifecycle.dispatch.
--
-- NO SEED ROWS AND NO BACKFILL. Nothing is inferred from Firestore technician_working_availability /
-- technician_blocked_time, from Job Role, or from anything else. Relations start EMPTY.
--
-- Counts: tables +3; capabilities +0; role_capabilities +0.
SET search_path = eos_workforce, public;

CREATE TABLE technician_working_schedules (
    id                        TEXT        PRIMARY KEY,
    tenant_id                 TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    employee_id               TEXT        NOT NULL,
    -- NULL: applies to every operating company. Otherwise applies ONLY to that company's Work Orders.
    operating_company_id      TEXT,
    time_zone                 TEXT        NOT NULL,
    effective_from            DATE        NOT NULL,
    effective_to              DATE,
    recorded_by_principal_id  TEXT        NOT NULL,
    recorded_at               TIMESTAMPTZ NOT NULL,
    reason                    TEXT,
    ended_by_principal_id     TEXT,
    ended_at                  TIMESTAMPTZ,
    end_reason                TEXT,

    CONSTRAINT technician_working_schedules_tenant_scoped_unique UNIQUE (tenant_id, id),
    CONSTRAINT technician_working_schedules_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT technician_working_schedules_recorder_fk FOREIGN KEY (tenant_id, recorded_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT technician_working_schedules_ender_fk FOREIGN KEY (tenant_id, ended_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT technician_working_schedules_zone_present CHECK (btrim(time_zone) <> '' AND length(time_zone) <= 64),
    CONSTRAINT technician_working_schedules_company_shape CHECK (
        operating_company_id IS NULL OR (btrim(operating_company_id) = operating_company_id AND operating_company_id <> '')),
    -- A schedule superseded before it took effect ends ON its own effective_from (a zero-length range): it governed
    -- nothing, and the row says so rather than disappearing.
    CONSTRAINT technician_working_schedules_range_ordered CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT technician_working_schedules_end_is_complete CHECK (
        (effective_to IS NULL AND ended_by_principal_id IS NULL AND ended_at IS NULL AND end_reason IS NULL)
        OR (effective_to IS NOT NULL AND ended_by_principal_id IS NOT NULL AND ended_at IS NOT NULL)),
    CONSTRAINT technician_working_schedules_reason_length CHECK (
        (reason IS NULL OR (btrim(reason) <> '' AND length(reason) <= 500))
        AND (end_reason IS NULL OR (btrim(end_reason) <> '' AND length(end_reason) <= 500)))
);

-- ONE OPEN schedule per (Employee, applicability). Setting a new one ENDS the open one at the new effective_from.
CREATE UNIQUE INDEX technician_working_schedules_one_open
    ON technician_working_schedules (tenant_id, employee_id, COALESCE(operating_company_id, ''))
    WHERE effective_to IS NULL;
CREATE INDEX technician_working_schedules_by_employee
    ON technician_working_schedules (tenant_id, employee_id, effective_from);

CREATE TABLE technician_working_hours (
    id           TEXT     PRIMARY KEY,
    tenant_id    TEXT     NOT NULL,
    schedule_id  TEXT     NOT NULL,
    weekday      SMALLINT NOT NULL,
    start_time   TIME     NOT NULL,
    end_time     TIME     NOT NULL,

    CONSTRAINT technician_working_hours_schedule_fk FOREIGN KEY (tenant_id, schedule_id)
        REFERENCES technician_working_schedules (tenant_id, id),
    CONSTRAINT technician_working_hours_weekday CHECK (weekday BETWEEN 0 AND 6),
    CONSTRAINT technician_working_hours_whole_minutes CHECK (
        EXTRACT(SECOND FROM start_time) = 0 AND EXTRACT(SECOND FROM end_time) = 0),
    CONSTRAINT technician_working_hours_ordered CHECK (end_time > start_time),
    CONSTRAINT technician_working_hours_one_start UNIQUE (tenant_id, schedule_id, weekday, start_time)
);
CREATE INDEX technician_working_hours_by_schedule ON technician_working_hours (tenant_id, schedule_id);

CREATE TABLE technician_unavailability (
    id                        TEXT        PRIMARY KEY,
    tenant_id                 TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    employee_id               TEXT        NOT NULL,
    kind                      TEXT        NOT NULL,
    starts_at                 TIMESTAMPTZ NOT NULL,
    ends_at                   TIMESTAMPTZ NOT NULL,
    reason                    TEXT,
    recorded_by_principal_id  TEXT        NOT NULL,
    recorded_at               TIMESTAMPTZ NOT NULL,
    -- ENDING: the instant the period actually stopped (clamped to [starts_at, ends_at]); = starts_at withdraws it.
    ended_at                  TIMESTAMPTZ,
    ended_by_principal_id     TEXT,
    ended_recorded_at         TIMESTAMPTZ,
    end_reason                TEXT,

    CONSTRAINT technician_unavailability_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES employees (tenant_id, id),
    CONSTRAINT technician_unavailability_recorder_fk FOREIGN KEY (tenant_id, recorded_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT technician_unavailability_ender_fk FOREIGN KEY (tenant_id, ended_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    -- scheduling/types.ts BLOCKED_TIME_KINDS. One vocabulary; widening it is a reviewed migration.
    CONSTRAINT technician_unavailability_kind_known CHECK (
        kind IN ('PTO', 'LUNCH', 'TRAINING', 'MEETING', 'TRUCK_SERVICE', 'UNAVAILABLE', 'COMPANY_CLOSURE')),
    CONSTRAINT technician_unavailability_ordered CHECK (ends_at > starts_at),
    CONSTRAINT technician_unavailability_bounded CHECK (ends_at - starts_at <= interval '90 days'),
    CONSTRAINT technician_unavailability_end_is_complete CHECK (
        (ended_at IS NULL AND ended_by_principal_id IS NULL AND ended_recorded_at IS NULL AND end_reason IS NULL)
        OR (ended_at IS NOT NULL AND ended_by_principal_id IS NOT NULL AND ended_recorded_at IS NOT NULL
            AND ended_at >= starts_at AND ended_at <= ends_at)),
    CONSTRAINT technician_unavailability_reason_length CHECK (
        (reason IS NULL OR (btrim(reason) <> '' AND length(reason) <= 500))
        AND (end_reason IS NULL OR (btrim(end_reason) <> '' AND length(end_reason) <= 500)))
);
CREATE INDEX technician_unavailability_by_employee_window
    ON technician_unavailability (tenant_id, employee_id, starts_at, ends_at);

-- ════════════════════ append / close-only, enforced here ════════════════════

CREATE FUNCTION technician_working_schedules_keep_history() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'technician_working_schedules keeps history: a schedule is ENDED, never deleted';
    END IF;
    IF OLD.effective_to IS NOT NULL THEN
        RAISE EXCEPTION 'technician_working_schedules keeps history: an ended schedule is immutable';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.operating_company_id IS DISTINCT FROM OLD.operating_company_id
       OR NEW.time_zone IS DISTINCT FROM OLD.time_zone OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.recorded_by_principal_id IS DISTINCT FROM OLD.recorded_by_principal_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.effective_to IS NULL THEN
        RAISE EXCEPTION 'technician_working_schedules keeps history: the only permitted change ends an open schedule';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER technician_working_schedules_keep_history
    BEFORE UPDATE OR DELETE ON technician_working_schedules
    FOR EACH ROW EXECUTE FUNCTION technician_working_schedules_keep_history();

CREATE FUNCTION technician_working_hours_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'technician_working_hours is immutable: a schedule is replaced by a new one, never edited';
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER technician_working_hours_immutable
    BEFORE UPDATE OR DELETE ON technician_working_hours
    FOR EACH ROW EXECUTE FUNCTION technician_working_hours_immutable();

CREATE FUNCTION technician_unavailability_keep_history() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'technician_unavailability keeps history: an unavailability is ENDED, never deleted';
    END IF;
    IF OLD.ended_at IS NOT NULL THEN
        RAISE EXCEPTION 'technician_unavailability keeps history: an ended unavailability is immutable';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.recorded_by_principal_id IS DISTINCT FROM OLD.recorded_by_principal_id
       OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at OR NEW.ended_at IS NULL THEN
        RAISE EXCEPTION 'technician_unavailability keeps history: the only permitted change ends an open unavailability';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;
CREATE TRIGGER technician_unavailability_keep_history
    BEFORE UPDATE OR DELETE ON technician_unavailability
    FOR EACH ROW EXECUTE FUNCTION technician_unavailability_keep_history();

-- Down Migration
-- REFUSE, NEVER DESTROY: availability history is the record of what every placement was checked against.
DO $$
DECLARE
    v_schedules BIGINT;
    v_unavailable BIGINT;
BEGIN
    SELECT count(*) INTO v_schedules FROM eos_workforce.technician_working_schedules;
    SELECT count(*) INTO v_unavailable FROM eos_workforce.technician_unavailability;
    IF v_schedules > 0 OR v_unavailable > 0 THEN
        RAISE EXCEPTION 'TECHNICIAN_AVAILABILITY: refuses to reverse -- % working schedule(s) and % unavailability record(s) are scheduling history',
            v_schedules, v_unavailable
            USING HINT = 'Export the history deliberately first, or do not reverse it.';
    END IF;
END
$$;

SET search_path = eos_workforce, public;
DROP TRIGGER IF EXISTS technician_unavailability_keep_history ON technician_unavailability;
DROP TRIGGER IF EXISTS technician_working_hours_immutable ON technician_working_hours;
DROP TRIGGER IF EXISTS technician_working_schedules_keep_history ON technician_working_schedules;
DROP FUNCTION IF EXISTS technician_unavailability_keep_history();
DROP FUNCTION IF EXISTS technician_working_hours_immutable();
DROP FUNCTION IF EXISTS technician_working_schedules_keep_history();
DROP TABLE IF EXISTS technician_unavailability;
DROP TABLE IF EXISTS technician_working_hours;
DROP TABLE IF EXISTS technician_working_schedules;
