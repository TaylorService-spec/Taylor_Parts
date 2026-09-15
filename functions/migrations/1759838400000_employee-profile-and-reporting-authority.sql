-- Up Migration
-- Employee PROFILE facts, the person-level REPORTING RELATIONSHIP, and the Employee read vocabulary.
--
-- ============================================================================
-- MIGRATION (Employee runtime lane, Owner rulings A-F, 2026-09-14). Additive: no existing migration is edited, no
-- existing column is altered or dropped, no existing constraint changes, and no Role is granted anything.
-- ============================================================================
--
-- ════════════════════ 1. CAPABILITY VOCABULARY (definitions, not grants) ════════════════════
--
--   employee.record.read          NEW (ruling A). Read an Employee BUSINESS record and the bounded Employee directory
--                                 projection. Confers no Principal access state, Role, credential/provider identity,
--                                 Job Role, ownership mutation or Employee mutation.
--   admin.principalAccess.read    catalog-only until now (permissionCatalog.ts). Ruling B: reading ANOTHER Employee's
--                                 Principal linkage reuses it.
--   admin.employeeProfile.write   catalog-only until now (employeeProfileCommands.ts EMPLOYEE_PROFILE_CAPABILITY). The
--                                 governed reporting-relationship writer requires it; no new write id is invented.
--
-- Exactly migration 006/023's shape: rows in eos_policy.capabilities and nothing else. Who HOLDS them is delivered
-- by the existing grant mechanism (the Role catalog in access/compatibilityRoles.ts + governedBusinessRoles.ts,
-- reconciled into role_capabilities by the operator grant tool), never by SQL here.
--
-- ════════════════════ 2. PROFILE FACTS ON eos_workforce.employees ════════════════════
--
-- Source of every column: access/employeeProfileCommands.ts EDITABLE_EMPLOYEE_FIELDS (:198-220), the governed
-- Firestore profile command, and its validators. Every column is NULLABLE: legacy records legitimately lack each
-- one, and the command's own normalizeText (:284-293) stores absence as null, never "".
--
--   display_name       STORED, not derived-only. Evidence that it is an independent governed fact: it is an
--                      editable field of the command (:199); the client profile declares it `required: true` and
--                      "the only name every write path sets" (field-ops-app-vite/src/domain/employeeProfile.js:65,149);
--                      provisionEmployeeAccess.js:397-398 refuses to create an Employee without it. It is NEVER
--                      eos_policy.principals.display_name (an identity fact). The READ-side display name is derived
--                      deterministically: preferred_name, else display_name, else first_name + ' ' + last_name
--                      (whichever are present), else null -- the first two steps are employeeProfile.js:154-159.
--   employee_number    shape ^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$ (:155); UNIQUE CASE-INSENSITIVELY among non-null
--                      values PER TENANT -- the command enforces a case-insensitive registry keyed by
--                      normalizeEmployeeNumberKey = toUpperCase (:160-162, :547-564). One Firestore project is one
--                      tenant, so the registry's scope is the tenant; never global.
--   address_*          the command's canonical STRUCTURED address: address.street/unit/city/state/postalCode
--                      (:209-213). Five typed columns, not a JSON value.
--   hire_date, separation_date   DATE: the command stores calendar days (YYYY-MM-DD, :166). NO ordering CHECK -- the
--                      command enforces none, and inventing one here would refuse records its source accepts.
--   work_email         the command's structural shape only (:298).
--   text bound         200 characters, trimmed, non-empty (MAX_TEXT_LENGTH :111, normalizeText).
--
-- NOT CARRIED: operationalRoles (ruling E -- not a Job Role, not a Security Role, not a grant), securityRole, userId /
-- any Firebase uid, managerEmployeeId (a relationship, section 3), and no Job Role of any kind.
--
-- ════════════════════ 3. REPORTING RELATIONSHIP (ruling D) ════════════════════
--
-- NOT a column. The source is ONE managerEmployeeId per Employee (:214, :531-541): single primary manager, no
-- dotted-line or multiple-manager semantics anywhere in the repository, and the command refuses self-management.
--
--   * same-tenant composite FKs onto employees (tenant_id, id) -- a cross-tenant manager is unrepresentable
--   * employee_id <> manager_employee_id
--   * at most ONE current relationship per Employee: partial UNIQUE WHERE effective_to IS NULL
--   * history is kept: DELETE is refused by trigger; the only permitted UPDATE ends a current row once
--     (effective_to, ended_by, ended_at), every other column is immutable
--   * established_by / ended_by name the EOS Principal (governed command) or the cutover operator
--     (`employee-profile-cutover:<operator>`) -- never a Firebase uid
--   * source: GOVERNED_COMMAND or LEGACY_PROFILE_MIGRATION (a migrated row asserts "current as of the snapshot
--     export", never a fabricated start date)
-- It is not the Security Role hierarchy, not a Job Role, and not ownership, accountability or assignment.

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_employee_record_read',
     'employee.record.read',
     'Read an Employee business record and the bounded Employee directory projection. Confers no Principal access state, Role, credential or provider identity, Job Role, ownership mutation or Employee mutation.'),
    ('cap_admin_principalAccess_read',
     'admin.principalAccess.read',
     'Read one principal''s current access state, including the Principal linked to another Employee. Confers no change of any kind.'),
    ('cap_admin_employeeProfile_write',
     'admin.employeeProfile.write',
     'Edit an Employee''s profile and employment record, including establishing or ending the reporting relationship. Confers no access change.');

