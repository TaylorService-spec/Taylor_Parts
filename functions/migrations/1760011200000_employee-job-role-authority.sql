-- Up Migration
-- EMPLOYEE JOB ROLE authority (EMP-RT-08, Owner ruling 2026-09-16).
--
-- ============================================================================
-- A Job Role describes an Employee's BUSINESS FUNCTION and nothing else. It grants no Security Role and no permission,
-- establishes no Account/customer ownership, no assignment, no manager/reporting authority and no operating-company
-- authority. Retail Sales and National Accounts Sales are distinct Job Roles; there is no generic Sales role.
--
--   job_roles                        the TENANT-SCOPED catalog: stable id, display name, ACTIVE/INACTIVE. An INACTIVE
--                                    role stays readable (history names it) but cannot receive a new assignment.
--   employee_job_role_assignments    append-only, effective-dated history. At most ONE current (effective_to IS NULL)
--                                    assignment per Employee -- one current primary Job Role. An Employee may have none.
--                                    The only permitted UPDATE ends a current row once; DELETE is refused.
--
-- NO SEED ROWS and NO BACKFILL. Tenant ids are environment data; the launch catalog is written by the governed operator
-- seed (functions/scripts/jobRoleCatalogSeedCli.js). Assignments start EMPTY: there is no authorized legacy source, and
-- nothing is inferred from operationalRoles, Security Role, uid, ownership, manager, assignment, activity, permissions
-- or free-text title.
--
-- CAPABILITY VOCABULARY (definition, not a grant): admin.employeeJobRole.write. Who holds it comes from the Role catalog
-- via the existing grant reconciliation, never from SQL here.
-- ============================================================================

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_admin_employeeJobRole_write',
     'admin.employeeJobRole.write',
     'Maintain the tenant Job Role catalog and assign an Employee''s current Job Role. A Job Role is a business function only: it confers no Security Role, permission, ownership, assignment, reporting or operating-company authority.');

SET search_path = eos_workforce, public;

CREATE TABLE job_roles (
    tenant_id    TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    id           TEXT        NOT NULL,
    display_name TEXT        NOT NULL,
    status       TEXT        NOT NULL,
    created_by   TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   TEXT        NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    CONSTRAINT job_roles_id_shape CHECK (id ~ '^[a-z][a-z0-9-]{1,62}$'),
    CONSTRAINT job_roles_display_name_shape CHECK (display_name <> '' AND btrim(display_name) = display_name AND char_length(display_name) <= 100),
    CONSTRAINT job_roles_status_known CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT job_roles_actors_present CHECK (btrim(created_by) <> '' AND btrim(updated_by) <> '')
);

-- Two catalog entries answering to one name (in any case) is two identities for one business function.
CREATE UNIQUE INDEX job_roles_display_name_unique_per_tenant ON job_roles (tenant_id, lower(display_name));

CREATE TABLE employee_job_role_assignments (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    employee_id     TEXT        NOT NULL,
    job_role_id     TEXT        NOT NULL,
    effective_from  TIMESTAMPTZ NOT NULL,
    effective_to    TIMESTAMPTZ,
    assigned_by     TEXT        NOT NULL,
    ended_by        TEXT,
    ended_at        TIMESTAMPTZ,
    reason          TEXT,

    CONSTRAINT job_role_assignment_employee_fk FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
    CONSTRAINT job_role_assignment_role_fk     FOREIGN KEY (tenant_id, job_role_id) REFERENCES job_roles (tenant_id, id),
    CONSTRAINT job_role_assignment_period_ordered CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT job_role_assignment_end_is_complete CHECK (
        (effective_to IS NULL AND ended_by IS NULL AND ended_at IS NULL)
        OR (effective_to IS NOT NULL AND ended_by IS NOT NULL AND btrim(ended_by) <> '' AND ended_at IS NOT NULL)
    ),
    CONSTRAINT job_role_assignment_assigned_by_present CHECK (btrim(assigned_by) <> ''),
    CONSTRAINT job_role_assignment_reason_length CHECK (reason IS NULL OR (btrim(reason) <> '' AND char_length(reason) <= 500))
);

-- One current primary Job Role per Employee.
CREATE UNIQUE INDEX employee_job_role_one_current_per_employee
    ON employee_job_role_assignments (tenant_id, employee_id)
    WHERE effective_to IS NULL;

-- The remediation question "which Employees have no current Job Role?" and history reads.
CREATE INDEX employee_job_role_history_by_employee ON employee_job_role_assignments (tenant_id, employee_id, effective_from DESC, id DESC);

CREATE FUNCTION refuse_job_role_history_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'employee_job_role_assignments keeps history: DELETE is refused';
    END IF;
    IF OLD.effective_to IS NOT NULL THEN
        RAISE EXCEPTION 'employee_job_role_assignments keeps history: an ended assignment is immutable';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.job_role_id IS DISTINCT FROM OLD.job_role_id
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
       OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.effective_to IS NULL THEN
        RAISE EXCEPTION 'employee_job_role_assignments keeps history: the only permitted change ends a current assignment';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_job_role_assignments_keep_history
    BEFORE UPDATE OR DELETE ON employee_job_role_assignments
    FOR EACH ROW EXECUTE FUNCTION refuse_job_role_history_mutation();

-- Down Migration
-- REFUSE, NEVER DESTROY: Job Role history, the catalog and its grants are business and authorization facts.
DO $$
DECLARE
    assignments BIGINT;
    roles BIGINT;
    grants BIGINT;
BEGIN
    SELECT count(*) INTO assignments FROM eos_workforce.employee_job_role_assignments;
    SELECT count(*) INTO roles FROM eos_workforce.job_roles;
    SELECT count(*) INTO grants FROM eos_policy.role_capabilities WHERE capability_id = 'cap_admin_employeeJobRole_write';
    IF assignments > 0 OR roles > 0 OR grants > 0 THEN
        RAISE EXCEPTION 'this migration refuses to reverse: % Job Role assignment(s), % catalog role(s) and % grant(s) are recorded',
            assignments, roles, grants
            USING HINT = 'Export the history and withdraw the grants deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS employee_job_role_assignments_keep_history ON eos_workforce.employee_job_role_assignments;
DROP FUNCTION IF EXISTS eos_workforce.refuse_job_role_history_mutation();
DROP TABLE IF EXISTS eos_workforce.employee_job_role_assignments;
DROP TABLE IF EXISTS eos_workforce.job_roles;
DELETE FROM eos_policy.capabilities WHERE id = 'cap_admin_employeeJobRole_write';
