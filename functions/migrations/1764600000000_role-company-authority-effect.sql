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


-- WHAT SERIALISES, AND IN WHAT LOCK ORDER. An invalid FINANCE_ONLY Role / non-finance capability combination cannot commit,
-- whichever write arrives first. Three pairs of writers, each serialised by row locks (READ COMMITTED: the waiter re-reads
-- the committed row and re-decides):
--   1. capability entering a Role (INSERT / UPDATE OF role_id, capability_id on role_capabilities)  vs  reclassification
--      (UPDATE roles). Role row first. The guard locks the Role row FOR SHARE unconditionally (the effect is tested afterwards,
--      not in the lock query's filter); the reclassification's UPDATE holds the Role row's exclusive tuple lock while its
--      trigger reads role_capabilities and capabilities.key. Whichever is second waits, then refuses.
--   2. capability key rename (UPDATE OF key on capabilities)  vs  reclassification. Role row first: the rename locks every
--      holder Role FOR SHARE in id order, then tests each; the reclassification as in 1.
--   3. capability entering a Role  vs  rename of that capability's key. Capability row: when the Role is FINANCE_ONLY the
--      guard reads the capability FOR KEY SHARE and tests the key it then sees; a rename of a unique key holds the row
--      exclusively. Rename first: the insert waits, re-reads the new key and refuses. Insert first: the rename waits, and its
--      holder scan then sees the committed row and refuses.
-- ISOLATION: these serialisation proofs hold at READ COMMITTED (the waiter re-reads committed state). The three functions
-- therefore RAISE FINANCE_ONLY_GUARD_REQUIRES_READ_COMMITTED (the precedent is CONDITION_CHECK_REQUIRES_READ_COMMITTED in
-- role_capabilities_honour_decisions) at any stricter level, and only where the decision matters: a classification change; a
-- write into a FINANCE_ONLY Role; a rename to a non-finance key. Ordinary grants are unaffected at any level. BOUNDARY: a
-- superuser or table owner can DISABLE these triggers (ALTER TABLE ... DISABLE TRIGGER), and nothing in the database can stop
-- that; the guard defends against application and operator writes, not against a role that may rewrite the schema.
-- Proved with real connections in every order: functions/test/financeOnlyCompanyAccessPostgres.test.mjs 9a, 9b, 9c, 9d, 9e.

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
    -- The serialisation proofs hold at READ COMMITTED only (a waiter re-reads the committed row and re-decides). At a
    -- stricter level the capabilities read below could come from an older snapshot, so the change is refused, not guessed.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'FINANCE_ONLY_GUARD_REQUIRES_READ_COMMITTED: the classification of role % cannot be changed at isolation level % -- retry at READ COMMITTED', NEW.key, current_setting('transaction_isolation');
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
    v_role   TEXT;
    v_effect TEXT;
    v_cap    TEXT;
BEGIN
    -- The Role row is locked FOR SHARE UNCONDITIONALLY (the effect is tested afterwards, in PL/pgSQL, not in the WHERE
    -- clause): a filter on FINANCE_ONLY would take no lock on a Role that is still OPERATIONAL in this statement's snapshot,
    -- and a concurrent reclassification could then commit alongside this write. A reclassification (UPDATE of roles) holds
    -- the row's exclusive tuple lock while its own trigger reads role_capabilities, so the two serialise in both orders:
    --   this write first   -> the reclassification waits for it and then sees (and refuses on) the new capability row;
    --   reclassification first -> this write waits, then (READ COMMITTED) re-reads the committed Role and refuses.
    -- That is all it serialises: a capability entering a Role versus that Role's classification. A write that already goes
    -- through the Administration command is also serialised by the tenant governance lock.
    SELECT r.key, r.company_authority_effect INTO v_role, v_effect FROM eos_policy.roles r
     WHERE r.id = NEW.role_id AND r.tenant_id = NEW.tenant_id
       FOR SHARE OF r;
    IF v_effect IS DISTINCT FROM 'FINANCE_ONLY' THEN RETURN NEW; END IF;
    -- Only now does the decision matter: it relies on re-reading committed state after a lock wait (READ COMMITTED).
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'FINANCE_ONLY_GUARD_REQUIRES_READ_COMMITTED: a capability cannot be written into FINANCE_ONLY role % at isolation level % -- retry at READ COMMITTED', v_role, current_setting('transaction_isolation');
    END IF;
    -- FOR KEY SHARE conflicts with the exclusive tuple lock of a concurrent rename of this capability's (unique) key, so the
    -- key tested below is the committed one (see pair 3 in the header).
    SELECT c.key INTO v_cap FROM eos_policy.capabilities c WHERE c.id = NEW.capability_id FOR KEY SHARE;
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
    v_role   TEXT;
    v_effect TEXT;
BEGIN
    IF NEW.key = OLD.key OR NEW.key LIKE 'finance.%' THEN RETURN NEW; END IF;
    -- A rename to a non-finance key: the holder scan below must see EVERY committed holder, which only READ COMMITTED
    -- guarantees (an older snapshot cannot see a holder committed since). Refused at a stricter level whether or not the
    -- scan finds a FINANCE_ONLY holder, because an older snapshot cannot know there is none.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'FINANCE_ONLY_GUARD_REQUIRES_READ_COMMITTED: capability % cannot be renamed to a non-finance key at isolation level % -- retry at READ COMMITTED', OLD.key, current_setting('transaction_isolation');
    END IF;
    -- Every Role holding this capability is locked FOR SHARE unconditionally (ordered, so two renames cannot deadlock),
    -- THEN each is tested, for the same reason as above: a concurrent reclassification of any holder serialises with the rename.
    FOR v_role, v_effect IN
        SELECT r.key, r.company_authority_effect
          FROM eos_policy.role_capabilities rc
          JOIN eos_policy.roles r ON r.id = rc.role_id AND r.tenant_id = rc.tenant_id
         WHERE rc.capability_id = NEW.id
         ORDER BY r.id
           FOR SHARE OF r
    LOOP
        IF v_effect = 'FINANCE_ONLY' THEN
            RAISE EXCEPTION 'FINANCE_ONLY_ROLE_NON_FINANCE_CAPABILITY: capability % is held by FINANCE_ONLY role %; renaming it to % would give that Role a non-finance capability', OLD.key, v_role, NEW.key;
        END IF;
    END LOOP;
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
