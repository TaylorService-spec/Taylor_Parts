-- Up Migration
-- EMPLOYEE WORK ELIGIBILITY / QUALIFICATION authority (Owner ruling 2026-09-17, operationalRoles decomposition, step A).
--
-- ============================================================================
-- WHAT THIS IS. A Work Eligibility code answers exactly one question: "is this Employee QUALIFIED for this kind of
-- operational work?" It is one of three INDEPENDENT authorities the legacy `operationalRoles` field conflated:
--
--   SECURITY CAPABILITY            can this Principal use this application capability?   eos_policy (already exists)
--   WORK ELIGIBILITY               is this Employee qualified for this kind of work?     <- THIS MIGRATION
--   OPERATIONAL SCOPE              is this Employee authorized for this warehouse?       (step B, separate table)
--
-- A governed command may require one, two or all three. They are never folded into one boolean.
--
-- WHAT IT IS NOT, AND NEVER BECOMES (Owner ruling). A qualification GRANTS NO APPLICATION ACCESS. It confers no
-- Security Role, no capability, no permission, no Account/customer ownership, no assignment, no manager/reporting
-- authority, no operating-company authority and no Job Role. Security capability remains the FIRST authority boundary;
-- qualification is only ever a SECONDARY business restriction on top of it. Nothing in this schema can grant access:
-- the table holds no capability, permission, role or scope column, by construction.
--
-- NOT A JOB ROLE, NOT A SECURITY ROLE. Job Role (eos_workforce.job_roles) describes business FUNCTION and drives
-- presentation/persona only. An Employee may hold Job Role `Service Technician` and temporarily LACK the
-- SERVICE_TECHNICIAN qualification; an Employee may be qualified without any Job Role change. The two never derive
-- from each other, and neither derives from a Security Role.
--
-- PLATFORM-DEFINED VOCABULARY, NOT TENANT-EDITABLE (Owner ruling, v1). These codes carry application/domain semantics,
-- so they are platform canonical codes enforced by CHECK -- deliberately NOT a tenant catalog table like job_roles.
-- Adding a code is therefore a reviewed migration, which is the intent: a new qualification is only added when a real
-- current consumer proves neither existing code can truthfully express the required eligibility.
--
--   SERVICE_TECHNICIAN     qualified to be assigned/scheduled service work
--   WAREHOUSE_OPERATIONS   qualified to perform warehouse/inventory operations
--
-- The eight legacy operationalRole values are NOT reproduced. WAREHOUSE_ASSOCIATE does not become a code: its
-- enforcement meaning is WAREHOUSE_OPERATIONS qualification + explicit warehouse scope (step B).
--
--   employee_work_eligibility    append-only, effective-dated history. At most ONE CURRENT (effective_to IS NULL) row
--                                per (Employee, code) -- an Employee may hold MULTIPLE different qualifications at
--                                once, and may hold none. The only permitted UPDATE ends a current row once;
--                                DELETE is refused.
--
-- NO SEED ROWS AND NO BACKFILL. Assignments start EMPTY. Nothing is inferred from operationalRoles, Job Role, Security
-- Role, uid, title, ownership, manager, operating company, assignment, activity or permissions. The two legacy values
-- the ruling allows as deterministic candidates (TECHNICIAN -> SERVICE_TECHNICIAN, WAREHOUSE_ASSOCIATE ->
-- WAREHOUSE_OPERATIONS) are migrated only by governed dry-run/census tooling (step D/E), never by this SQL.
--
-- CAPABILITY VOCABULARY (definition, not a grant): admin.employeeWorkEligibility.write. By Owner ruling it is a NARROW
-- capability of its own -- it deliberately does NOT reuse admin.employeeProfile.write or admin.employeeJobRole.write.
-- Who holds it comes from the Role catalog via the existing grant reconciliation, never from SQL here.
-- ============================================================================

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_admin_employeeWorkEligibility_write',
     'admin.employeeWorkEligibility.write',
     'Assign and end an Employee''s Work Eligibility qualifications. A qualification proves the Employee is qualified for a kind of operational work: it confers no Security Role, capability, permission, Job Role, ownership, assignment, reporting or operating-company authority, and never grants application access.');

