-- Up Migration
-- REORDER ASSIGNMENT IDENTITY authority (Owner ruling 2026-09-19).
--
-- ============================================================================
-- THE SEAM THIS CORRECTS. The legacy path stores `reorder_requests.assignedToUserId` -- a FIREBASE AUTH UID -- and
-- `firestore.rules` authorizes the assignee's own later actions with `request.auth.uid == assignedToUserId`. That
-- conflates two different questions:
--
--   WHO IS ASSIGNED THE WORK?      a business fact about an EMPLOYEE
--   WHO IS LOGGED IN RIGHT NOW?    an authentication fact about a PRINCIPAL
--
-- The governed model already separates them: external identity -> Principal -> Employee. Assignment belongs to the
-- EMPLOYEE; authentication and authorization belong to the Principal. So the assignee here is an Employee id, and
-- the Principal appears only as the ACTOR who performed the assignment.
--
--   assigned_employee_id      the business assignee. Never a Principal id, never a uid.
--   assigned_by_principal_id  who performed the assignment. Never the assignee.
--
-- NO FIREBASE UID IS STORED, in any column, ever. There is deliberately no `assigned_to_user_id`, no
-- `external_subject` and no `uid` column: the target is zero Firebase uid dependency, and a column that could hold
-- one is how that dependency comes back.
--
-- ============================================================================
-- WHY A SEPARATE, EFFECTIVE-DATED TABLE AND NOT A COLUMN ON reorder_requests
--
-- `reorder_requests` exists in this schema but the RUNTIME authority for the Reorder object is still Firestore
-- during this bounded migration. A column there would be a second answer to "who is assigned" that nothing writes,
-- which is precisely the dual-answer state the ruling forbids. A separate authority lets ONE writer own the
-- assignment fact while the object itself migrates on its own schedule.
--
-- Effective-dated for the same reason every other Workforce authority is: an assignment that changed hands is a
-- business fact worth keeping, and "who was assigned when" is asked during purchasing disputes. At most ONE CURRENT
-- (effective_to IS NULL) assignment per request; history is appended, never overwritten.
--
-- ============================================================================
-- WHAT AN ASSIGNMENT IS NOT. It confers NO capability, NO Security Role, NO Job Role, NO Work Eligibility
-- qualification and NO Operational Scope. Being assigned is not permission to act: an assignee-only action still
-- requires its own capability, and the assignment only NARROWS that capability to the assigned Employee. Assignment
-- alone never grants; capability alone never satisfies an own-assignment condition where one is required. That is
-- the same shape as the isOwnAssignment evaluator parity already built for eos_policy.
--
-- INERT ON ARRIVAL. This migration creates the authority and grants nothing. No row is seeded, no client writes it,
-- and the Firestore path remains authoritative until a separate, reviewed activation moves the writer. Creating the
-- table is not cutting over.
-- ============================================================================

SET search_path = eos_policy, public;

-- THE EXISTING CAPABILITY, REGISTERED -- not a new one. `reorder.request.assign` already exists in
-- access/permissionCatalog.ts and is already held by exactly the Roles that should assign purchasing work (admin,
-- dispatcher, owner, partsManager). Inventing a second "assign" capability because the ASSIGNEE's identity model
-- changed would split one authority in two and leave a reviewer asking which one really governs the action.
--
-- It was simply never registered in the PostgreSQL vocabulary, because nothing governed by PostgreSQL performed the
-- assignment until now. Registration is not a grant: who holds it still comes from the Role catalog through the
-- existing reconciliation.
INSERT INTO capabilities (id, key, description) VALUES
    ('cap_reorder_request_assign',
     'reorder.request.assign',
     'Assign a Reorder Request to an Employee through the governed assignment authority. The assignment names an Employee, never a Principal and never a Firebase uid; it confers no capability, Security Role, Job Role, qualification or operational scope of its own.');

SET search_path = eos_ops, public;

