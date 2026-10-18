-- Up Migration
-- EXPLICIT EMPLOYEE COMPANY-ACCESS GRANTS (Owner decision packet 2026-10-17, ruling 3 "COMPANY AUTHORITY", Option A; ruling #2140-R;
-- DECISIONS #249).
--
-- A company-access grant is the governed fact "this Employee may ALSO act for operating company C". It is NOT a Role
-- assignment, it is NOT in the capability catalog, it produces NO capability and NO scoped holding, and it does NOT count for
-- Finance. It is read by exactly one resolver (functions/src/eosOps/companyAuthority.ts, third source beside the home company
-- and the OPERATIONAL Role expansion of DECISIONS #235 / #248). It is described as company access, never as employment
-- membership: the Employee's employment (home) company stays eos_workforce.employees.operating_company_id.
--
-- ADDITIVE and DEFAULT-INERT: one new table, empty at deploy, with a store guard. No existing row, capability, grant or Role
-- changes meaning, and until a governed grant exists the resolver's result is exactly what it was.
--
-- GOVERNED AT THE STORE, as role_capabilities (1762646400000) and roles.company_authority_effect (1764600000000) already are: a
-- row is written only inside an Administration command (eos_policy.administration_command = 'on'), is only ever created ACTIVE
-- and only ever moves ACTIVE -> REVOKED with its other columns untouched, and is never deleted or truncated (history stays; the
-- audit event carries before/after as well). A direct write is refused with a named error.
--
-- EFFECTIVE DATES ARE SERVER TIME. effective_from defaults to now(); the resolver compares both ends to the database clock at
-- read time, so expiry and revocation take effect on the caller's very next request with no job and no cache. An
-- already-over window cannot be created (effective_until must be in the future of the database clock at creation).

SET search_path = eos_policy, public;

CREATE TABLE employee_company_authority_grants (
    id                    TEXT PRIMARY KEY,
    tenant_id             TEXT        NOT NULL,
    employee_id           TEXT        NOT NULL,
    operating_company_id  TEXT        NOT NULL,
    status                TEXT        NOT NULL DEFAULT 'active',
    effective_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_until       TIMESTAMPTZ,
    reason                TEXT        NOT NULL,
    granted_by            TEXT        NOT NULL,
    granted_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_by            TEXT,
    revoked_at            TIMESTAMPTZ,
    revoke_reason         TEXT,

    -- Same-tenant by construction: both references are composite with the tenant, so a grant can never name another
    -- tenant's Employee or another tenant's operating company.
    CONSTRAINT ecag_employee_fk FOREIGN KEY (tenant_id, employee_id)
        REFERENCES eos_workforce.employees (tenant_id, id),
    CONSTRAINT ecag_company_fk FOREIGN KEY (tenant_id, operating_company_id)
        REFERENCES tenant_operating_companies (tenant_id, operating_company_id),

    CONSTRAINT ecag_employee_id_shape CHECK (employee_id <> '' AND btrim(employee_id) = employee_id AND position('/' in employee_id) = 0),
    CONSTRAINT ecag_operating_company_shape CHECK (operating_company_id ~ '^[a-z][a-z0-9_-]{1,62}$'),
    CONSTRAINT ecag_status_known CHECK (status IN ('active', 'revoked')),
    CONSTRAINT ecag_reason_stated CHECK (btrim(reason) <> ''),
    CONSTRAINT ecag_window CHECK (effective_until IS NULL OR effective_until > effective_from),
    -- A revocation always has an author, a time and a stated reason; an active grant has none of them.
    CONSTRAINT ecag_revoke_has_author CHECK (
        (status = 'active' AND revoked_by IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'revoked' AND revoked_by IS NOT NULL AND btrim(revoked_by) <> ''
            AND revoked_at IS NOT NULL AND btrim(coalesce(revoke_reason, '')) <> '')
    )
);

-- One ACTIVE grant per (Employee, company): history survives, ambiguity does not.
CREATE UNIQUE INDEX ecag_one_active ON employee_company_authority_grants (tenant_id, employee_id, operating_company_id)
    WHERE status = 'active';
-- The lookup the resolver makes: "which companies has this Employee been granted?"
CREATE INDEX ecag_by_employee ON employee_company_authority_grants (tenant_id, employee_id, status);

COMMENT ON TABLE employee_company_authority_grants IS
    'Explicit Employee company-access grants (DECISIONS #249). Confers REACH to a company only: no capability, no Finance reach. Written only inside the Administration commands grantCompanyAuthority / revokeCompanyAuthority.';

CREATE FUNCTION employee_company_authority_grants_governed() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'COMPANY_GRANT_UNGOVERNED: a company-access grant is never deleted; revoke it through the Administration command revokeCompanyAuthority (history is kept)';
    END IF;
    IF coalesce(current_setting('eos_policy.administration_command', true), '') <> 'on' THEN
        RAISE EXCEPTION 'COMPANY_GRANT_UNGOVERNED: company-access grants change only through the Administration commands grantCompanyAuthority and revokeCompanyAuthority';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'active' THEN
            RAISE EXCEPTION 'COMPANY_GRANT_UNGOVERNED: a company-access grant is created active';
        END IF;
        IF NEW.effective_until IS NOT NULL AND NEW.effective_until <= now() THEN
            RAISE EXCEPTION 'COMPANY_GRANT_WINDOW_INVALID: the grant would already be over (effective_until must be in the future)';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM eos_policy.tenant_operating_companies c
                        WHERE c.tenant_id = NEW.tenant_id AND c.operating_company_id = NEW.operating_company_id AND c.status = 'ACTIVE') THEN
            RAISE EXCEPTION 'SCOPE_VALUE_INVALID: % is not an ACTIVE operating company of this tenant', NEW.operating_company_id;
        END IF;
        IF EXISTS (SELECT 1 FROM eos_workforce.employees e
                    WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.employee_id AND e.operating_company_id = NEW.operating_company_id) THEN
            RAISE EXCEPTION 'COMPANY_IS_HOME: % is the Employee''s own company; a company-access grant is for another company', NEW.operating_company_id;
        END IF;
        RETURN NEW;
    END IF;
    -- UPDATE: the one legal transition is ACTIVE -> REVOKED; every other column is fixed.
    IF OLD.status <> 'active' OR NEW.status <> 'revoked' THEN
        RAISE EXCEPTION 'COMPANY_GRANT_IMMUTABLE: a company-access grant only moves from active to revoked';
    END IF;
    IF ROW(NEW.id, NEW.tenant_id, NEW.employee_id, NEW.operating_company_id, NEW.effective_from, NEW.effective_until, NEW.reason, NEW.granted_by, NEW.granted_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.tenant_id, OLD.employee_id, OLD.operating_company_id, OLD.effective_from, OLD.effective_until, OLD.reason, OLD.granted_by, OLD.granted_at) THEN
        RAISE EXCEPTION 'COMPANY_GRANT_IMMUTABLE: only the revocation columns of a company-access grant change';
    END IF;
    RETURN NEW;
END
$fn$;
CREATE TRIGGER employee_company_authority_grants_governed
    BEFORE INSERT OR UPDATE OR DELETE ON employee_company_authority_grants
    FOR EACH ROW EXECUTE FUNCTION employee_company_authority_grants_governed();

-- Row triggers do not fire on TRUNCATE; a statement trigger does (the existing governed-history function).
CREATE TRIGGER employee_company_authority_grants_no_truncate BEFORE TRUNCATE ON employee_company_authority_grants
    FOR EACH STATEMENT EXECUTE FUNCTION governed_history_no_truncate();

-- The never-commit fence of the Administration preview (1764540000000): a grant written by a preview transaction can never
-- reach a real COMMIT. Same function, same shape as the seven existing fenced tables.
CREATE CONSTRAINT TRIGGER preview_never_commits AFTER INSERT OR UPDATE OR DELETE ON employee_company_authority_grants
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    WHEN (coalesce(current_setting('eos_policy.preview', true), '') = 'on')
    EXECUTE FUNCTION authority_preview_never_commits();

-- Down Migration
SET search_path = eos_policy, public;

-- GUARDED. An ACTIVE grant is recorded policy that confers reach; dropping the table would silently remove it (and its
-- history), so a rollback refuses while any ACTIVE grant exists. Revoke them first (the audit events keep before/after).
DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_policy.employee_company_authority_grants WHERE status = 'active';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'EMPLOYEE_COMPANY_AUTHORITY_GRANTS: refuses to reverse -- % ACTIVE company-access grant(s) exist; revoke them first', v_n;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS preview_never_commits ON employee_company_authority_grants;
DROP TRIGGER IF EXISTS employee_company_authority_grants_no_truncate ON employee_company_authority_grants;
DROP TRIGGER IF EXISTS employee_company_authority_grants_governed ON employee_company_authority_grants;
DROP FUNCTION IF EXISTS employee_company_authority_grants_governed();
DROP INDEX IF EXISTS ecag_by_employee;
DROP INDEX IF EXISTS ecag_one_active;
DROP TABLE IF EXISTS employee_company_authority_grants;
