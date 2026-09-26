-- Up Migration
-- EMPLOYEE FUNCTIONAL ROLE authority (lane FR, 2026-09-26; pass8 §8.3 smallest governed model).
--
-- ============================================================================
-- WHAT THIS IS. A Functional Role is an Employee's BUSINESS RESPONSIBILITY / FUNCTION ("responsible for warranty
-- claims", "vendor-returns coordinator"). It is the FOURTH independent Employee fact:
--
--   JOB ROLE           the Employee's position (one current)                eos_workforce.job_roles
--   WORK ELIGIBILITY   is the Employee QUALIFIED for a kind of work          eos_workforce.employee_work_eligibility
--   OPERATIONAL SCOPE  WHERE the Employee works                              eos_workforce.employee_operational_scopes
--   FUNCTIONAL ROLE    what the Employee is RESPONSIBLE for (many current)   <- THIS MIGRATION
--
-- Job Role != Security Role != Functional Role (Owner). None derives from another.
--
-- WHAT IT IS NOT, AND NEVER BECOMES. A Functional Role GRANTS NOTHING. It confers no Security Role, no capability,
-- no permission, no ownership, no assignment and no operating-company authority, and no role_capabilities or
-- principal_capabilities row can reference it (there is no column that could). Its ONLY runtime consumer is the
-- workflow engine, where a FUNCTIONAL_ROLE binding NARROWS an action that the Principal's Security Role capability
-- already authorizes: allowed <=> capability (same evaluator) AND Security Role binding (as before) AND, when the
-- action has any FUNCTIONAL_ROLE binding, the linked Employee currently holds one of them. It never widens.
--
-- The capability-granting Security Roles that older prose calls "functional Roles" (cycle-count counter/reconciler,
-- bin administrator, put-away operator, ...) are NOT touched and NOT reclassified: they stay Security Roles.
--
--   functional_roles                      the TENANT catalog: stable id, immutable key, name, description,
--                                         ACTIVE/INACTIVE. Starts EMPTY (no seed). Never deleted. A key may not
--                                         collide (case/punctuation-insensitively) with a Security Role key of the
--                                         tenant or a Work Eligibility code -- in either direction.
--   employee_functional_role_assignments  append-only, effective-dated history. MANY current per Employee; at most
--                                         ONE open row per (Employee, Functional Role) and no overlapping periods.
--                                         Only an ACTIVE Functional Role may receive a new assignment. The only
--                                         permitted UPDATE ends a row once; DELETE is refused.
--   deactivation                          FAIL CLOSED: a Functional Role with current or scheduled holders cannot be
--                                         made INACTIVE (the command also refuses while an ACTIVE workflow version
--                                         binds it). End the assignments first; nothing is ended implicitly.
--   workflow_role_bindings                FUNCTIONAL_ROLE bindings name functional_role_id (tenant-composite FK);
--                                         SECURITY_ROLE bindings keep role_id. Exactly one target per kind.
--
-- CAPABILITY VOCABULARY (definition, NOT a grant): admin.employeeFunctionalRole.write (employee / setFunctionalRole).
-- Granted to NO Role here and not added to the bootstrap: comparable Employee administration keys
-- (admin.employeeJobRole.write, admin.employeeWorkEligibility.write) are not bootstrap grants either. Holders are
-- configured through Administration (grantObjectActionToRole employee/setFunctionalRole), under the Pass 8
-- no-self-grant / no-self-assign rules. Reads reuse employee.record.read, like Job Role and Work Eligibility reads.
--
-- Counts: capabilities +1; role_capabilities unchanged; tables +2.
-- ============================================================================

SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    -- A FUNCTIONAL_ROLE binding written before this migration named a SECURITY Role in role_id: meaningless, and
    -- never publishable (UNSUPPORTED_BINDING_KIND). Refuse rather than reinterpret it.
    SELECT count(*) INTO v_n FROM workflow_role_bindings WHERE binding_kind = 'FUNCTIONAL_ROLE';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'FUNCTIONAL_ROLE_AUTHORITY: % pre-existing FUNCTIONAL_ROLE binding(s) name a Security Role; remove the drafts first', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key = 'admin.employeeFunctionalRole.write' OR (object_key = 'employee' AND action_key = 'setFunctionalRole');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'FUNCTIONAL_ROLE_AUTHORITY: admin.employeeFunctionalRole.write / employee.setFunctionalRole is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_admin_employeeFunctionalRole_write', 'admin.employeeFunctionalRole.write',
     'Maintain the tenant Functional Role catalog and assign or end an Employee''s Functional Roles. A Functional Role is a business responsibility only: it confers no Security Role, capability, permission, ownership, assignment or operating-company authority, and in a workflow it can only narrow an action a Security Role capability already authorizes.',
     'employee', 'setFunctionalRole', 'ADMIN_ACTION', 'Set Functional Role');