CREATE TABLE reorder_request_assignments (
    id                       TEXT PRIMARY KEY,
    tenant_id                TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    -- The Reorder Request this assignment is about. Opaque here, exactly as `reorder_requests.warehouse_id` is
    -- opaque: the Reorder object's own authority is not owned by this table, and during the migration it is not
    -- even owned by this database. A foreign key would assert an ownership that does not yet exist.
    reorder_request_id       TEXT        NOT NULL,
    -- THE BUSINESS ASSIGNEE. A governed Employee of the SAME tenant, enforced -- not asserted.
    assigned_employee_id     TEXT        NOT NULL,
    effective_from           TIMESTAMPTZ NOT NULL,
    effective_to             TIMESTAMPTZ,
    -- THE ACTOR, a different concept: the EOS Principal who performed the assignment. Never the assignee.
    assigned_by_principal_id TEXT        NOT NULL,
    ended_by_principal_id    TEXT,
    ended_at                 TIMESTAMPTZ,
    reason                   TEXT,

    CONSTRAINT reorder_assignment_employee_fk
        FOREIGN KEY (tenant_id, assigned_employee_id) REFERENCES eos_workforce.employees (tenant_id, id),
    CONSTRAINT reorder_assignment_request_shape
        CHECK (reorder_request_id <> '' AND btrim(reorder_request_id) = reorder_request_id
               AND position('/' in reorder_request_id) = 0),
    CONSTRAINT reorder_assignment_period_ordered
        CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT reorder_assignment_end_is_complete CHECK (
        (effective_to IS NULL AND ended_by_principal_id IS NULL AND ended_at IS NULL)
        OR (effective_to IS NOT NULL AND ended_by_principal_id IS NOT NULL
            AND btrim(ended_by_principal_id) <> '' AND ended_at IS NOT NULL)
    ),
    CONSTRAINT reorder_assignment_actor_present CHECK (btrim(assigned_by_principal_id) <> ''),
    CONSTRAINT reorder_assignment_reason_length
        CHECK (reason IS NULL OR (btrim(reason) <> '' AND char_length(reason) <= 500))
);

-- ONE CURRENT assignment per request. A request assigned twice at once has no answer to "who is assigned".
CREATE UNIQUE INDEX reorder_request_assignment_one_current
    ON reorder_request_assignments (tenant_id, reorder_request_id)
    WHERE effective_to IS NULL;

-- "Is THIS Employee the current assignee of THIS request?" -- the own-assignment predicate's lookup.
CREATE INDEX reorder_request_assignment_current_by_employee
    ON reorder_request_assignments (tenant_id, assigned_employee_id)
    WHERE effective_to IS NULL;

-- "What has this request's assignment history been?"
CREATE INDEX reorder_request_assignment_history
    ON reorder_request_assignments (tenant_id, reorder_request_id, effective_from DESC, id DESC);

CREATE FUNCTION refuse_reorder_assignment_history_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'reorder_request_assignments keeps history: DELETE is refused';
    END IF;
    IF OLD.effective_to IS NOT NULL THEN
        RAISE EXCEPTION 'reorder_request_assignments keeps history: an ended assignment is immutable';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.reorder_request_id IS DISTINCT FROM OLD.reorder_request_id
       OR NEW.assigned_employee_id IS DISTINCT FROM OLD.assigned_employee_id
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.assigned_by_principal_id IS DISTINCT FROM OLD.assigned_by_principal_id
       OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.effective_to IS NULL THEN
        RAISE EXCEPTION 'reorder_request_assignments keeps history: the only permitted change ends a current assignment';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER reorder_request_assignments_keep_history
    BEFORE UPDATE OR DELETE ON reorder_request_assignments
    FOR EACH ROW EXECUTE FUNCTION refuse_reorder_assignment_history_mutation();

-- Down Migration
-- REFUSE, NEVER DESTROY: who was assigned which purchasing work is a business fact, and the grant is an
-- authorization fact.
DO $$
DECLARE
    assignments BIGINT;
    grants BIGINT;
BEGIN
    SELECT count(*) INTO assignments FROM eos_ops.reorder_request_assignments;
    SELECT count(*) INTO grants FROM eos_policy.role_capabilities WHERE capability_id = 'cap_reorder_request_assign';
    IF assignments > 0 OR grants > 0 THEN
        RAISE EXCEPTION 'this migration refuses to reverse: % assignment row(s) and % grant(s) are recorded',
            assignments, grants
            USING HINT = 'Export the history and withdraw the grants deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS reorder_request_assignments_keep_history ON eos_ops.reorder_request_assignments;
DROP FUNCTION IF EXISTS eos_ops.refuse_reorder_assignment_history_mutation();
DROP TABLE IF EXISTS eos_ops.reorder_request_assignments;
DELETE FROM eos_policy.capabilities WHERE id = 'cap_reorder_request_assign';
