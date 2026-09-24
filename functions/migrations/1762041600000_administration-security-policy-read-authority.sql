-- Up Migration
-- THE ADMINISTRATION READ AUTHORITY -- one Object-specific READ, and deliberately not a blanket one.
--
-- ════════════════════ THE MEASURED DEFECT ════════════════════
--
-- Administration > Objects, Roles & Permissions, Workflows, Permission Preview and Overview had NO
-- registered READ capability between them. `eos_policy.capabilities` declared exactly two rows on
-- the `rolesPermissions` Object -- `admin.roleAssignment.write` (assignRole, ADMIN_ACTION) and
-- `admin.accessRequest.decide` (decideAccessRequest, ADMIN_ACTION) -- and NOTHING meaning "may read
-- the policy model". A navigation cutover therefore had one of two moves available, and both are
-- wrong:
--
--     gate the read surface with admin.roleAssignment.write  -> a READER becomes indistinguishable
--                                                               from a WRITER, and the person who
--                                                               may only LOOK at the matrix is
--                                                               handed the authority to CHANGE it
--     mint administration.read                               -> a blanket admin super-capability
--                                                               naming no Object, which is exactly
--                                                               what the Object-governed model
--                                                               exists to prevent
--
-- Owner ruling: BUILD EXPLICIT READ AUTHORITY, governed by the Objects the surfaces expose. This
-- migration registers ONE capability and grants it to TWO Roles. That is the whole change.
--
-- ════════════════════ WHY ONE KEY AND NOT FIVE ════════════════════
--
-- Checked against the catalog before inventing anything, which is where four of the six surfaces
-- turned out to be already governed and to need no key at all:
--
--     Users / Principal effective access   principal.read           admin.principalAccess.read   EXISTS
--     Workflow Definition read             workflowDefinition.read  workflowDefinition.read      EXISTS
--     Permission Preview (future source)   principal.read           admin.principalAccess.read   EXISTS
--     Audit Logs                           auditLog.read            audit.event.read             EXISTS
--     Objects / security matrix       --+
--     Security Roles / permissions    --+- rolesPermissions.read    NOTHING                      NEW
--     Administration Overview              (reads nothing governed)                              NONE
--
-- THE TWO SURFACES SHARE ONE KEY BECAUSE THEY SHARE ONE OBJECT. Administration > Objects and
-- Administration > Roles & Permissions are two projections of ONE stored authority -- Object ->
-- action -> grantee, and Role -> object -> action -- over the same `role_capabilities`,
-- `principal_capabilities`, `objects` and `object_fields` rows. objectSecurityAuthority.ts says so
-- in its own header ("THE ONE SECURITY AUTHORITY, projected three ways"), and the Administration
-- catalog projects exactly one Object for it: `rolesPermissions`, "Roles / Permissions", domain
-- Administration. Minting a second key for the second projection would be two names for one
-- authority, which is the drift this subsystem was built to end. A capability names ONE Object; this
-- one names `rolesPermissions` and governs nothing else.
--
-- THE OVERVIEW GETS NO KEY, and that is the ruling applied rather than a gap.
-- AdministrationOverview.jsx reads no governed data at all -- it renders four static links and the
-- deployment manifest. Minting `administration.read` so a link hub resolves would be the blanket
-- capability the ruling forbids, created for a surface with nothing to protect. The Overview is
-- answered by DISJUNCTION over the surface reads above: a principal who may read at least one
-- Administration surface may see the page that lists them. That decision is code
-- (adminPolicy/administrationSurfaceAuthority.ts), not a row, because it is derived from the grants
-- and must never become grantable on its own.
--
-- ════════════════════ READ IS NOT WRITE ════════════════════
--
-- action_kind is READ. It confers no grant, no revoke, no assign, no edit, no publish, no bind and
-- no write, and it is never satisfied by holding one: the UNIQUE index on (object_key, action_key)
-- keeps `rolesPermissions/read` a different row from `rolesPermissions/assignRole` and
-- `rolesPermissions/decideAccessRequest` by construction, and `capabilitiesForRoleKeys` returns a
-- flat set of keys with no implication between them. Proven, not asserted, by
-- functions/test/administrationReadAuthority.test.mjs against the real repository.
--
-- ════════════════════ THE GRANT POPULATION, AND THE ONE DELIBERATE NARROWING ════════════════════
--
-- admin and owner. Read from the evidence, not chosen to make a count come out:
--
--   * EVERY capability on the Administration authority Objects is already exactly {admin, owner}:
--     admin.roleAssignment.write, admin.accessRequest.decide, admin.principalAccess.read,
--     admin.userStatus.write, admin.credentialReset.initiate, admin.employeeProfile.write,
--     admin.employeeJobRole.write, admin.employeeWorkEligibility.write,
--     admin.employeeOperationalScope.write. Measured in nonprod, 2026-09-23.
--   * Owner ruling 2026-09-06 sec3, recorded verbatim in access/compatibilityRoles.ts against the
--     nearest analogue -- the trusted principal-access READ: "to ADMIN ONLY. Never to dispatcher --
--     the Users directory is visible to more people than another person's account status and Role
--     assignments should be." The Object/action/security matrix is strictly more than that.
--   * `audit.event.read` is the ONE Administration surface that already carried a governed read,
--     and its twelve holders do NOT include dispatcher -- although legacy navigation shows
--     dispatcher the Audit Logs tab. The translation of an Administration surface's legacy
--     admin/dispatcher nav default into governed grants has already been made once, and it did not
--     carry dispatcher across.
--
-- WHAT DISPATCHER HOLDS TODAY IS NOT A GRANT. Every Administration nav item in navConfig.js carries
-- no `legacyKey` and no `capabilityAccess`, so isNavItemVisible() falls to PLACEHOLDER_DEFAULT_ROLES
-- = ["admin", "dispatcher"] -- the conservative default for a NET-NEW PLACEHOLDER SCREEN. Dispatcher
-- reaches the security matrix because a route exists, which is precisely what the ruling says not to
-- widen for. Stated as a diff rather than applied silently, and NOTHING CHANGES TODAY: this
-- migration alters no route, no nav item and no dispatcher session. It registers the vocabulary the
-- cutover will need.
--
-- generalManager is NOT granted. It holds assignRole authority through the ENGINE INVARIANT
-- (administrationAuthority.ts ROLE_ASSIGNMENT_ROLE_KEYS) and holds NO `admin.*` row in
-- role_capabilities at all. That divergence is older than this migration and is reported, not
-- closed here: widening a read to match an invariant would be inventing a grant decision.
--
-- ════════════════════ WHAT THIS DELIBERATELY DOES NOT DO ════════════════════
--
-- It does NOT grant workflowDefinition.read. The key exists and is held at ZERO. Migration
-- 1761609600000 recorded that "every workflowDefinition.* stay at ZERO", and
-- test/migrationChainSafety.test.mjs asserts that no migration in the chain grants a
-- `workflowDefinition.` capability because "the Work Order lifecycle and Workflow Definition
-- decisions are the Owner's, not a migration's". So Administration > Workflows HAS a registered READ
-- capability and NO holder, and its population is an open Owner decision reported as
-- WORKFLOW_DEFINITION_READ_GRANT_IS_OWNER_HELD. Granting it here would have required weakening that
-- guard, which is never the move.
--
-- It writes NO direct Principal grant. It creates no Object, retires none, and touches no existing
-- capability row. There is no "DELETE ... WHERE key NOT IN (...)" anywhere here: a rule like that
-- deletes real configuration the moment a snapshot lags behind a database.
--
-- Counts move 75 -> 76 capabilities and +2 role_capabilities per tenant that defines admin and owner.
-- Nonprod before: capabilities 75, objects 39, role_capabilities 383, principal_capabilities 0.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_seeded      INT;
    v_object      INT;
    v_existing    INT;
    v_conflict    TEXT;
    v_writes      INT;