SET search_path = eos_workforce, public;

-- The collision rule's one spelling: case and punctuation do not make two identities.
CREATE FUNCTION functional_role_key_norm(value TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT lower(regexp_replace(value, '[^A-Za-z0-9]', '', 'g')) $$;

-- The Work Eligibility platform vocabulary, as the collision rule sees it. Mirrors the CHECK constraint on
-- employee_work_eligibility (work_eligibility_code_known); the PostgreSQL suite pins the two equal.
CREATE FUNCTION functional_role_reserved_eligibility_codes() RETURNS TEXT[]
LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY['SERVICE_TECHNICIAN', 'WAREHOUSE_OPERATIONS', 'PARTS_OPERATIONS']::TEXT[] $$;

CREATE TABLE functional_roles (
    tenant_id    TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    id           TEXT        NOT NULL,
    key          TEXT        NOT NULL,
    name         TEXT        NOT NULL,
    description  TEXT,
    status       TEXT        NOT NULL,
    created_by   TEXT        NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by   TEXT        NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (tenant_id, id),
    CONSTRAINT functional_roles_id_shape CHECK (id ~ '^fr_[a-z0-9-]{8,64}$'),
    CONSTRAINT functional_roles_key_shape CHECK (key ~ '^[a-z][a-z0-9-]{1,62}$'),
    CONSTRAINT functional_roles_name_shape CHECK (name <> '' AND btrim(name) = name AND char_length(name) <= 100),
    CONSTRAINT functional_roles_description_shape CHECK (description IS NULL OR (btrim(description) <> '' AND char_length(description) <= 500)),
    CONSTRAINT functional_roles_status_known CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT functional_roles_actors_present CHECK (btrim(created_by) <> '' AND btrim(updated_by) <> '')
);

CREATE UNIQUE INDEX functional_roles_key_unique_per_tenant ON functional_roles (tenant_id, key);
CREATE UNIQUE INDEX functional_roles_key_norm_unique_per_tenant ON functional_roles (tenant_id, functional_role_key_norm(key));
CREATE UNIQUE INDEX functional_roles_name_unique_per_tenant ON functional_roles (tenant_id, lower(name));

CREATE FUNCTION functional_roles_guard() RETURNS trigger AS $$
DECLARE
    v_holders INT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'FUNCTIONAL_ROLE_IMMUTABLE: a Functional Role is never deleted; deactivate it';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                             OR NEW.key IS DISTINCT FROM OLD.key) THEN
        RAISE EXCEPTION 'FUNCTIONAL_ROLE_IMMUTABLE: a Functional Role''s id, tenant and key cannot change';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF EXISTS (SELECT 1 FROM eos_policy.roles r
                    WHERE r.tenant_id = NEW.tenant_id AND eos_workforce.functional_role_key_norm(r.key) = eos_workforce.functional_role_key_norm(NEW.key)) THEN
            RAISE EXCEPTION 'FUNCTIONAL_ROLE_KEY_COLLISION: "%" collides with a Security Role key of this tenant', NEW.key;
        END IF;
        IF EXISTS (SELECT 1 FROM unnest(eos_workforce.functional_role_reserved_eligibility_codes()) c
                    WHERE eos_workforce.functional_role_key_norm(c) = eos_workforce.functional_role_key_norm(NEW.key)) THEN
            RAISE EXCEPTION 'FUNCTIONAL_ROLE_KEY_COLLISION: "%" collides with a Work Eligibility code', NEW.key;
        END IF;
    END IF;
    -- FAIL CLOSED: deactivation never ends an assignment implicitly. A cancelled (zero-length) period is no holder.
    IF TG_OP = 'UPDATE' AND OLD.status = 'ACTIVE' AND NEW.status = 'INACTIVE' THEN
        SELECT count(*) INTO v_holders FROM eos_workforce.employee_functional_role_assignments a
         WHERE a.tenant_id = NEW.tenant_id AND a.functional_role_id = NEW.id
           AND (a.effective_to IS NULL OR (a.effective_to > now() AND a.effective_to > a.effective_from));
        IF v_holders > 0 THEN
            RAISE EXCEPTION 'FUNCTIONAL_ROLE_HAS_CURRENT_HOLDERS: % current or scheduled assignment(s) must be ended before deactivation', v_holders;
        END IF;
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- The reverse direction: a Security Role may not be created (or re-keyed) onto a Functional Role key.
CREATE FUNCTION security_role_key_not_functional_role() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.key IS NOT DISTINCT FROM OLD.key THEN
        RETURN NEW;
    END IF;
    IF EXISTS (SELECT 1 FROM eos_workforce.functional_roles f
                WHERE f.tenant_id = NEW.tenant_id
                  AND eos_workforce.functional_role_key_norm(f.key) = eos_workforce.functional_role_key_norm(NEW.key)) THEN
        RAISE EXCEPTION 'FUNCTIONAL_ROLE_KEY_COLLISION: Security Role key "%" collides with a Functional Role of this tenant', NEW.key;
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TABLE employee_functional_role_assignments (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    employee_id         TEXT        NOT NULL,
    functional_role_id  TEXT        NOT NULL,
    effective_from      TIMESTAMPTZ NOT NULL,
    effective_to        TIMESTAMPTZ,
    -- Provenance: who asserted it, when, through which governed path, and why.
    assignment_source   TEXT        NOT NULL DEFAULT 'ADMINISTRATION',
    assigned_by         TEXT        NOT NULL,
    assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason              TEXT        NOT NULL,
    ended_by            TEXT,
    ended_at            TIMESTAMPTZ,
    end_reason          TEXT,

    CONSTRAINT functional_role_assignment_employee_fk FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
    CONSTRAINT functional_role_assignment_role_fk     FOREIGN KEY (tenant_id, functional_role_id) REFERENCES functional_roles (tenant_id, id),
    CONSTRAINT functional_role_assignment_source_known CHECK (assignment_source IN ('ADMINISTRATION')),
    CONSTRAINT functional_role_assignment_period_ordered CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT functional_role_assignment_end_is_complete CHECK (
        (effective_to IS NULL AND ended_by IS NULL AND ended_at IS NULL AND end_reason IS NULL)
        OR (effective_to IS NOT NULL AND ended_by IS NOT NULL AND btrim(ended_by) <> '' AND ended_at IS NOT NULL)
    ),
    CONSTRAINT functional_role_assignment_assigned_by_present CHECK (btrim(assigned_by) <> ''),
    CONSTRAINT functional_role_assignment_reason_shape CHECK (btrim(reason) <> '' AND char_length(reason) <= 500),
    CONSTRAINT functional_role_assignment_end_reason_shape CHECK (end_reason IS NULL OR (btrim(end_reason) <> '' AND char_length(end_reason) <= 500))
);

