-- Up Migration
-- EMPLOYEE OPERATIONAL SCOPE authority (Owner ruling 2026-09-17, operationalRoles decomposition, step B).
--
-- ============================================================================
-- WHAT THIS IS. An Operational Scope row answers exactly one question: "is this Employee authorized for THIS
-- particular warehouse/location/context?" It is the third of three INDEPENDENT authorities the legacy
-- `operationalRoles` field conflated:
--
--   SECURITY CAPABILITY   can this Principal use this application capability?   eos_policy (the FIRST boundary)
--   WORK ELIGIBILITY      is this Employee qualified for this kind of work?     employee_work_eligibility (step A)
--   OPERATIONAL SCOPE     is this Employee authorized for this warehouse?       <- THIS MIGRATION
--
-- A governed command may require one, two or all three, CHECKED SEPARATELY. The old fused boolean is exactly what
-- this decomposition exists to end: `firestore.rules` isAssignedToWarehouse() answered
-- "operationalRoles.hasAny([WAREHOUSE_MANAGER]) AND assignedWarehouseIds.hasAny([warehouseId])" in one opaque test,
-- conflating a qualification with a scope. Here, scope answers ONLY the scope question:
--
--   employeeHasWarehouseScope(employeeId, warehouseId)   ->   "is this Employee explicitly scoped to this warehouse?"
--
-- It does NOT answer "does the Principal have permission?" and it does NOT answer "is the Employee qualified for
-- warehouse operations?" Those are the other two authorities.
--
-- SCOPE GRANTS NO APPLICATION ACCESS (Owner ruling). Being scoped to a warehouse confers no Security Role, capability,
-- permission, Job Role, qualification, ownership, assignment, reporting or operating-company authority. Nothing in
-- this schema can grant access, or express a qualification, by construction: there is no capability, permission, role
-- or qualification column. Scope must never substitute for qualification, and qualification must never substitute for
-- scope.
--
-- REPLACES THE FIRESTORE ARRAY AS AUTHORITY, NOT BY COPYING IT. The legacy `employees.assignedWarehouseIds` array is
-- the correct latent seam (Owner ruling), but the ARRAY never becomes the authority: these normalized, effective-dated
-- rows do. This migration performs NO backfill -- the array is migration EVIDENCE for the governed dry-run/census
-- tooling (steps D/E) only, and only where the Employee resolves exactly, the warehouse id resolves exactly, both are
-- in the same tenant, the warehouse is a governed ACTIVE location and there is no ambiguity. Unknown, stale,
-- cross-tenant or non-resolving ids become remediation findings. Nothing is guessed.
--
-- ONE SCOPE TYPE, DELIBERATELY. `scope_type` is constrained to WAREHOUSE alone: the ruling forbids building arbitrary
-- scope types before a live consumer requires them. While that holds, (tenant_id, scope_id) carries a real composite
-- FOREIGN KEY to eos_ops.warehouses, so "the warehouse resolves exactly, in the same tenant" is structural rather
-- than conventional and a fabricated scope is impossible. Adding a second scope type is therefore a reviewed
-- migration that must revisit that foreign key -- which is the intended cost.
--
-- NOT OPERATING COMPANY (Owner ruling). Operating Company already has its own governed Employee authority
-- (eos_workforce.employees.operating_company_id, EMP-RT-W2). It is deliberately NOT duplicated here merely to make
-- the abstraction look complete.
--
-- A GOVERNED ACTIVE LOCATION. The foreign key proves the warehouse EXISTS in this tenant; it cannot prove the
-- warehouse is still ACTIVE, because status changes after the fact. The governed writer (step C) checks ACTIVE status
-- at assignment time; an existing scope whose warehouse later goes INACTIVE is a remediation finding, not a silent
-- revocation.
--
--   employee_operational_scopes   append-only, effective-dated history. At most ONE CURRENT (effective_to IS NULL)
--                                 row per (Employee, scope_type, scope_id) -- an Employee may hold MULTIPLE active
--                                 warehouse scopes at once, and may hold none. The only permitted UPDATE ends a
--                                 current row once; DELETE is refused.
--
-- CAPABILITY VOCABULARY (definition, not a grant): admin.employeeOperationalScope.write. By Owner ruling it is a
-- SEPARATE capability from admin.employeeWorkEligibility.write: deciding which warehouses an Employee covers is not
-- the same authority as deciding what kind of work they are qualified for. Who holds it comes from the Role catalog
-- via the existing grant reconciliation, never from SQL here.
-- ============================================================================

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_admin_employeeOperationalScope_write',
     'admin.employeeOperationalScope.write',
     'Assign and end an Employee''s operational scopes -- the specific warehouses they are authorized for. A scope confers no Security Role, capability, permission, Job Role, work-eligibility qualification, ownership, assignment, reporting or operating-company authority, and never grants application access.');

