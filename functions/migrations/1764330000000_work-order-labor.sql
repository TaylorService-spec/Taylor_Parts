-- Up Migration
-- WORK ORDER LABOR (Owner DECISION 7, Work Order cutover completion pass, 2026-09-30).
--
--   "Port the existing accepted Technician labor behavior into the Work Order domain. Preserve existing business
--    semantics where recoverable. Employee is the actor. Work Order assignment/authority remains enforced. Labor
--    records must be auditable/traceable and must not depend on Firebase technician identity. Do not turn this
--    into payroll/timekeeping."
--
-- The Firebase original (functions/src/workOrderLabor/workOrderLaborCommand.ts, `work_order_labor_entries`) records
-- WORK PERFORMED and nothing else: no rate, no cost, no billable flag. Its rules are kept here as constraints:
--
--   * TWO SHAPES, AND THE ROW SAYS WHICH. INTERVAL (started_at + ended_at known; overlap-checkable) or DURATION (a
--     work date and a length; no clock position is invented to fill an interval).
--   * TWO LABOR TYPES: ONSITE and TRAVEL. Nothing a payroll system might later want is pre-invented.
--   * TECHNICAL BOUNDS, NOT HR POLICY: 1 .. 960 minutes (16 hours) per entry.
--   * THE EMPLOYEE, NOT A TECHNICIAN ID. employee_id is the governed Employee whose work this is (the actor-subject);
--     recorded_by_principal_id is the EOS Principal who recorded it. Firebase kept technicianId + recordedByUid for
--     the same reason: "one is who the platform authenticated, the other is who the work is assigned to".
--   * TWO TIMESTAMPS: recorded_at is the server's; device_reported_at is what the phone said, present only when it
--     said something. Neither overwrites the other.
--
-- APPEND-ONLY. Firebase corrected by marking the original REVERSED and creating a replacement. Here the original is
-- never touched at all: a correction is a NEW row naming the entry it corrects (corrects_entry_id), and an entry is
-- REVERSED exactly when some row corrects it -- derived on read, so the history cannot be edited into agreement.
-- UNIQUE (tenant_id, corrects_entry_id) makes "correct the replacement, not the original" structural: an entry can
-- be corrected once, and a correction of a correction chains forward.
--
-- IDEMPOTENT BY KEY, per recording Principal, with the request fingerprint kept so a replay returns the recorded
-- entry and a different request under a reused key refuses.
--
-- ONE CAPABILITY, REGISTERED WITH NO GRANTS: workOrder.labor.correct (workOrder / correctLabor). Firebase kept
-- correcting labor -- including somebody else's -- as a SEPARATE authority from recording it ("a technician fixing
-- their own typo and a manager adjusting a crew's hours are not the same authority even when the keystrokes
-- match"). No existing PostgreSQL capability says that, so the smallest one is defined. Definition is not grant:
-- who holds it is an Administration decision. RECORDING labor reuses workOrder.execution.record (1764300000000)
-- plus RECORD_ASSIGNMENT -- the technician's own-assignment field fact, not a new authority.
--
-- Counts: capabilities +1; role_capabilities +0.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key = 'workOrder.labor.correct' OR (object_key = 'workOrder' AND action_key = 'correctLabor');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_LABOR: workOrder.labor.correct / workOrder.correctLabor is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_workOrder_labor_correct', 'workOrder.labor.correct',
     'Correct a recorded Work Order labor entry -- including another Employee''s -- by appending a replacement that names the entry it corrects. The original is never edited. Records work performed only: no rate, cost or billable value. Granted only through Administration.',
     'workOrder', 'correctLabor', 'BUSINESS_ACTION', 'Correct Work Order Labor')
ON CONFLICT (key) DO NOTHING;

SET search_path = eos_ops, public;