-- At most ONE open row per (Employee, Functional Role). Different Functional Roles may be current together.
CREATE UNIQUE INDEX employee_functional_role_one_open_per_role
    ON employee_functional_role_assignments (tenant_id, employee_id, functional_role_id)
    WHERE effective_to IS NULL;

-- "Who currently holds this Functional Role?" -- holders read, deactivation guard, workflow runtime.
CREATE INDEX employee_functional_role_open_by_role
    ON employee_functional_role_assignments (tenant_id, functional_role_id)
    WHERE effective_to IS NULL;

CREATE INDEX employee_functional_role_history_by_employee
    ON employee_functional_role_assignments (tenant_id, employee_id, effective_from DESC, id DESC);

CREATE FUNCTION employee_functional_role_assignment_guard() RETURNS trigger AS $$
DECLARE
    v_status TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'employee_functional_role_assignments keeps history: DELETE is refused';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT status INTO v_status FROM eos_workforce.functional_roles WHERE tenant_id = NEW.tenant_id AND id = NEW.functional_role_id;
        IF v_status IS DISTINCT FROM 'ACTIVE' THEN
            RAISE EXCEPTION 'FUNCTIONAL_ROLE_INACTIVE: an inactive Functional Role cannot receive a new assignment';
        END IF;
        IF NEW.effective_to IS NOT NULL THEN
            RAISE EXCEPTION 'employee_functional_role_assignments: an assignment is inserted open and ended by an update';
        END IF;
        IF EXISTS (SELECT 1 FROM eos_workforce.employee_functional_role_assignments a
                    WHERE a.tenant_id = NEW.tenant_id AND a.employee_id = NEW.employee_id
                      AND a.functional_role_id = NEW.functional_role_id
                      AND (a.effective_to IS NULL OR (a.effective_to > NEW.effective_from AND a.effective_to > a.effective_from))) THEN
            RAISE EXCEPTION 'FUNCTIONAL_ROLE_ASSIGNMENT_OVERLAP: the Employee already holds this Functional Role for an overlapping period';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.effective_to IS NOT NULL THEN
        RAISE EXCEPTION 'employee_functional_role_assignments keeps history: an ended assignment is immutable';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.functional_role_id IS DISTINCT FROM OLD.functional_role_id
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
       OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at OR NEW.assignment_source IS DISTINCT FROM OLD.assignment_source
       OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.effective_to IS NULL THEN
        RAISE EXCEPTION 'employee_functional_role_assignments keeps history: the only permitted change ends an open assignment';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER functional_roles_guard
    BEFORE INSERT OR UPDATE OR DELETE ON functional_roles
    FOR EACH ROW EXECUTE FUNCTION functional_roles_guard();

