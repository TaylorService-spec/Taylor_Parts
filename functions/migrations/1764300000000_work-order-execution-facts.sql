-- Up Migration
-- WORK ORDER EXECUTION FACTS (Controller: WORK ORDER DOMAIN CUTOVER AUTHORIZATION, 2026-09-30).
--
-- The technician records two things on site that the governed PostgreSQL Work Order could not hold:
--
--     * the ACTUAL quantity of each planned Part used (Firebase: inventorySnapshot[].qtyUsed, written by the
--       execution-capture callable as a DELTA per Part, clamped to [0, qtyPlanned]);
--     * a free-text execution note (Firebase: executionNote, appended).
--
-- ONE APPEND-ONLY RELATION, not two mutable columns. A qty_used column on work_order_parts_plan would be
-- overwritten by every correction, and the plan authority (workOrderPartsPlanAuthority.ts) deliberately has no
-- usage column: a PLAN is what the office intends and an ACTUAL is what the technician did, and a row that held
-- both would let one rewrite the other. Each request is one row; the current actual for a Part is the SUM of
-- its applied deltas. A correction is a new row with a negative delta, never an edit.
--
-- RECORDING AN ACTUAL IS NOT MOVING STOCK. Nothing here reserves, consumes or releases inventory, and no
-- inventory relation is written: the ruling makes stock movement an explicit boundary, never a hidden
-- Inventory activation. inventory_commitments stays the only ledger of stock effects.
--
-- IDEMPOTENT BY KEY. (tenant, Work Order, idempotency_key) is unique, and the row stores the request
-- fingerprint, so a replay returns the recorded outcome and a different request under a reused key refuses.
--
-- ONE CAPABILITY, REGISTERED WITH NO GRANTS: workOrder.execution.record (workOrder / recordExecution). Recording
-- actuals is materially distinct from the technician runtime edges (workOrder.transition, which the baseline
-- grants to eleven Roles), so it is not folded into them (DQ-010). Who holds it is an Administration decision.
-- The command additionally requires RECORD_ASSIGNMENT: only the assigned Employee records their job's actuals.
--
-- CREATE IS IDEMPOTENT BY KEY (parity with the Firebase createWorkOrder's idempotencyKey, site-work #2): a retried or
-- double-submitted create carrying the same key replays the Work Order it already created instead of minting a
-- duplicate and burning a Work Order number. The key is scoped to the creating Principal, and the request
-- fingerprint is kept so a reused key with a different request refuses rather than replays.
--
-- Counts: capabilities +1; role_capabilities +0.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key = 'workOrder.execution.record' OR (object_key = 'workOrder' AND action_key = 'recordExecution');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_EXECUTION_FACTS: workOrder.execution.record / workOrder.recordExecution is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_workOrder_execution_record', 'workOrder.execution.record',
     'Record the actual Parts used and execution notes on the Work Order the caller is ASSIGNED to (RECORD_ASSIGNMENT). Recording an actual moves no stock: it reserves, consumes and releases nothing. Confers no lifecycle transition. Granted only through Administration.',
     'workOrder', 'recordExecution', 'BUSINESS_ACTION', 'Record Work Order Execution')
ON CONFLICT (key) DO NOTHING;

SET search_path = eos_ops, public;

