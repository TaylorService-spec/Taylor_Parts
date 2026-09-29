-- Up Migration
-- MOBILE LOCATION SCOPE BINDING AUTHORITY -- the dedicated ADMINISTRATIVE CONFIGURATION capability that governs the
-- truck-location -> warehouse scope bindings of eos_ops.mobile_location_scope_bindings (Controller ruling DQ-029,
-- 2026-09-28; the binding itself is DQ-024, migration 1764115200000). Lane L3. REGISTERS ONE CAPABILITY AND GRANTS IT
-- TO NOBODY.
--
-- ============================================================================
-- WHAT IT GOVERNS. Reading, creating, changing and removing the binding that says which warehouse's OPERATIONAL_SCOPE
-- governs acts at a truck inventory location, through the Administration configuration operations on /admin/policy
-- (adminPolicy/configurationOperations.ts). Nothing else.
--
-- WHAT IT IS NOT. It is not implied by any inventory transaction, transfer or cycle-count capability, by technician
-- assignment, by the Parts / Warehouse / Dispatcher Roles, or by owning or driving a vehicle; the gate asks for THIS
-- key and nothing stands in for it. There is no Administrator check anywhere in the path.
--
-- OBJECT. `mobileLocation`: the binding is configuration OF a truck inventory location. Kind ADMIN_ACTION, as every
-- other administrative configuration authority in this catalog (admin.employeeFunctionalRole.write).
--
-- POSTGRESQL-NATIVE. Deliberately ABSENT from the in-repo PERMISSION_CATALOG (as ownership.handoff.correct is): the
-- in-repo admin Role composes the whole catalog, so a catalog entry would grant it through the policy seed and the
-- Sample Company reconcile -- a grant by default, which DQ-029 forbids.
--
-- NO GRANT. No Role or Principal receives it here. Who configures truck scope is an Administration decision
-- (grantObjectActionToRole), recorded as one, never a migration default. Until it is granted, every configuration
-- operation refuses for everyone, and every truck act fails closed on MOBILE_SCOPE_BINDING_MISSING.
-- ============================================================================

SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key = 'inventory.location.scopeBinding.manage' OR (object_key = 'mobileLocation' AND action_key = 'manageScopeBinding');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'MOBILE_LOCATION_SCOPE_BINDING_AUTHORITY: inventory.location.scopeBinding.manage / mobileLocation.manageScopeBinding is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_location_scopeBinding_manage', 'inventory.location.scopeBinding.manage',
     'ADMINISTRATIVE CONFIGURATION: read, create, change and remove the binding that names which warehouse''s operational scope governs a truck inventory location (DQ-024 / DQ-029). Every change is audited with its reason and affects future operations only. Not implied by any inventory, transfer or cycle-count capability, by technician assignment, by any operational Role, or by owning a vehicle; confers no inventory authority of its own.',
     'mobileLocation', 'manageScopeBinding', 'ADMIN_ACTION', 'Manage Truck Location Warehouse Scope')
ON CONFLICT (key) DO NOTHING;

-- Down Migration
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capabilities WHERE capability_id = 'cap_inventory_location_scopeBinding_manage';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'MOBILE_LOCATION_SCOPE_BINDING_AUTHORITY: refuses to reverse -- inventory.location.scopeBinding.manage is held by % Role grant(s)', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities WHERE capability_id = 'cap_inventory_location_scopeBinding_manage';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'MOBILE_LOCATION_SCOPE_BINDING_AUTHORITY: refuses to reverse -- inventory.location.scopeBinding.manage is held by % direct grant(s)', v_n;
    END IF;
    IF to_regclass('eos_policy.role_capability_decisions') IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM role_capability_decisions WHERE capability_key = 'inventory.location.scopeBinding.manage';
        IF v_n > 0 THEN
            RAISE EXCEPTION 'MOBILE_LOCATION_SCOPE_BINDING_AUTHORITY: refuses to reverse -- % Administration decision(s) name inventory.location.scopeBinding.manage', v_n;
        END IF;
    END IF;
    DELETE FROM capabilities WHERE id = 'cap_inventory_location_scopeBinding_manage';
END
$$;