CREATE TRIGGER employee_functional_role_assignments_guard
    BEFORE INSERT OR UPDATE OR DELETE ON employee_functional_role_assignments
    FOR EACH ROW EXECUTE FUNCTION employee_functional_role_assignment_guard();

CREATE TRIGGER roles_key_not_functional_role
    BEFORE INSERT OR UPDATE OF key ON eos_policy.roles
    FOR EACH ROW EXECUTE FUNCTION security_role_key_not_functional_role();

-- ════════════════════ workflow bindings: FUNCTIONAL_ROLE names a Functional Role ════════════════════

SET search_path = eos_policy, public;

ALTER TABLE workflow_role_bindings ALTER COLUMN role_id DROP NOT NULL;
ALTER TABLE workflow_role_bindings ADD COLUMN functional_role_id TEXT NULL;
ALTER TABLE workflow_role_bindings
    ADD CONSTRAINT workflow_role_bindings_functional_role_fk
    FOREIGN KEY (tenant_id, functional_role_id) REFERENCES eos_workforce.functional_roles (tenant_id, id);
ALTER TABLE workflow_role_bindings
    ADD CONSTRAINT workflow_role_bindings_target_matches_kind CHECK (
        (binding_kind = 'SECURITY_ROLE' AND role_id IS NOT NULL AND functional_role_id IS NULL)
        OR (binding_kind = 'FUNCTIONAL_ROLE' AND role_id IS NULL AND functional_role_id IS NOT NULL)
    );
CREATE UNIQUE INDEX workflow_role_bindings_functional_role_unique
    ON workflow_role_bindings (tenant_id, workflow_version_id, action_key, functional_role_id)
    WHERE functional_role_id IS NOT NULL;

-- Down Migration
-- REFUSE, NEVER DESTROY: the catalog, its assignment history, FUNCTIONAL_ROLE bindings and the grants are business
-- and authorization facts.
DO $$
DECLARE
    v_roles BIGINT;
    v_assignments BIGINT;
    v_bindings BIGINT;
    v_grants BIGINT;
BEGIN
    SELECT count(*) INTO v_roles FROM eos_workforce.functional_roles;
    SELECT count(*) INTO v_assignments FROM eos_workforce.employee_functional_role_assignments;
    SELECT count(*) INTO v_bindings FROM eos_policy.workflow_role_bindings WHERE functional_role_id IS NOT NULL;
    SELECT count(*) INTO v_grants FROM eos_policy.role_capabilities WHERE capability_id = 'cap_admin_employeeFunctionalRole_write';
    SELECT v_grants + count(*) INTO v_grants FROM eos_policy.principal_capabilities WHERE capability_id = 'cap_admin_employeeFunctionalRole_write';
    IF v_roles > 0 OR v_assignments > 0 OR v_bindings > 0 OR v_grants > 0 THEN
        RAISE EXCEPTION 'this migration refuses to reverse: % Functional Role(s), % assignment(s), % workflow binding(s) and % grant(s) are recorded',
            v_roles, v_assignments, v_bindings, v_grants
            USING HINT = 'Export the history and withdraw the grants deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP INDEX IF EXISTS eos_policy.workflow_role_bindings_functional_role_unique;
ALTER TABLE eos_policy.workflow_role_bindings
    DROP CONSTRAINT IF EXISTS workflow_role_bindings_target_matches_kind,
    DROP CONSTRAINT IF EXISTS workflow_role_bindings_functional_role_fk,
    DROP COLUMN IF EXISTS functional_role_id;
ALTER TABLE eos_policy.workflow_role_bindings ALTER COLUMN role_id SET NOT NULL;

DROP TRIGGER IF EXISTS roles_key_not_functional_role ON eos_policy.roles;
DROP TRIGGER IF EXISTS employee_functional_role_assignments_guard ON eos_workforce.employee_functional_role_assignments;
DROP TRIGGER IF EXISTS functional_roles_guard ON eos_workforce.functional_roles;
DROP TABLE IF EXISTS eos_workforce.employee_functional_role_assignments;
DROP TABLE IF EXISTS eos_workforce.functional_roles;
DROP FUNCTION IF EXISTS eos_workforce.employee_functional_role_assignment_guard();
DROP FUNCTION IF EXISTS eos_workforce.security_role_key_not_functional_role();
DROP FUNCTION IF EXISTS eos_workforce.functional_roles_guard();
DROP FUNCTION IF EXISTS eos_workforce.functional_role_reserved_eligibility_codes();
DROP FUNCTION IF EXISTS eos_workforce.functional_role_key_norm(TEXT);
DELETE FROM eos_policy.capabilities WHERE id = 'cap_admin_employeeFunctionalRole_write';
