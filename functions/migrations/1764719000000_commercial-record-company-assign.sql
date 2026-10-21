-- Up Migration
-- CLC: THE GOVERNED, AUDITED, SET-ONCE CORRECTION OF A COMPANY-LESS COMMERCIAL RECORD (DECISIONS #CLC; Owner review 2026-10-20, direction 2026-10-21; closes the Q-1a design gap
-- "nothing in the application can set a company on a company-less Opportunity or Agreement"). SLOT 1764719000000 IS PROVISIONAL: the controller assigns the final one.
--
-- ============================================================================
-- WHAT THIS DOES (and nothing else)
--   REGISTERS ONE capability, `commercial.recordCompany.assign` (BUSINESS_ACTION), on the existing `opportunity` Object, and GRANTS IT TO NOBODY.
--   No table, no column, no trigger, no function, no Role, no grant. The command it authorizes is `assignRecordOperatingCompany` on the Commercial transport
--   (functions/src/eosCommercial/commands/commercialRecordCompanyService.ts).
--
-- WHY A BUSINESS_ACTION, AND WHY NO GRANT
--   The protected Administrator's standing implies only ADMIN_ACTION and READ keys plus nine named management actions (protectedAdministrator.ts); a BUSINESS_ACTION is
--   not implied, so NOBODY -- the protected Administrator and the protected Owner included -- holds this key until the Owner decides who may. Grants go through the
--   EXISTING Administration paths (grantObjectActionToRole / grantObjectActionToPrincipal, previewed and committed like any authority change); this migration writes none.
--
-- WHAT HOLDING THE KEY DOES NOT DO
--   It does not widen what the holder can SEE or REACH. The command still requires the record to be visible under the null-company rule (owner / creator, the protected
--   Administrator, the protected Owner) and the TARGET company to be one the holder reaches (Q-1a), and it only ever sets a NULL company, once. Held globally only: the key is
--   not scope-evaluable, so a sales-channel-scoped assignment cannot carry it.
--
-- OBJECT-WIDE GRANTS: the key hangs on the `opportunity` Object, so an Administration object-wide GRANT of `opportunity` (applyObjectWideRoleAuthority, with no action-kind
-- filter) would include it. Grant it by action, or by the BUSINESS_ACTION kind with the Owner's decision in view.
--
-- Pre-write checks the controller runs (nonprod, read-only): the key is absent from eos_policy.capabilities; the cell (opportunity, assignOperatingCompany) is unused
-- (UNIQUE (object_key, action_key)); no grant or Administration decision names the key.
-- Drafted by the CLC lane; reviewed and written into the repository by the controller (agents cannot write migrations directly).
-- ============================================================================

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_commercial_recordCompany_assign', 'commercial.recordCompany.assign',
     'Set the operating company of an Opportunity or Sales Agreement that has none, ONCE, with a stated reason (never a change, never a clear). The caller still needs the record to be visible to them and the target company to be one they reach; an Agreement takes its Opportunity''s company, a conflict is refused and named, and no related record is ever rewritten. Held by nobody until the Owner grants it.',
     'opportunity', 'assignOperatingCompany', 'BUSINESS_ACTION', 'Set Operating Company')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
-- Refuses once anything names the key: a Role grant, a direct grant, an Administration decision, or an APPLIED command (its audit row is evidence that the authority
-- existed). A down migration never silently discards a decision or leaves audit evidence with no authority that created it.
DO $$
DECLARE v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = 'commercial.recordCompany.assign';
    IF v_n > 0 THEN RAISE EXCEPTION 'CLC_RECORD_COMPANY: refuses to reverse -- % Role grant(s) hold commercial.recordCompany.assign', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = 'commercial.recordCompany.assign';
    IF v_n > 0 THEN RAISE EXCEPTION 'CLC_RECORD_COMPANY: refuses to reverse -- % direct grant(s) hold commercial.recordCompany.assign', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key = 'commercial.recordCompany.assign';
    IF v_n > 0 THEN RAISE EXCEPTION 'CLC_RECORD_COMPANY: refuses to reverse -- % Administration decision(s) name commercial.recordCompany.assign', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.audit_events WHERE action = 'recordCompany.assign';
    IF v_n > 0 THEN RAISE EXCEPTION 'CLC_RECORD_COMPANY: refuses to reverse -- % applied command(s) are recorded in the audit trail', v_n; END IF;
END
$$;

SET search_path = eos_policy, public;
DELETE FROM capabilities WHERE key = 'commercial.recordCompany.assign';
