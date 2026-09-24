-- Up Migration
-- THE WORKFLOW DEFINITION READ -- the hold is narrowed by exactly one key, and by nobody else.
--
-- ════════════════════ WHAT WAS HELD, AND WHAT THE OWNER MOVED ════════════════════
--
-- Migration 1761350400000 registered the SIX `workflowDefinition.*` capabilities -- create, read,
-- edit, version, publish, bindRole -- and granted none of them. Migration 1761523200000 recorded
-- that the six stay ungranted; 1761609600000 repeated it ("every workflowDefinition.* stay at
-- ZERO"); 1762041600000 declined to grant the read while closing the Administration read gap and
-- reported it as WORKFLOW_DEFINITION_READ_GRANT_IS_OWNER_HELD. test/migrationChainSafety.test.mjs
-- has asserted the whole time that no migration in the chain grants a `workflowDefinition.`
-- capability, because "the Work Order lifecycle and Workflow Definition decisions are the Owner's,
-- not a migration's".
--
-- The Owner has now made ONE of those decisions, and only one:
--
--     workflowDefinition.read   ->   admin, owner.   No other Role.
--
-- EVERYTHING ELSE STAYS AT ZERO. create, edit, version, publish and bindRole are untouched by this
-- file and remain the Owner's to decide. The hold was never a statement that the keys are dangerous
-- to name; it was a statement that a migration may not INVENT the grant population. This migration
-- does not invent one -- it applies a population the Owner stated -- and the guard it moves is
-- rewritten to express that exact ruling rather than to stop asking the question. A guard that is
-- switched off to let a change through protects nothing afterwards.
--
-- ════════════════════ WHY admin AND owner, AND WHY THAT IS THE WHOLE LIST ════════════════════
--
-- `workflowDefinition.read` is the registered authority behind Administration > Workflows. It is the
-- LAST of the six Administration surfaces to get a holder, and the five before it agree: every
-- capability on the Administration authority Objects is exactly {admin, owner} --
-- admin.roleAssignment.write, admin.accessRequest.decide, admin.principalAccess.read,
-- admin.userStatus.write, admin.credentialReset.initiate, admin.employeeProfile.write,
-- admin.employeeJobRole.write, admin.employeeWorkEligibility.write,
-- admin.employeeOperationalScope.write, and now admin.securityPolicy.read from 1762041600000.
-- Granting the Workflow read to a third Role would make Administration > Workflows the one
-- Administration screen with a wider audience than the security matrix beside it, which is not a
-- decision this file gets to make and is not the decision the Owner made.
--
-- READ IS NOT WRITE, and here the distinction is load-bearing rather than decorative: the same
-- Object carries publish (ADMIN_ACTION) and bindRole (ADMIN_ACTION), and a Role that may LOOK at a
-- workflow definition must not thereby be able to publish one. The UNIQUE index on (object_key,
-- action_key) keeps `workflowDefinition/read` a different row from `workflowDefinition/publish`, and
-- capabilitiesForRoleKeys returns a flat set of keys with no implication between them. So holding
-- the read confers the read and nothing else, by construction.
--
-- ════════════════════ WHAT THIS DELIBERATELY DOES NOT DO ════════════════════
--
-- It registers NO capability: `workflowDefinition.read` already exists (cap_workflowDefinition_read,
-- workflowDefinition / read / READ), registered by 1761350400000. Minting a second row would be two
-- names for one authority. The capability count does not move.
--
-- It writes NO direct Principal grant. It creates and retires no Object. It contains no
-- "DELETE ... WHERE key NOT IN (...)": a rule like that deletes real configuration the moment a
-- snapshot lags behind a database.
--
-- Counts move: capabilities 76 -> 76 (unchanged), role_capabilities +2 per tenant that defines admin
-- and owner. Nonprod before: capabilities 76, objects 39, role_capabilities 385,
-- principal_capabilities 0, and all six workflowDefinition.* at ZERO holders.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_seeded    INT;
    v_object    INT;
    v_read      INT;
    v_mutations INT;
    v_held      INT;
    v_stranger  TEXT;
BEGIN
    -- THE CENSUS REFUSES RATHER THAN GUESSES. Every fact below was measured against nonprod before
    -- this file was written; a database that disagrees stops the migration instead of writing a
    -- grant on top of a shape nobody checked.

    -- 1. The capability must ALREADY exist, under the Object it names, as a READ. This migration
    --    grants; it does not register. If the row is missing, the premise is wrong and creating it
    --    here would silently move the vocabulary decision into a grant migration.
    SELECT count(*) INTO v_read FROM capabilities
      WHERE key = 'workflowDefinition.read'
        AND id = 'cap_workflowDefinition_read'
        AND object_key = 'workflowDefinition'
        AND action_key = 'read'
        AND action_kind = 'READ';
    IF v_read <> 1 THEN
        RAISE EXCEPTION
          'WORKFLOW_DEFINITION_READ_AUTHORITY: expected exactly 1 registered workflowDefinition.read '
          '(cap_workflowDefinition_read, workflowDefinition/read/READ) and found % -- this database '
          'carries a different Workflow vocabulary than the one the ruling was written against', v_read;
    END IF;

    -- 2. The FIVE mutations must still be registered AND still be held by nobody. This is the hold
    --    itself, measured rather than assumed: if any of them had acquired a holder, the premise
    --    "only the read is being activated" would already be false and the correct move is to stop
    --    and let a human look, not to add a sixth grant beside it.
    SELECT count(*) INTO v_mutations FROM capabilities
      WHERE object_key = 'workflowDefinition'
        AND action_key IN ('create', 'edit', 'version', 'publish', 'bindRole');
    IF v_mutations <> 5 THEN
        RAISE EXCEPTION
          'WORKFLOW_DEFINITION_READ_AUTHORITY: expected the 5 reviewed workflowDefinition mutation '
          'capabilities (create, edit, version, publish, bindRole) and found % -- refusing to narrow '
          'a hold whose subject is not the one that was reviewed', v_mutations;
    END IF;

    SELECT count(*) INTO v_held
      FROM role_capabilities rc
      JOIN capabilities c ON c.id = rc.capability_id
     WHERE c.object_key = 'workflowDefinition'
       AND c.action_key IN ('create', 'edit', 'version', 'publish', 'bindRole');
    IF v_held > 0 THEN
        RAISE EXCEPTION
          'WORKFLOW_DEFINITION_READ_AUTHORITY: % Role grant(s) already exist on a workflowDefinition '
          'MUTATION -- the Owner ruling this migration applies covers the READ only, and a database '
          'where the mutation hold has already been broken is not the one it was written for', v_held;
    END IF;

    SELECT count(*) INTO v_held
      FROM principal_capabilities pc
      JOIN capabilities c ON c.id = pc.capability_id
     WHERE c.object_key = 'workflowDefinition';
    IF v_held > 0 THEN
        RAISE EXCEPTION
          'WORKFLOW_DEFINITION_READ_AUTHORITY: % direct Principal grant(s) exist on a '
          'workflowDefinition capability -- those are an Administration decision and their presence '
          'means this database is not in the reviewed state', v_held;
    END IF;

    -- 3. No Role OTHER than admin and owner may already hold the read. Re-running this migration is
    --    a no-op by ON CONFLICT; a THIRD holder is a different fact, and it would mean the exact
    --    population the Owner stated ({admin, owner}) is not what this database would end up with.
    SELECT r.key INTO v_stranger
      FROM role_capabilities rc
      JOIN capabilities c ON c.id = rc.capability_id
      JOIN roles r        ON r.id = rc.role_id
     WHERE c.id = 'cap_workflowDefinition_read'
       AND r.key NOT IN ('admin', 'owner')
     LIMIT 1;
    IF v_stranger IS NOT NULL THEN
        RAISE EXCEPTION
          'WORKFLOW_DEFINITION_READ_AUTHORITY: Role "%" already holds workflowDefinition.read -- the '
          'ruling names exactly admin and owner, and this migration will not make a third holder '
          'the accidental outcome of applying it', v_stranger;
    END IF;

    -- 4. If this database has been SEEDED, the Object must be among what it seeded, or the grant is
    --    unadministrable: invisible in the Object view and NOT_FOUND from getObjectSecurityMatrix.
    --    Asked only of a seeded database because `objects` rows are TENANT-SCOPED and written by the
    --    seed, while `capabilities` rows are GLOBAL and written by migrations -- a freshly migrated
    --    database has no tenant and therefore no Objects at all, and refusing there would make every
    --    clean migrate fail.
    SELECT count(*) INTO v_seeded FROM objects;
    IF v_seeded > 0 THEN
        SELECT count(*) INTO v_object FROM objects WHERE key = 'workflowDefinition';
        IF v_object = 0 THEN
            RAISE EXCEPTION
              'WORKFLOW_DEFINITION_READ_AUTHORITY: this database has been seeded with % Object(s) and '
              '"workflowDefinition" is not among them -- granting a capability against an Object '
              'Administration cannot project would strand the grant', v_seeded;
        END IF;
    END IF;
END
$$;

-- ════════════════════ THE GOVERNED ROLE GRANTS ════════════════════
--
-- Joined by Role KEY so the statement is correct in every tenant, and ON CONFLICT DO NOTHING so
-- re-running changes nothing. A Role this tenant does not define simply matches no row. The id shape
-- is the one migration 1761609600000 established and 1762041600000 reused.
--
-- TWO ROWS PER TENANT, and the VALUES list below is the entire grant population of this migration:
-- workflowDefinition.read to admin, workflowDefinition.read to owner. Nothing else on this Object is
-- named here, which is what keeps create/edit/version/publish/bindRole at ZERO.
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_x_' || substr(md5(r.tenant_id || r.id || c.id), 1, 26),
       r.tenant_id, r.id, c.id,
       'migration:1762128000000', now(), 'migration:1762128000000', now(), 'migration:1762128000000', now()
  FROM (VALUES
        ('admin', 'workflowDefinition.read'),
        ('owner', 'workflowDefinition.read')
      ) AS g(role_key, capability_key)
  JOIN roles        r ON r.key = g.role_key
  JOIN capabilities c ON c.key = g.capability_key
 ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
SET search_path = eos_policy, public;

-- GUARDED. The grants this migration wrote are removed by their own provenance stamp, so a grant an
-- administrator made later through the governed command -- which carries a different granted_by --
-- survives a down. If such a grant exists, the reversal REFUSES rather than destroying recorded
-- authority.
--
-- THE CAPABILITY ROW IS NOT TOUCHED. `workflowDefinition.read` was registered by migration
-- 1761350400000 and outlives this one: a down that deleted it would reverse somebody else's
-- migration, and would strand the other five workflowDefinition rows beside a missing sibling.
DO $$
DECLARE
    v_held INT;
BEGIN
    DELETE FROM role_capabilities
     WHERE granted_by = 'migration:1762128000000'
       AND capability_id = 'cap_workflowDefinition_read';

    SELECT count(*) INTO v_held FROM role_capabilities
     WHERE capability_id = 'cap_workflowDefinition_read';
    IF v_held > 0 THEN
        RAISE EXCEPTION
          'WORKFLOW_DEFINITION_READ_AUTHORITY: refuses to reverse -- workflowDefinition.read is '
          'still held by % Role grant(s) this migration did not write', v_held;
    END IF;

    SELECT count(*) INTO v_held FROM principal_capabilities
     WHERE capability_id = 'cap_workflowDefinition_read';
    IF v_held > 0 THEN
        RAISE EXCEPTION
          'WORKFLOW_DEFINITION_READ_AUTHORITY: refuses to reverse -- workflowDefinition.read is '
          'still held by % direct Principal grant(s)', v_held;
    END IF;
END
$$;