SET search_path = eos_workforce, public;

CREATE TABLE employee_operational_scopes (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    employee_id     TEXT        NOT NULL,
    scope_type      TEXT        NOT NULL,
    scope_id        TEXT        NOT NULL,
    effective_from  TIMESTAMPTZ NOT NULL,
    effective_to    TIMESTAMPTZ,
    assigned_by     TEXT        NOT NULL,
    ended_by        TEXT,
    ended_at        TIMESTAMPTZ,
    reason          TEXT,

    CONSTRAINT operational_scope_employee_fk FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
    -- WAREHOUSE alone until a live consumer proves another type is required. Widening this is a reviewed migration
    -- that must also revisit the warehouse foreign key below.
    CONSTRAINT operational_scope_type_known CHECK (scope_type IN ('WAREHOUSE')),
    -- "The warehouse resolves exactly, in the same tenant" -- enforced, not assumed. Valid only while WAREHOUSE is
    -- the sole scope type.
    CONSTRAINT operational_scope_warehouse_fk FOREIGN KEY (tenant_id, scope_id) REFERENCES eos_ops.warehouses (tenant_id, id),
    CONSTRAINT operational_scope_period_ordered CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT operational_scope_end_is_complete CHECK (
        (effective_to IS NULL AND ended_by IS NULL AND ended_at IS NULL)
        OR (effective_to IS NOT NULL AND ended_by IS NOT NULL AND btrim(ended_by) <> '' AND ended_at IS NOT NULL)
    ),
    CONSTRAINT operational_scope_assigned_by_present CHECK (btrim(assigned_by) <> ''),
    CONSTRAINT operational_scope_reason_length CHECK (reason IS NULL OR (btrim(reason) <> '' AND char_length(reason) <= 500))
);

-- One CURRENT row per (Employee, scope_type, scope_id). MULTIPLE different warehouses may be current at once.
CREATE UNIQUE INDEX employee_operational_scope_one_current_per_target
    ON employee_operational_scopes (tenant_id, employee_id, scope_type, scope_id)
    WHERE effective_to IS NULL;

-- employeeHasWarehouseScope(employeeId, warehouseId), and "who currently covers this warehouse?".
CREATE INDEX employee_operational_scope_current_by_target
    ON employee_operational_scopes (tenant_id, scope_type, scope_id)
    WHERE effective_to IS NULL;

-- "What has this Employee covered, and when?" -- history reads and remediation.
CREATE INDEX employee_operational_scope_history_by_employee
    ON employee_operational_scopes (tenant_id, employee_id, effective_from DESC, id DESC);

CREATE FUNCTION refuse_operational_scope_history_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'employee_operational_scopes keeps history: DELETE is refused';
    END IF;
    IF OLD.effective_to IS NOT NULL THEN
        RAISE EXCEPTION 'employee_operational_scopes keeps history: an ended scope is immutable';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.scope_type IS DISTINCT FROM OLD.scope_type
       OR NEW.scope_id IS DISTINCT FROM OLD.scope_id OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.effective_to IS NULL THEN
        RAISE EXCEPTION 'employee_operational_scopes keeps history: the only permitted change ends a current scope';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_operational_scopes_keep_history
    BEFORE UPDATE OR DELETE ON employee_operational_scopes
    FOR EACH ROW EXECUTE FUNCTION refuse_operational_scope_history_mutation();

-- Down Migration
-- REFUSE, NEVER DESTROY: scope history is a business fact, and the grant is an authorization fact.
DO $$
DECLARE
    scopes BIGINT;
    grants BIGINT;
BEGIN
    SELECT count(*) INTO scopes FROM eos_workforce.employee_operational_scopes;
    SELECT count(*) INTO grants FROM eos_policy.role_capabilities WHERE capability_id = 'cap_admin_employeeOperationalScope_write';
    IF scopes > 0 OR grants > 0 THEN
        RAISE EXCEPTION 'this migration refuses to reverse: % operational scope row(s) and % grant(s) are recorded',
            scopes, grants
            USING HINT = 'Export the history and withdraw the grants deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS employee_operational_scopes_keep_history ON eos_workforce.employee_operational_scopes;
DROP FUNCTION IF EXISTS eos_workforce.refuse_operational_scope_history_mutation();
DROP TABLE IF EXISTS eos_workforce.employee_operational_scopes;
DELETE FROM eos_policy.capabilities WHERE id = 'cap_admin_employeeOperationalScope_write';
