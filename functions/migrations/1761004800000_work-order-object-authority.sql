-- Up Migration
-- WORK ORDER / SERVICE OBJECT AUTHORITY -- the governed PostgreSQL Work Order.
--
-- ============================================================================
-- MIGRATION 035 (this branch). The Work Order record, its assignment history, its schedule history
-- and its transition log become governed PostgreSQL authorities.
--
-- NOTHING IS ACTIVATED. No copy has run, no route serves these tables, no client reads them, and
-- Firestore `fieldops_wos` remains Work Order authority until the cutover retires it.
-- ============================================================================
--
-- ════════════════════ MIGRATION NUMBERING, AND A KNOWN SERIALIZATION ════════════════════
--
-- #1961 (Reorder Domain Cutover) is HELD and carries migrations 035-039 in ITS branch. This slice
-- starts at a deliberately higher timestamp so the two do not collide, but whichever merges second
-- must reconcile PINNED_MIGRATION_COUNT / PINNED_LAST_MIGRATION. That is ordinary serialization,
-- not a design conflict, and it is stated here so the second merge is not surprised by it.
--
-- ════════════════════ WHAT THE LEGACY RECORD IS, AND WHAT IT IS NOT ════════════════════
--
-- `fieldops_wos` permits NO client write (`firestore.rules:509`). Every write is Admin SDK, so the
-- Firebase Functions are the Work Order AUTHORITY, not a transport in front of one. Moving the
-- collection is therefore only half the job; the callables are the other half.
--
-- The legacy record breaks the identity separations in four places, and this schema fixes all four:
--
--   assignedTechId / scheduledTechId   fieldops_technicians document ids. NOT Employee ids. They
--                                      are reached from a CREDENTIAL (`users/{uid}.technicianId`),
--                                      so the person is identified by how they log in.
--   reassignedByUid / rescheduledByUid FIREBASE UIDS. Not Principals.
--
-- Here the assignee is an EMPLOYEE and the actor is a PRINCIPAL, and neither is ever the other.
--
-- ════════════════════ ONE PERSON-AXIS, NOT TWO ════════════════════
--
-- "Scheduled" and "dispatched" are not two assignees; they are one assignee at two lifecycle
-- phases, and the phase is the Work Order STATUS (#1915 section 3.2). So there is no
-- `scheduled_employee_id` beside an `assigned_employee_id`: there is ONE current assignment row,
-- and everything else is history.
--
-- ════════════════════ THE SCHEDULE IS NOT AN ASSIGNMENT FACT ════════════════════
--
-- `scheduled_start` / `scheduled_end` stay on the Work Order. Putting them on the assignment row
-- would make assignment history a second schedule authority, and re-timing a job would then look
-- like re-assigning it.

SET search_path = eos_ops, public;

-- The eleven governed statuses (types/workOrder.ts WorkOrderStatus), in lifecycle order.
CREATE TYPE ops_work_order_status AS ENUM (
    'CREATED', 'READY_TO_DISPATCH', 'SCHEDULED', 'DISPATCHED', 'ACCEPTED',
    'EN_ROUTE', 'ARRIVED', 'WORK_IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'
);
CREATE TYPE ops_work_order_type AS ENUM ('SERVICE_CALL', 'PM', 'INSTALL', 'WARRANTY', 'INSPECTION');
CREATE TYPE ops_work_order_severity AS ENUM ('EQUIPMENT_DOWN', 'PARTIAL_OPERATION', 'COSMETIC', 'PREVENTIVE');
-- Same two words as ops_location_provenance and ops_assignment_provenance.
CREATE TYPE ops_work_order_provenance AS ENUM ('NATIVE', 'MIGRATED');

CREATE TABLE work_orders (
    -- The Firestore document id, carried unchanged so every existing reference still resolves.
    id                       TEXT PRIMARY KEY,
    tenant_id                TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    -- Opaque here, exactly as migration 007 treats it: this schema does not own company authority.
    -- NOTE: once #1961's eos_policy.tenant_operating_company_keys binding exists, the creation
    -- boundary should validate this key against it. Recorded, not assumed.
    operating_company_key    TEXT NOT NULL,

    -- WO-YYYY-###### . NULL on records created before the allocator, never backfilled -- an absent
    -- reference is a true fact about a legacy record.
    work_order_number        TEXT,
    status                   ops_work_order_status NOT NULL,
    work_order_type          ops_work_order_type NOT NULL,
    priority                 SMALLINT NOT NULL,
    severity                 ops_work_order_severity,

    -- WHO and WHERE. The customer is a governed Account; the location is opaque, as migration 005
    -- treats location ids, because Location authority is not owned by this schema.
    customer_id              TEXT NOT NULL,
    location_id              TEXT NOT NULL,
    equipment_id             TEXT,
    sales_order_id           TEXT,

    -- THE SCHEDULE. A Work Order fact, deliberately not an assignment fact.
    scheduled_start          TIMESTAMPTZ,
    scheduled_end            TIMESTAMPTZ,
    estimated_duration_minutes INTEGER,

    -- Lifecycle moments. Each is when a governed transition happened.
    dispatched_at            TIMESTAMPTZ,
    accepted_at              TIMESTAMPTZ,
    en_route_at              TIMESTAMPTZ,
    arrived_at               TIMESTAMPTZ,
    work_started_at          TIMESTAMPTZ,
    completed_at             TIMESTAMPTZ,
    closed_at                TIMESTAMPTZ,

    -- Authored execution facts. No audit event reproduces what a technician wrote.
    complaint                TEXT,
    diagnosis                TEXT,
    resolution               TEXT,
    parts_plan_updated_at    TIMESTAMPTZ,

    provenance               ops_work_order_provenance NOT NULL,
    -- ACTORS ARE PRINCIPALS. NULL permitted only for a MIGRATED row whose legacy uid resolves to
    -- nobody -- the same truthful-unknown shape the Reorder requester uses.
    created_by_principal_id  TEXT,
    updated_by_principal_id  TEXT,
    created_at               TIMESTAMPTZ NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL,

    CONSTRAINT work_orders_tenant_scoped_identity UNIQUE (tenant_id, id),
    CONSTRAINT work_orders_id_is_a_safe_segment CHECK (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
    CONSTRAINT work_orders_company_is_stated CHECK (btrim(operating_company_key) <> ''),
    CONSTRAINT work_order_number_format CHECK (
        work_order_number IS NULL OR work_order_number ~ '^WO-[0-9]{4}-[0-9]{6,}$'),
    CONSTRAINT work_orders_priority_governed CHECK (priority BETWEEN 1 AND 4),
    CONSTRAINT work_orders_duration_positive CHECK (
        estimated_duration_minutes IS NULL OR estimated_duration_minutes > 0),
    -- A window is both ends or neither, and it does not run backwards.
    CONSTRAINT work_orders_schedule_is_whole CHECK ((scheduled_start IS NULL) = (scheduled_end IS NULL)),
    CONSTRAINT work_orders_schedule_ordered CHECK (
        scheduled_end IS NULL OR scheduled_end >= scheduled_start),
    -- A terminal status states when it happened; an unexplained terminal record is not migratable.
    CONSTRAINT work_orders_completed_states_when CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL),
    CONSTRAINT work_orders_closed_states_when CHECK (status <> 'CLOSED' OR closed_at IS NOT NULL),
    CONSTRAINT work_orders_native_actor_present CHECK (
        (provenance = 'NATIVE' AND created_by_principal_id IS NOT NULL)
        OR (provenance = 'MIGRATED')),
    CONSTRAINT work_orders_customer_fk FOREIGN KEY (tenant_id, customer_id)
        REFERENCES eos_crm.accounts (tenant_id, id),
    CONSTRAINT work_orders_equipment_fk FOREIGN KEY (tenant_id, equipment_id)
        REFERENCES eos_ops.equipment (tenant_id, id),
    CONSTRAINT work_orders_sales_order_fk FOREIGN KEY (tenant_id, sales_order_id)
        REFERENCES eos_commercial.sales_orders (tenant_id, id),
    CONSTRAINT work_orders_created_by_member_fk FOREIGN KEY (tenant_id, created_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT work_orders_updated_by_member_fk FOREIGN KEY (tenant_id, updated_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id)
);

CREATE INDEX work_orders_by_status      ON work_orders (tenant_id, status);
CREATE INDEX work_orders_by_customer    ON work_orders (tenant_id, customer_id);
CREATE INDEX work_orders_by_schedule    ON work_orders (tenant_id, scheduled_start)
    WHERE scheduled_start IS NOT NULL;
CREATE UNIQUE INDEX work_orders_number_unique ON work_orders (tenant_id, work_order_number)
    WHERE work_order_number IS NOT NULL;

-- ════════════════════ ASSIGNMENT: AN INTERVAL, NOT A COLUMN ════════════════════
--
-- Shape follows #1915 section 8.2. THE ASSIGNEE IS AN EMPLOYEE and the actor is a PRINCIPAL.
CREATE TABLE work_order_assignments (
    id                        TEXT PRIMARY KEY,
    tenant_id                 TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    work_order_id             TEXT NOT NULL,
    assignee_employee_id      TEXT NOT NULL,
    -- How this row began. Each value is an existing command, plus the one-time import.
    source                    TEXT NOT NULL,
    reason                    TEXT,
    effective_from            TIMESTAMPTZ NOT NULL,
    assigned_by_principal_id  TEXT,
    -- Closing columns: written once, NULL -> value, never rewritten.
    effective_to              TIMESTAMPTZ,
    end_source                TEXT,
    end_reason                TEXT,
    ended_by_principal_id     TEXT,
    provenance                ops_work_order_provenance NOT NULL,
    recorded_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT wo_assignment_source_known CHECK (source IN
        ('SCHEDULE', 'DISPATCH_REASSIGN', 'RESCHEDULE', 'REASSIGN_SCHEDULED', 'MIGRATION')),
    CONSTRAINT wo_assignment_end_source_known CHECK (end_source IS NULL OR end_source IN
        ('DISPATCH_REASSIGN', 'RESCHEDULE', 'REASSIGN_SCHEDULED', 'UNSCHEDULE', 'MIGRATION')),
    CONSTRAINT wo_assignment_work_order_fk FOREIGN KEY (tenant_id, work_order_id)
        REFERENCES work_orders (tenant_id, id),
    CONSTRAINT wo_assignment_employee_fk FOREIGN KEY (tenant_id, assignee_employee_id)
        REFERENCES eos_workforce.employees (tenant_id, id),
    CONSTRAINT wo_assignment_assigned_by_fk FOREIGN KEY (tenant_id, assigned_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT wo_assignment_ended_by_fk FOREIGN KEY (tenant_id, ended_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    -- A NATIVE row names its actor. A MIGRATED one may not be able to, and says so truthfully.
    CONSTRAINT wo_assignment_native_actor_present CHECK (
        (provenance = 'NATIVE' AND assigned_by_principal_id IS NOT NULL)
        OR (provenance = 'MIGRATED')),
    -- A close is whole or absent. Half a close is a row nobody can interpret.
    CONSTRAINT wo_assignment_close_is_whole CHECK (
        (effective_to IS NULL AND end_source IS NULL AND end_reason IS NULL AND ended_by_principal_id IS NULL)
        OR (effective_to IS NOT NULL AND end_source IS NOT NULL)),
    CONSTRAINT wo_assignment_interval CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT wo_assignment_reason_where_required CHECK (
        source NOT IN ('DISPATCH_REASSIGN', 'RESCHEDULE', 'REASSIGN_SCHEDULED')
        OR length(btrim(coalesce(reason, ''))) > 0)
);

-- ONE CURRENT ASSIGNEE per Work Order. History rows are unconstrained.
CREATE UNIQUE INDEX work_order_assignments_one_current
    ON work_order_assignments (tenant_id, work_order_id) WHERE effective_to IS NULL;
-- "my assigned work", by Employee.
CREATE INDEX work_order_assignments_current_by_employee
    ON work_order_assignments (tenant_id, assignee_employee_id) WHERE effective_to IS NULL;
CREATE INDEX work_order_assignments_history
    ON work_order_assignments (tenant_id, work_order_id, effective_from);

-- HISTORY IS NEVER DELETED, and an ended row is never re-opened or re-pointed.
CREATE FUNCTION work_order_assignment_refuse_delete() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'work_order_assignments keeps history: an assignment is ENDED, never deleted';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER work_order_assignment_no_delete BEFORE DELETE ON work_order_assignments
    FOR EACH ROW EXECUTE FUNCTION work_order_assignment_refuse_delete();

CREATE FUNCTION work_order_assignment_refuse_rewrite() RETURNS trigger AS $$
BEGIN
    IF OLD.effective_to IS NOT NULL THEN
        RAISE EXCEPTION 'this assignment already ended; history is not rewritten';
    END IF;
    IF NEW.work_order_id <> OLD.work_order_id
       OR NEW.assignee_employee_id <> OLD.assignee_employee_id
       OR NEW.effective_from <> OLD.effective_from THEN
        RAISE EXCEPTION 'an open assignment may only be CLOSED, never re-pointed';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER work_order_assignment_close_only BEFORE UPDATE ON work_order_assignments
    FOR EACH ROW EXECUTE FUNCTION work_order_assignment_refuse_rewrite();

-- ════════════════════ SCHEDULE HISTORY ════════════════════
--
-- The legacy record keeps only the LATEST reschedule (rescheduledFrom*), overwritten each time.
-- These rows keep them all, which is why retiring those columns gains history rather than losing it.
CREATE TABLE work_order_schedule_history (
    id                     TEXT PRIMARY KEY,
    tenant_id              TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    work_order_id          TEXT NOT NULL,
    previous_start         TIMESTAMPTZ,
    previous_end           TIMESTAMPTZ,
    new_start              TIMESTAMPTZ,
    new_end                TIMESTAMPTZ,
    reason                 TEXT,
    changed_by_principal_id TEXT,
    changed_at             TIMESTAMPTZ NOT NULL,
    provenance             ops_work_order_provenance NOT NULL,

    CONSTRAINT wo_schedule_history_work_order_fk FOREIGN KEY (tenant_id, work_order_id)
        REFERENCES work_orders (tenant_id, id),
    CONSTRAINT wo_schedule_history_actor_fk FOREIGN KEY (tenant_id, changed_by_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT wo_schedule_history_says_something CHECK (
        previous_start IS NOT NULL OR new_start IS NOT NULL)
);
CREATE INDEX work_order_schedule_history_by_work_order
    ON work_order_schedule_history (tenant_id, work_order_id, changed_at);

-- ════════════════════ TRANSITION LOG ════════════════════
--
-- Replaces the `executionLog` array. An array on a document cannot be indexed, constrained, or
-- attributed to a governed actor; these rows can.
CREATE TABLE work_order_transitions (
    id                   TEXT PRIMARY KEY,
    tenant_id            TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    work_order_id        TEXT NOT NULL,
    from_status          ops_work_order_status,
    to_status            ops_work_order_status NOT NULL,
    action               TEXT NOT NULL,
    occurred_at          TIMESTAMPTZ NOT NULL,
    actor_principal_id   TEXT,
    note                 TEXT,
    provenance           ops_work_order_provenance NOT NULL,

    CONSTRAINT wo_transition_work_order_fk FOREIGN KEY (tenant_id, work_order_id)
        REFERENCES work_orders (tenant_id, id),
    CONSTRAINT wo_transition_actor_fk FOREIGN KEY (tenant_id, actor_principal_id)
        REFERENCES eos_policy.tenant_memberships (tenant_id, principal_id),
    CONSTRAINT wo_transition_action_stated CHECK (btrim(action) <> ''),
    -- A NATIVE transition names who performed it. A MIGRATED one may not be able to.
    CONSTRAINT wo_transition_native_actor_present CHECK (
        provenance = 'MIGRATED' OR actor_principal_id IS NOT NULL)
);
CREATE INDEX work_order_transitions_by_work_order
    ON work_order_transitions (tenant_id, work_order_id, occurred_at);

CREATE FUNCTION work_order_transition_refuse_change() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'work_order_transitions is append-only: a transition happened or it did not';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER work_order_transition_append_only BEFORE UPDATE OR DELETE ON work_order_transitions
    FOR EACH ROW EXECUTE FUNCTION work_order_transition_refuse_change();

-- ════════════════════ SALES ORDER LINE REFERENCES ════════════════════
--
-- A relationship with its own cardinality is a child table, not a JSON array no key can check.
CREATE TABLE work_order_sales_order_lines (
    tenant_id          TEXT NOT NULL REFERENCES eos_policy.tenants(id),
    work_order_id      TEXT NOT NULL,
    sales_order_id     TEXT NOT NULL,
    sales_order_line_id TEXT NOT NULL,

    PRIMARY KEY (tenant_id, work_order_id, sales_order_id, sales_order_line_id),
    CONSTRAINT wo_so_line_work_order_fk FOREIGN KEY (tenant_id, work_order_id)
        REFERENCES work_orders (tenant_id, id),
    CONSTRAINT wo_so_line_sales_order_fk FOREIGN KEY (tenant_id, sales_order_id)
        REFERENCES eos_commercial.sales_orders (tenant_id, id)
);

-- Down Migration
SET search_path = eos_ops, public;

DROP TABLE IF EXISTS work_order_sales_order_lines;
DROP TRIGGER IF EXISTS work_order_transition_append_only ON work_order_transitions;
DROP FUNCTION IF EXISTS work_order_transition_refuse_change();
DROP TABLE IF EXISTS work_order_transitions;
DROP TABLE IF EXISTS work_order_schedule_history;
DROP TRIGGER IF EXISTS work_order_assignment_close_only ON work_order_assignments;
DROP FUNCTION IF EXISTS work_order_assignment_refuse_rewrite();
DROP TRIGGER IF EXISTS work_order_assignment_no_delete ON work_order_assignments;
DROP FUNCTION IF EXISTS work_order_assignment_refuse_delete();
DROP TABLE IF EXISTS work_order_assignments;
DROP TABLE IF EXISTS work_orders;
DROP TYPE IF EXISTS ops_work_order_provenance;
DROP TYPE IF EXISTS ops_work_order_severity;
DROP TYPE IF EXISTS ops_work_order_type;
DROP TYPE IF EXISTS ops_work_order_status;
