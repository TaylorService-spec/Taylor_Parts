-- Up Migration
-- A13 / D5: THE GOVERNED "MAKE A PERSON LOGIN-READY" OPERATION (docs/architecture/eos-login-ready-person.md, DECISIONS #A13-LRP; Owner ruling D5 2026-11-13, decisions 2026-11-14).
-- SLOT 1764720000000 IS PROVISIONAL: the controller assigns the final one.
--
-- ============================================================================
-- WHAT THIS DOES (and nothing else)
--   REGISTERS ONE capability, `admin.loginReadyPerson.provision` (BUSINESS_ACTION), on the existing `rolesPermissions` Object, and GRANTS IT TO NOBODY.
--   No table, no column, no trigger, no function, no Role, no grant. The operation it authorizes is `makePersonLoginReady` on EosLoginService
--   (functions/src/eosAuth/eosLoginService.ts), served on /admin/policy.
--
-- WHY A BUSINESS_ACTION, AND WHY NO GRANT
--   The protected Administrator's standing implies ADMIN_ACTION and READ keys, nine named management actions, AND every action on a system-administration Object -- and
--   `rolesPermissions` is one -- so the key is ALSO listed in PROTECTED_ADMINISTRATOR_EXCLUSIONS (protectedAdministrator.ts, same change). With both, NOBODY -- the protected
--   Administrator and the protected Owner included -- holds this key until the Owner confirms who may (D5: "No grant is implied").
--   Grants go through the EXISTING Administration paths (previewed and committed like any authority change); this migration writes none. The call is double-gated: this
--   key AND admin.roleAssignment.write.
--
-- OBJECT-WIDE GRANTS: the key hangs on the `rolesPermissions` Object, so an Administration object-wide GRANT of `rolesPermissions` (with no action-kind filter) would include
-- it. Grant it by action, with the Owner's decision in view.
-- ============================================================================

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_admin_loginReadyPerson_provision', 'admin.loginReadyPerson.provision',
     'Make an existing Employee login-ready in one audited act: create their Principal, tenant membership and Employee link together with a pending sign-in and a one-time setup code. Assigns no Role, scope or capability. Also requires admin.roleAssignment.write. Held by nobody until granted by name through Administration.',
     'rolesPermissions', 'makePersonLoginReady', 'BUSINESS_ACTION', 'Make Person Login-Ready')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
-- Refuses once anything names the key: a Role grant, a direct grant, an Administration decision, or an APPLIED operation (its audit row is evidence that the authority existed).
DO $$
DECLARE v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_policy.role_capabilities rc JOIN eos_policy.capabilities c ON c.id = rc.capability_id WHERE c.key = 'admin.loginReadyPerson.provision';
    IF v_n > 0 THEN RAISE EXCEPTION 'A13_LOGIN_READY: refuses to reverse -- % Role grant(s) hold admin.loginReadyPerson.provision', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = 'admin.loginReadyPerson.provision';
    IF v_n > 0 THEN RAISE EXCEPTION 'A13_LOGIN_READY: refuses to reverse -- % direct grant(s) hold admin.loginReadyPerson.provision', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key = 'admin.loginReadyPerson.provision';
    IF v_n > 0 THEN RAISE EXCEPTION 'A13_LOGIN_READY: refuses to reverse -- % Administration decision(s) name admin.loginReadyPerson.provision', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.audit_events WHERE action = 'makePersonLoginReady';
    IF v_n > 0 THEN RAISE EXCEPTION 'A13_LOGIN_READY: refuses to reverse -- % applied operation(s) are recorded in the audit trail', v_n; END IF;
END
$$;

SET search_path = eos_policy, public;
DELETE FROM capabilities WHERE key = 'admin.loginReadyPerson.provision';