SET search_path = eos_workforce, public;

CREATE TABLE employee_work_eligibility (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    employee_id         TEXT        NOT NULL,
    qualification_code  TEXT        NOT NULL,
    effective_from      TIMESTAMPTZ NOT NULL,
    effective_to        TIMESTAMPTZ,
    assigned_by         TEXT        NOT NULL,
    ended_by            TEXT,
    ended_at            TIMESTAMPTZ,
    reason              TEXT,

    CONSTRAINT work_eligibility_employee_fk FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
    -- The platform vocabulary. Widening this list is a deliberate, reviewed migration -- never a tenant edit.
    CONSTRAINT work_eligibility_code_known CHECK (qualification_code IN ('SERVICE_TECHNICIAN', 'WAREHOUSE_OPERATIONS')),
    CONSTRAINT work_eligibility_period_ordered CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT work_eligibility_end_is_complete CHECK (
        (effective_to IS NULL AND ended_by IS NULL AND ended_at IS NULL)
        OR (effective_to IS NOT NULL AND ended_by IS NOT NULL AND btrim(ended_by) <> '' AND ended_at IS NOT NULL)
    ),
    CONSTRAINT work_eligibility_assigned_by_present CHECK (btrim(assigned_by) <> ''),
    CONSTRAINT work_eligibility_reason_length CHECK (reason IS NULL OR (btrim(reason) <> '' AND char_length(reason) <= 500))
);

-- One CURRENT row per (Employee, code). Multiple DIFFERENT codes may be current for one Employee simultaneously.
CREATE UNIQUE INDEX employee_work_eligibility_one_current_per_code
    ON employee_work_eligibility (tenant_id, employee_id, qualification_code)
    WHERE effective_to IS NULL;

-- "Which Employees currently hold this qualification?" -- the assignable-Employee authority (step G) reads this.
CREATE INDEX employee_work_eligibility_current_by_code
    ON employee_work_eligibility (tenant_id, qualification_code)
    WHERE effective_to IS NULL;

-- "What has this Employee held, and when?" -- history reads and remediation.
CREATE INDEX employee_work_eligibility_history_by_employee
    ON employee_work_eligibility (tenant_id, employee_id, effective_from DESC, id DESC);

CREATE FUNCTION refuse_work_eligibility_history_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'employee_work_eligibility keeps history: DELETE is refused';
    END IF;
    IF OLD.effective_to IS NOT NULL THEN
        RAISE EXCEPTION 'employee_work_eligibility keeps history: an ended qualification is immutable';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.qualification_code IS DISTINCT FROM OLD.qualification_code
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
       OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.effective_to IS NULL THEN
        RAISE EXCEPTION 'employee_work_eligibility keeps history: the only permitted change ends a current qualification';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_work_eligibility_keep_history
    BEFORE UPDATE OR DELETE ON employee_work_eligibility
    FOR EACH ROW EXECUTE FUNCTION refuse_work_eligibility_history_mutation();

-- Down Migration
-- REFUSE, NEVER DESTROY: qualification history is a business fact, and the grant is an authorization fact.
DO $$
DECLARE
    qualifications BIGINT;
    grants BIGINT;
BEGIN
    SELECT count(*) INTO qualifications FROM eos_workforce.employee_work_eligibility;
    SELECT count(*) INTO grants FROM eos_policy.role_capabilities WHERE capability_id = 'cap_admin_employeeWorkEligibility_write';
    IF qualifications > 0 OR grants > 0 THEN
        RAISE EXCEPTION 'this migration refuses to reverse: % Work Eligibility row(s) and % grant(s) are recorded',
            qualifications, grants
            USING HINT = 'Export the history and withdraw the grants deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS employee_work_eligibility_keep_history ON eos_workforce.employee_work_eligibility;
DROP FUNCTION IF EXISTS eos_workforce.refuse_work_eligibility_history_mutation();
DROP TABLE IF EXISTS eos_workforce.employee_work_eligibility;
DELETE FROM eos_policy.capabilities WHERE id = 'cap_admin_employeeWorkEligibility_write';