BEGIN
    -- THE CENSUS REFUSES RATHER THAN GUESSES. Each fact below was reviewed against nonprod before
    -- this file was written; a database that disagrees stops the migration instead of writing a row
    -- on top of a shape nobody checked.

    -- 1. The Object this capability names must be one the Administration catalog projects. Without
    --    it the capability would be STRANDED: invisible in the Object view and NOT_FOUND from
    --    getObjectSecurityMatrix, with any grant on it unadministrable. That is the exact defect
    --    test/capabilityObjectAuthorityGuard.test.mjs exists to catch, and it is cheaper here.
    --
    --    ASKED ONLY OF A SEEDED DATABASE, and the distinction is the whole reason that guard exists:
    --    `objects` rows are TENANT-SCOPED and written by the SEED, while `capabilities` rows are
    --    GLOBAL and written by MIGRATIONS. A freshly migrated database has no tenant and therefore no
    --    Objects at all, and refusing there would make every clean migrate fail. So: if this database
    --    has been seeded, `rolesPermissions` must be among what it seeded; if it has not, there is
    --    nothing yet to contradict and the vocabulary row is registered exactly as every other
    --    capability migration registers one.
    SELECT count(*) INTO v_seeded FROM objects;
    IF v_seeded > 0 THEN
        SELECT count(*) INTO v_object FROM objects WHERE key = 'rolesPermissions';
        IF v_object = 0 THEN
            RAISE EXCEPTION
              'ADMINISTRATION_READ_AUTHORITY: this database has been seeded with % Object(s) and '
              '"rolesPermissions" is not among them -- registering a capability against an Object '
              'Administration cannot project would strand the grant', v_seeded;
        END IF;
    END IF;

    -- 2. The (object_key, action_key) cell must be genuinely empty. A UNIQUE index already makes a
    --    duplicate impossible; this turns the constraint violation into a sentence.
    SELECT count(*) INTO v_existing FROM capabilities
      WHERE object_key = 'rolesPermissions' AND action_key = 'read';
    IF v_existing > 0 THEN
        SELECT key INTO v_conflict FROM capabilities
          WHERE object_key = 'rolesPermissions' AND action_key = 'read';
        RAISE EXCEPTION
          'ADMINISTRATION_READ_AUTHORITY: rolesPermissions/read is already governed by "%" -- the '
          'measured premise of this migration (no read authority over the policy model) does not '
          'hold in this database', v_conflict;
    END IF;

    -- 3. The key itself must be unused. `admin.securityPolicy.read` naming some OTHER Object would
    --    mean two authorities under one name, which is worse than either alone.
    SELECT count(*) INTO v_existing FROM capabilities WHERE key = 'admin.securityPolicy.read';
    IF v_existing > 0 THEN
        RAISE EXCEPTION
          'ADMINISTRATION_READ_AUTHORITY: capability key "admin.securityPolicy.read" already exists '
          'and names a different cell -- refusing to create a second meaning for one name';
    END IF;

    -- 4. The two ADMIN_ACTION writes this read must NOT be confused with are expected to be present.
    --    Their absence would mean the Administration vocabulary in this database is not the one the
    --    ruling was written against, and the read/write distinction being drawn here has no subject.
    SELECT count(*) INTO v_writes FROM capabilities
      WHERE object_key = 'rolesPermissions'
        AND action_key IN ('assignRole', 'decideAccessRequest')
        AND action_kind = 'ADMIN_ACTION';
    IF v_writes <> 2 THEN
        RAISE EXCEPTION
          'ADMINISTRATION_READ_AUTHORITY: expected the 2 reviewed rolesPermissions ADMIN_ACTION '
          'writes (assignRole, decideAccessRequest) and found % -- this database carries a different '
          'Administration vocabulary than the one reviewed', v_writes;
    END IF;