CREATE TABLE work_order_execution_records (
    id                     TEXT        PRIMARY KEY,
    tenant_id              TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    work_order_id          TEXT        NOT NULL,
    kind                   TEXT        NOT NULL,
    part_id                TEXT,
    -- What the technician asked for, and what was applied after the [0, qty_planned] clamp. Both are kept:
    -- a clamp that silently replaced the request would lose the fact that someone reported more than planned.
    requested_delta        INTEGER,
    applied_delta          INTEGER,
    note                   TEXT,
    idempotency_key        TEXT        NOT NULL,
    request_fingerprint    TEXT        NOT NULL,
    recorded_by_principal_id TEXT      NOT NULL,
    recorded_at            TIMESTAMPTZ NOT NULL,
    CONSTRAINT wo_execution_work_order_fk FOREIGN KEY (tenant_id, work_order_id)
        REFERENCES work_orders (tenant_id, id),
    CONSTRAINT wo_execution_actor_fk FOREIGN KEY (tenant_id, recorded_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT wo_execution_kind_known CHECK (kind IN ('PART_USAGE', 'NOTE')),
    CONSTRAINT wo_execution_shape CHECK (
        (kind = 'PART_USAGE' AND part_id IS NOT NULL AND btrim(part_id) <> '' AND requested_delta IS NOT NULL
            AND requested_delta <> 0 AND applied_delta IS NOT NULL AND note IS NULL)
        OR (kind = 'NOTE' AND part_id IS NULL AND requested_delta IS NULL AND applied_delta IS NULL
            AND note IS NOT NULL AND btrim(note) <> '' AND length(note) <= 2000)),
    CONSTRAINT wo_execution_key_stated CHECK (btrim(idempotency_key) <> '' AND length(idempotency_key) <= 200),
    CONSTRAINT wo_execution_one_request_per_key UNIQUE (tenant_id, work_order_id, idempotency_key)
);
ALTER TABLE work_orders ADD COLUMN create_idempotency_key TEXT, ADD COLUMN create_request_fingerprint TEXT;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_create_idempotency_whole CHECK (
    (create_idempotency_key IS NULL) = (create_request_fingerprint IS NULL)
    AND (create_idempotency_key IS NULL OR (btrim(create_idempotency_key) <> '' AND length(create_idempotency_key) <= 150)));
CREATE UNIQUE INDEX work_orders_create_idempotency ON work_orders (tenant_id, created_by_principal_id, create_idempotency_key)
    WHERE create_idempotency_key IS NOT NULL;

CREATE INDEX work_order_execution_by_work_order ON work_order_execution_records (tenant_id, work_order_id, recorded_at);

CREATE FUNCTION work_order_execution_refuse_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'work_order_execution_records is append-only: a correction is a new record, never an edit';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER work_order_execution_append_only BEFORE UPDATE OR DELETE ON work_order_execution_records
    FOR EACH ROW EXECUTE FUNCTION work_order_execution_refuse_change();

-- Down Migration
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capabilities WHERE capability_id = 'cap_workOrder_execution_record';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_EXECUTION_FACTS: refuses to reverse -- workOrder.execution.record is held by % Role grant(s)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities WHERE capability_id = 'cap_workOrder_execution_record';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_EXECUTION_FACTS: refuses to reverse -- workOrder.execution.record is held by % direct grant(s)', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions WHERE capability_key = 'workOrder.execution.record';
        IF v_n > 0 THEN
            RAISE EXCEPTION 'WORK_ORDER_EXECUTION_FACTS: refuses to reverse -- % Administration decision(s) name workOrder.execution.record', v_n;
        END IF;
    END IF;
    SELECT count(*) INTO v_n FROM eos_ops.work_order_execution_records;
    IF v_n > 0 THEN
        RAISE EXCEPTION 'WORK_ORDER_EXECUTION_FACTS: refuses to reverse -- % execution record(s) are field history', v_n;
    END IF;
END
$$;

SET search_path = eos_ops, public;
DROP TRIGGER IF EXISTS work_order_execution_append_only ON work_order_execution_records;
DROP FUNCTION IF EXISTS work_order_execution_refuse_change();
DROP TABLE IF EXISTS work_order_execution_records;
DROP INDEX IF EXISTS work_orders_create_idempotency;
ALTER TABLE work_orders DROP CONSTRAINT IF EXISTS work_orders_create_idempotency_whole;
ALTER TABLE work_orders DROP COLUMN IF EXISTS create_request_fingerprint, DROP COLUMN IF EXISTS create_idempotency_key;
DELETE FROM eos_policy.capabilities WHERE id = 'cap_workOrder_execution_record';
