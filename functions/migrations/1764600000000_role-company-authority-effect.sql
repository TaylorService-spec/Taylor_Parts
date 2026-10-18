-- Up Migration
-- FINANCE-ONLY COMPANY ASSIGNMENTS GRANT FINANCE REACH ONLY (Owner ruling "FINANCE COMPANY ACCESS AND ATTRIBUTION", item 1,
-- 2026-10-17; DECISIONS #248).
--
-- EOS Core company authority (functions/src/eosOps/companyAuthority.ts, #235 rule 3) adds EVERY company named by ANY active
-- operatingCompany-scoped assignment to a Principal's general operational company authority. A Financials company assignment
-- (financeCompanyAccess@ventana) therefore also opened Ventana for return intake, scheduling and every other company-scoped
-- operation. This migration adds the governed per-Role classification that lets such a Role say what its company assignment
-- contributes:
--
--   OPERATIONAL   (default; every existing Role) the assignment names the company in general company authority, as today.
--   FINANCE_ONLY  the assignment supplies Finance reach only (decided from the Role's capabilities in
--                 eosFinance/financeCompanyAccess.ts, unchanged) and contributes nothing to general company authority.
--
-- ADDITIVE and behaviour-preserving: the column defaults to OPERATIONAL, so no existing assignment changes meaning here. No
-- capability, no grant, no row is written; the classification of the existing custom Finance Roles is a governed
-- Administration action (updateRole) run after this migration, never inferred from a Role name.
--
-- GOVERNED AT THE STORE, as role_capabilities already is (1762646400000): the classification changes only inside an
-- Administration command (eos_policy.administration_command = 'on'), a Role is FINANCE_ONLY only while it holds at least one
-- capability and every capability it holds is a finance.* key, and a non-finance capability cannot be inserted into a
-- FINANCE_ONLY Role. A direct write is refused with a named error.

SET search_path = eos_policy, public;

ALTER TABLE roles
    ADD COLUMN company_authority_effect TEXT NOT NULL DEFAULT 'OPERATIONAL'
        CONSTRAINT roles_company_authority_effect_check CHECK (company_authority_effect IN ('OPERATIONAL', 'FINANCE_ONLY'));

COMMENT ON COLUMN roles.company_authority_effect IS
    'What an operatingCompany-scoped assignment of this Role contributes to general company authority (DECISIONS #248). OPERATIONAL: names the company. FINANCE_ONLY: Finance reach only. Changed only through the Administration command updateRole.';

CREATE FUNCTION roles_company_authority_effect_governed() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.company_authority_effect = 'OPERATIONAL' THEN RETURN NEW; END IF;
    ELSIF NEW.company_authority_effect = OLD.company_authority_effect THEN
        RETURN NEW;
    END IF;
    IF coalesce(current_setting('eos_policy.administration_command', true), '') <> 'on' THEN
        RAISE EXCEPTION 'COMPANY_AUTHORITY_EFFECT_UNGOVERNED: the company-authority classification of role % changes only through the Administration command updateRole', NEW.key;
    END IF;
    IF NEW.company_authority_effect = 'FINANCE_ONLY' THEN
        IF NEW.protected THEN
            RAISE EXCEPTION 'FINANCE_ONLY_CLASSIFICATION_REFUSED: role % is protected', NEW.key;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM eos_policy.role_capabilities rc WHERE rc.tenant_id = NEW.tenant_id AND rc.role_id = NEW.id)
           OR EXISTS (SELECT 1 FROM eos_policy.role_capabilities rc
                        JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                       WHERE rc.tenant_id = NEW.tenant_id AND rc.role_id = NEW.id AND c.key NOT LIKE 'finance.%') THEN
            RAISE EXCEPTION 'FINANCE_ONLY_CLASSIFICATION_REFUSED: role % must hold at least one capability and only finance.* capabilities', NEW.key;
        END IF;
    END IF;
    RETURN NEW;
END
$fn$;
CREATE TRIGGER roles_company_authority_effect_governed
    BEFORE INSERT OR UPDATE OF company_authority_effect ON roles
    FOR EACH ROW EXECUTE FUNCTION roles_company_authority_effect_governed();

CREATE FUNCTION role_capabilities_finance_only_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
DECLARE
    v_role TEXT;
    v_cap  TEXT;
BEGIN
    -- FOR SHARE on the Role row: a concurrent reclassification (the UPDATE of roles locks the same row before its own
    -- trigger reads role_capabilities) and a capability insert or move that did not go through the Administration command
    -- (which already holds the tenant governance lock) therefore serialise. Whichever commits second sees the other's
    -- result at READ COMMITTED, so a Role can never end up FINANCE_ONLY while holding a non-finance capability.
    SELECT r.key INTO v_role FROM eos_policy.roles r
     WHERE r.id = NEW.role_id AND r.tenant_id = NEW.tenant_id AND r.company_authority_effect = 'FINANCE_ONLY'
       FOR SHARE OF r;
    IF v_role IS NULL THEN RETURN NEW; END IF;
    SELECT c.key INTO v_cap FROM eos_policy.capabilities c WHERE c.id = NEW.capability_id;
    IF v_cap IS NOT NULL AND v_cap NOT LIKE 'finance.%' THEN
        RAISE EXCEPTION 'FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY: role % is FINANCE_ONLY and may not hold %; reclassify it through updateRole first', v_role, v_cap;
    END IF;
    RETURN NEW;
END
$fn$;
-- INSERT and a MOVE (UPDATE of role_id or capability_id) are the same act: a capability entering a Role.
CREATE TRIGGER role_capabilities_finance_only_guard
    BEFORE INSERT OR UPDATE OF role_id, capability_id ON role_capabilities
    FOR EACH ROW EXECUTE FUNCTION role_capabilities_finance_only_guard();

-- A capability KEY is not immutable in the schema (no trigger or constraint stops an UPDATE of capabilities.key), so a
-- key change that would turn a FINANCE_ONLY Role's finance.* key into a non-finance key is refused as well.
CREATE FUNCTION capabilities_finance_only_key_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = eos_policy, pg_catalog AS $fn$
DECLARE
    v_role TEXT;
BEGIN
    IF NEW.key = OLD.key OR NEW.key LIKE 'finance.%' THEN RETURN NEW; END IF;
    SELECT r.key INTO v_role
      FROM eos_policy.role_capabilities rc
      JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
     WHERE rc.capability_id = NEW.id AND r.company_authority_effect = 'FINANCE_ONLY'
     LIMIT 1
       FOR SHARE OF r;
    IF v_role IS NOT NULL THEN
        RAISE EXCEPTION 'FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY: capability % is held by FINANCE_ONLY role %; renaming it to % would give that Role a non-finance capability', OLD.key, v_role, NEW.key;
    END IF;
    RETURN NEW;
END
$fn$;
CREATE TRIGGER capabilities_finance_only_key_guard
    BEFORE UPDATE OF key ON capabilities
    FOR EACH ROW EXECUTE FUNCTION capabilities_finance_only_key_guard();

-- Down Migration
SET search_path = eos_policy, public;

-- GUARDED. A FINANCE_ONLY classification is recorded policy; dropping the column would silently widen those Roles to
-- OPERATIONAL (general company authority), so a rollback refuses while any exists.
DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM roles WHERE company_authority_effect = 'FINANCE_ONLY';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ROLE_COMPANY_AUTHORITY_EFFECT: refuses to reverse -- % FINANCE_ONLY Role(s) exist', v_n;
    END IF;
END
$$;

DROP TRIGGER IF EXISTS capabilities_finance_only_key_guard ON capabilities;
DROP FUNCTION IF EXISTS capabilities_finance_only_key_guard();
DROP TRIGGER IF EXISTS role_capabilities_finance_only_guard ON role_capabilities;
DROP FUNCTION IF EXISTS role_capabilities_finance_only_guard();
DROP TRIGGER IF EXISTS roles_company_authority_effect_governed ON roles;
DROP FUNCTION IF EXISTS roles_company_authority_effect_governed();
ALTER TABLE roles DROP COLUMN IF EXISTS company_authority_effect;