END
$$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_admin_securityPolicy_read', 'admin.securityPolicy.read',
     'Read the tenant security policy model: the Object and Field catalogue, the Security Roles, and the Object -> action -> grantee matrix including direct Principal grants. Confers no change of any kind -- not a grant, not a revoke, not an assignment, not a definition edit.',
     'rolesPermissions', 'read', 'READ', 'View Security Policy')
ON CONFLICT (key) DO NOTHING;

-- ════════════════════ THE GOVERNED ROLE GRANTS ════════════════════
--
-- Joined by Role KEY so the statement is correct in every tenant, and ON CONFLICT DO NOTHING so
-- re-running changes nothing. A Role this tenant does not define simply matches no row. The id shape
-- is the one migration 1761609600000 established.
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_x_' || substr(md5(r.tenant_id || r.id || c.id), 1, 26),
       r.tenant_id, r.id, c.id,
       'migration:1762041600000', now(), 'migration:1762041600000', now(), 'migration:1762041600000', now()
  FROM (VALUES
        ('admin', 'admin.securityPolicy.read'),
        ('owner', 'admin.securityPolicy.read')
      ) AS g(role_key, capability_key)
  JOIN roles        r ON r.key = g.role_key
  JOIN capabilities c ON c.key = g.capability_key
 ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
SET search_path = eos_policy, public;

-- GUARDED. The grants this migration wrote are removed by their own provenance stamp, so a grant an
-- administrator made later through the governed command -- which carries a different granted_by --
-- survives a down. The capability row is then removed only if nothing still holds it: a row that
-- acquired a holder this migration did not write is recorded authority, and a down migration does
-- not get to destroy it. It refuses to reverse instead.
DO $$
DECLARE
    v_held INT;
BEGIN
    DELETE FROM role_capabilities
     WHERE granted_by = 'migration:1762041600000'
       AND capability_id = 'cap_admin_securityPolicy_read';

    SELECT count(*) INTO v_held FROM role_capabilities WHERE capability_id = 'cap_admin_securityPolicy_read';
    IF v_held > 0 THEN
        RAISE EXCEPTION
          'ADMINISTRATION_READ_AUTHORITY: refuses to reverse -- admin.securityPolicy.read is still '
          'held by % Role grant(s) this migration did not write', v_held;
    END IF;

    SELECT count(*) INTO v_held FROM principal_capabilities WHERE capability_id = 'cap_admin_securityPolicy_read';
    IF v_held > 0 THEN
        RAISE EXCEPTION
          'ADMINISTRATION_READ_AUTHORITY: refuses to reverse -- admin.securityPolicy.read is still '
          'held by % direct Principal grant(s)', v_held;
    END IF;

    DELETE FROM capabilities WHERE id = 'cap_admin_securityPolicy_read';
END
$$;
