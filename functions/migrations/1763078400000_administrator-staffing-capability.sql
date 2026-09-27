-- Up Migration
-- ADMINISTRATOR STAFFING (Owner ruling R1, 2026-09-26). Local test databases only until the Owner promotes it.
--
-- AUTHORITY: Owner ruling R1 (docs/DECISIONS.md #180) -- "Owner may staff/recover the DESIGNATED Administrator
-- Security Role for ANOTHER principal through ONE narrowly bounded governed capability." Pass 8 D5(b) requires a
-- holder of admin.securityPolicy.write to assign a Role that carries it; Owner holds admin.roleAssignment.write
-- only, so since Pass 8 Owner could neither appoint nor recover an Administrator. This migration is the
-- ruling's vocabulary row and its ONE ruled grant, nothing else:
--
--     admin.administratorRole.assign   rolesPermissions / assignAdministratorRole   ADMIN_ACTION   NEW  -> owner
--
-- WHAT IT AUTHORIZES (enforced in policyCommands.authorizeSecurityPolicyStaffing, under the governance lock):
-- assignRole / revokeRole of the DESIGNATED Administrator Security Role (the protected Role keyed `admin`) --
-- GLOBAL only, for a Principal OTHER than the actor. It confers NOTHING else: not admin.securityPolicy.write,
-- not any other Role carrying it, not a direct grant, not a Role definition edit, not a scoped Administrator.
-- It is not a governing Administration capability (the anti-lockout guard never counts it) and, as an admin.*
-- key, it can be neither conditioned nor held at an assignment scope.
--
-- THE GRANT. owner -> admin.administratorRole.assign, for every tenant whose PROTECTED owner Role exists, the
-- same pair tenantBootstrap.ADMINISTRATION_BOOTSTRAP_GRANTS writes for a new tenant. Not an Owner ruling A key
-- (OWNER_EXCLUDED_ADMIN_ONLY_CAPABILITIES / OWNER_EXCLUDED_NOT_AN_AUTHORITY do not name it) and not a
-- workflowDefinition.* key (migrationChainSafety). Honours Administration decisions: a pair an administrator
-- has ADMIN_REVOKED is never re-inserted (the role_capabilities_honour_decisions trigger would refuse it too).
-- Owner ruling E: roleCapabilityAuthorityBaseline.json moves 414 -> 415 (MIGRATION_BACKED 356 -> 357) in the
-- SAME change.
--
-- Counts: capabilities +1; role_capabilities +1 per tenant with a protected owner Role.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_n INT;
BEGIN
    IF to_regclass('eos_policy.role_capability_decisions') IS NULL THEN
        RAISE EXCEPTION 'ADMINISTRATOR_STAFFING: role_capability_decisions (migration 1762646400000) is missing';
    END IF;
    SELECT count(*) INTO v_n FROM capabilities
     WHERE key = 'admin.administratorRole.assign' OR (object_key = 'rolesPermissions' AND action_key = 'assignAdministratorRole');
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ADMINISTRATOR_STAFFING: admin.administratorRole.assign / rolesPermissions.assignAdministratorRole is already registered';
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_admin_administratorRole_assign', 'admin.administratorRole.assign',
     'Staff the designated Administrator Security Role: assign it to, or remove it from, ANOTHER principal, globally, through Administration (Owner ruling R1). Confers no other Role, no admin.securityPolicy.write, no direct grant, no Role definition edit and no scoped Administrator assignment; the anti-lockout guard still refuses removing the last security administrator.',
     'rolesPermissions', 'assignAdministratorRole', 'ADMIN_ACTION', 'Staff Administrator Role')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_r1_' || substr(md5(r.tenant_id || r.id || c.id), 1, 26),
       r.tenant_id, r.id, c.id,
       'migration:1763078400000', now(), 'migration:1763078400000', now(), 'migration:1763078400000', now()
  FROM roles r
  JOIN capabilities c ON c.key = 'admin.administratorRole.assign'
 WHERE r.key = 'owner' AND r.protected = TRUE
   AND NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
SET search_path = eos_policy, public;

-- GUARDED. A grant this migration did not write, a direct grant, or an Administration decision about the key is
-- recorded policy; a rollback does not get to destroy it.
DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM role_capability_decisions WHERE capability_key = 'admin.administratorRole.assign';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ADMINISTRATOR_STAFFING: refuses to reverse -- % Administration decision(s) name admin.administratorRole.assign', v_n;
    END IF;

    DELETE FROM role_capabilities
     WHERE granted_by = 'migration:1763078400000'
       AND capability_id = 'cap_admin_administratorRole_assign';

    SELECT count(*) INTO v_n FROM role_capabilities WHERE capability_id = 'cap_admin_administratorRole_assign';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ADMINISTRATOR_STAFFING: refuses to reverse -- admin.administratorRole.assign is held by % grant(s) this migration did not write', v_n;
    END IF;
    SELECT count(*) INTO v_n FROM principal_capabilities WHERE capability_id = 'cap_admin_administratorRole_assign';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'ADMINISTRATOR_STAFFING: refuses to reverse -- admin.administratorRole.assign is held by % direct grant(s)', v_n;
    END IF;
    DELETE FROM capabilities WHERE id = 'cap_admin_administratorRole_assign';
END
$$;