SET search_path = eos_workforce, public;

ALTER TABLE employees
    ADD COLUMN employee_number     TEXT,
    ADD COLUMN display_name        TEXT,
    ADD COLUMN first_name          TEXT,
    ADD COLUMN middle_name         TEXT,
    ADD COLUMN last_name           TEXT,
    ADD COLUMN preferred_name      TEXT,
    ADD COLUMN job_title           TEXT,
    ADD COLUMN work_email          TEXT,
    ADD COLUMN work_phone          TEXT,
    ADD COLUMN mobile_phone        TEXT,
    ADD COLUMN address_street      TEXT,
    ADD COLUMN address_unit        TEXT,
    ADD COLUMN address_city        TEXT,
    ADD COLUMN address_state       TEXT,
    ADD COLUMN address_postal_code TEXT,
    ADD COLUMN hire_date           DATE,
    ADD COLUMN separation_date     DATE;

ALTER TABLE employees
    ADD CONSTRAINT employees_profile_text_shape CHECK (
        (display_name        IS NULL OR (display_name        <> '' AND btrim(display_name)        = display_name        AND char_length(display_name)        <= 200))
    AND (first_name          IS NULL OR (first_name          <> '' AND btrim(first_name)          = first_name          AND char_length(first_name)          <= 200))
    AND (middle_name         IS NULL OR (middle_name         <> '' AND btrim(middle_name)         = middle_name         AND char_length(middle_name)         <= 200))
    AND (last_name           IS NULL OR (last_name           <> '' AND btrim(last_name)           = last_name           AND char_length(last_name)           <= 200))
    AND (preferred_name      IS NULL OR (preferred_name      <> '' AND btrim(preferred_name)      = preferred_name      AND char_length(preferred_name)      <= 200))
    AND (job_title           IS NULL OR (job_title           <> '' AND btrim(job_title)           = job_title           AND char_length(job_title)           <= 200))
    AND (work_phone          IS NULL OR (work_phone          <> '' AND btrim(work_phone)          = work_phone          AND char_length(work_phone)          <= 200))
    AND (mobile_phone        IS NULL OR (mobile_phone        <> '' AND btrim(mobile_phone)        = mobile_phone        AND char_length(mobile_phone)        <= 200))
    AND (address_street      IS NULL OR (address_street      <> '' AND btrim(address_street)      = address_street      AND char_length(address_street)      <= 200))
    AND (address_unit        IS NULL OR (address_unit        <> '' AND btrim(address_unit)        = address_unit        AND char_length(address_unit)        <= 200))
    AND (address_city        IS NULL OR (address_city        <> '' AND btrim(address_city)        = address_city        AND char_length(address_city)        <= 200))
    AND (address_state       IS NULL OR (address_state       <> '' AND btrim(address_state)       = address_state       AND char_length(address_state)       <= 200))
    AND (address_postal_code IS NULL OR (address_postal_code <> '' AND btrim(address_postal_code) = address_postal_code AND char_length(address_postal_code) <= 200))
    ),
    ADD CONSTRAINT employees_work_email_shape CHECK (
        work_email IS NULL OR (char_length(work_email) <= 200 AND work_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    ),
    ADD CONSTRAINT employees_employee_number_shape CHECK (
        employee_number IS NULL OR employee_number ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'
    );

-- Case-insensitive, tenant-scoped, non-null only: the command's registry rule, and nothing wider.
CREATE UNIQUE INDEX employees_employee_number_unique_per_tenant
    ON employees (tenant_id, upper(employee_number))
    WHERE employee_number IS NOT NULL;

CREATE TABLE employee_reporting_relationships (
    id                  TEXT PRIMARY KEY,
    tenant_id           TEXT        NOT NULL REFERENCES eos_policy.tenants(id),
    employee_id         TEXT        NOT NULL,
    manager_employee_id TEXT        NOT NULL,
    effective_from      TIMESTAMPTZ NOT NULL,
    effective_to        TIMESTAMPTZ,
    established_by      TEXT        NOT NULL,
    established_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_by            TEXT,
    ended_at            TIMESTAMPTZ,
    source              TEXT        NOT NULL,
    reason              TEXT,

    CONSTRAINT reporting_employee_fk FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
    CONSTRAINT reporting_manager_fk  FOREIGN KEY (tenant_id, manager_employee_id) REFERENCES employees (tenant_id, id),
    CONSTRAINT reporting_not_self CHECK (employee_id <> manager_employee_id),
    CONSTRAINT reporting_source_known CHECK (source IN ('GOVERNED_COMMAND', 'LEGACY_PROFILE_MIGRATION')),
    CONSTRAINT reporting_period_ordered CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CONSTRAINT reporting_end_is_complete CHECK (
        (effective_to IS NULL AND ended_by IS NULL AND ended_at IS NULL)
        OR (effective_to IS NOT NULL AND ended_by IS NOT NULL AND btrim(ended_by) <> '' AND ended_at IS NOT NULL)
    ),
    CONSTRAINT reporting_established_by_present CHECK (btrim(established_by) <> ''),
    CONSTRAINT reporting_reason_length CHECK (reason IS NULL OR (btrim(reason) <> '' AND char_length(reason) <= 500))
);

-- At most ONE current (primary) manager per Employee.
CREATE UNIQUE INDEX employee_reporting_one_current_per_employee
    ON employee_reporting_relationships (tenant_id, employee_id)
    WHERE effective_to IS NULL;

-- "Who reports to this manager now?"
CREATE INDEX employee_reporting_current_by_manager
    ON employee_reporting_relationships (tenant_id, manager_employee_id, employee_id)
    WHERE effective_to IS NULL;

CREATE FUNCTION refuse_reporting_history_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'employee_reporting_relationships keeps history: DELETE is refused'
            USING HINT = 'End a relationship by setting effective_to through the governed command.';
    END IF;
    IF OLD.effective_to IS NOT NULL THEN
        RAISE EXCEPTION 'employee_reporting_relationships keeps history: an ended relationship is immutable';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.manager_employee_id IS DISTINCT FROM OLD.manager_employee_id
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.established_by IS DISTINCT FROM OLD.established_by
       OR NEW.established_at IS DISTINCT FROM OLD.established_at OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.effective_to IS NULL THEN
        RAISE EXCEPTION 'employee_reporting_relationships keeps history: the only permitted change ends a current relationship';
    END IF;
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_reporting_relationships_keep_history
    BEFORE UPDATE OR DELETE ON employee_reporting_relationships
    FOR EACH ROW EXECUTE FUNCTION refuse_reporting_history_mutation();

-- Down Migration
-- REFUSE, NEVER DESTROY: reporting history, profile facts and Role grants are business and authorization facts.
DO $$
DECLARE
    relationships BIGINT;
    profiles BIGINT;
    grants BIGINT;
BEGIN
    SELECT count(*) INTO relationships FROM eos_workforce.employee_reporting_relationships;
    SELECT count(*) INTO profiles FROM eos_workforce.employees
     WHERE employee_number IS NOT NULL OR display_name IS NOT NULL OR first_name IS NOT NULL OR middle_name IS NOT NULL
        OR last_name IS NOT NULL OR preferred_name IS NOT NULL OR job_title IS NOT NULL OR work_email IS NOT NULL
        OR work_phone IS NOT NULL OR mobile_phone IS NOT NULL OR address_street IS NOT NULL OR address_unit IS NOT NULL
        OR address_city IS NOT NULL OR address_state IS NOT NULL OR address_postal_code IS NOT NULL
        OR hire_date IS NOT NULL OR separation_date IS NOT NULL;
    SELECT count(*) INTO grants FROM eos_policy.role_capabilities
     WHERE capability_id IN ('cap_employee_record_read', 'cap_admin_principalAccess_read', 'cap_admin_employeeProfile_write');
    IF relationships > 0 OR profiles > 0 OR grants > 0 THEN
        RAISE EXCEPTION
            'this migration refuses to reverse: % reporting relationship(s), % Employee profile(s) and % Role grant(s) are recorded',
            relationships, profiles, grants
            USING HINT = 'Export the history and withdraw the grants deliberately first, or do not reverse it.';
    END IF;
END
$$;

DROP TRIGGER IF EXISTS employee_reporting_relationships_keep_history ON eos_workforce.employee_reporting_relationships;
DROP FUNCTION IF EXISTS eos_workforce.refuse_reporting_history_mutation();
DROP TABLE IF EXISTS eos_workforce.employee_reporting_relationships;
DROP INDEX IF EXISTS eos_workforce.employees_employee_number_unique_per_tenant;
ALTER TABLE eos_workforce.employees
    DROP CONSTRAINT IF EXISTS employees_employee_number_shape,
    DROP CONSTRAINT IF EXISTS employees_work_email_shape,
    DROP CONSTRAINT IF EXISTS employees_profile_text_shape,
    DROP COLUMN IF EXISTS separation_date, DROP COLUMN IF EXISTS hire_date, DROP COLUMN IF EXISTS address_postal_code,
    DROP COLUMN IF EXISTS address_state, DROP COLUMN IF EXISTS address_city, DROP COLUMN IF EXISTS address_unit,
    DROP COLUMN IF EXISTS address_street, DROP COLUMN IF EXISTS mobile_phone, DROP COLUMN IF EXISTS work_phone,
    DROP COLUMN IF EXISTS work_email, DROP COLUMN IF EXISTS job_title, DROP COLUMN IF EXISTS preferred_name,
    DROP COLUMN IF EXISTS last_name, DROP COLUMN IF EXISTS middle_name, DROP COLUMN IF EXISTS first_name,
    DROP COLUMN IF EXISTS display_name, DROP COLUMN IF EXISTS employee_number;
DELETE FROM eos_policy.capabilities
 WHERE id IN ('cap_employee_record_read', 'cap_admin_principalAccess_read', 'cap_admin_employeeProfile_write');