CREATE TABLE work_order_labor_entries (
    id                       TEXT        PRIMARY KEY,
    tenant_id                TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    work_order_id            TEXT        NOT NULL,
    -- WHOSE work this is: the governed Employee. Never a Firebase uid or a fieldops technician id.
    employee_id              TEXT        NOT NULL,
    -- WHO recorded it: the EOS Principal.
    recorded_by_principal_id TEXT        NOT NULL,
    labor_type               TEXT        NOT NULL,
    entry_kind               TEXT        NOT NULL,
    duration_minutes         INTEGER     NOT NULL,
    work_date                DATE        NOT NULL,
    started_at               TIMESTAMPTZ,
    ended_at                 TIMESTAMPTZ,
    notes                    TEXT,
    corrects_entry_id        TEXT,
    idempotency_key          TEXT        NOT NULL,
    request_fingerprint      TEXT        NOT NULL,
    recorded_at              TIMESTAMPTZ NOT NULL,
    device_reported_at       TIMESTAMPTZ,
    CONSTRAINT wo_labor_tenant_identity UNIQUE (tenant_id, id),
    CONSTRAINT wo_labor_work_order_fk FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders (tenant_id, id),
    CONSTRAINT wo_labor_employee_fk FOREIGN KEY (tenant_id, employee_id) REFERENCES eos_workforce.employees (tenant_id, id),
    CONSTRAINT wo_labor_actor_fk FOREIGN KEY (tenant_id, recorded_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT wo_labor_corrects_fk FOREIGN KEY (tenant_id, corrects_entry_id)
        REFERENCES work_order_labor_entries (tenant_id, id),
    CONSTRAINT wo_labor_type_known CHECK (labor_type IN ('ONSITE', 'TRAVEL')),
    CONSTRAINT wo_labor_kind_known CHECK (entry_kind IN ('INTERVAL', 'DURATION')),
    -- Technical bounds, not HR policy (Firebase MIN_LABOR_MINUTES / MAX_LABOR_MINUTES).
    CONSTRAINT wo_labor_duration_bounded CHECK (duration_minutes BETWEEN 1 AND 960),
    CONSTRAINT wo_labor_shape CHECK (
        (entry_kind = 'INTERVAL' AND started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at > started_at)
        OR (entry_kind = 'DURATION' AND started_at IS NULL AND ended_at IS NULL)),
    CONSTRAINT wo_labor_notes_shape CHECK (notes IS NULL OR (btrim(notes) <> '' AND length(notes) <= 2000)),
    CONSTRAINT wo_labor_not_self_correcting CHECK (corrects_entry_id IS NULL OR corrects_entry_id <> id),
    CONSTRAINT wo_labor_key_stated CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 200),
    CONSTRAINT wo_labor_one_request_per_key UNIQUE (tenant_id, recorded_by_principal_id, idempotency_key),
    -- An entry is corrected at most once; a later correction corrects the replacement.
    CONSTRAINT wo_labor_corrected_once UNIQUE (tenant_id, corrects_entry_id)
);

CREATE INDEX work_order_labor_by_work_order ON work_order_labor_entries (tenant_id, work_order_id, recorded_at);
CREATE INDEX work_order_labor_by_employee_day ON work_order_labor_entries (tenant_id, employee_id, work_date);

CREATE FUNCTION work_order_labor_refuse_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'work_order_labor_entries is append-only: a correction is a new entry, never an edit';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER work_order_labor_append_only BEFORE UPDATE OR DELETE ON work_order_labor_entries
    FOR EACH ROW EXECUTE FUNCTION work_order_labor_refuse_change();

-- Down Migration
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capabilities WHERE capability_id = 'cap_workOrder_labor_correct';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_LABOR: refuses to reverse -- workOrder.labor.correct is held by % Role grant(s)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities WHERE capability_id = 'cap_workOrder_labor_correct';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_LABOR: refuses to reverse -- workOrder.labor.correct is held by % direct grant(s)', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions WHERE capability_key = 'workOrder.labor.correct';
        IF v_n > 0 THEN
            RAISE EXCEPTION 'WORK_ORDER_LABOR: refuses to reverse -- % Administration decision(s) name workOrder.labor.correct', v_n;
        END IF;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.work_order_labor_entries;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_LABOR: refuses to reverse -- % labor entr(ies) are field history', v_n;
    END IF;
END
$$;

SET search_path = eos_ops, public;
DROP TRIGGER IF EXISTS work_order_labor_append_only ON work_order_labor_entries;
DROP FUNCTION IF EXISTS work_order_labor_refuse_change();
DROP TABLE IF EXISTS work_order_labor_entries;
DELETE FROM eos_policy.capabilities WHERE id = 'cap_workOrder_labor_correct';
