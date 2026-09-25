-- Up Migration
-- THE AUTHORITY ACTIVATION VEHICLE -- the Owner-approved corrections, the edit-without-read
-- reconciliation, and Reporting Slice 1, applied as ONE atomic change.
--
-- ════════════════════ WHY ONE MIGRATION AND NOT THREE ════════════════════
--
-- Owner ruling E: a governed capability/grant activation and the authority baseline that explains
-- it must land together. `roleCapabilityAuthorityBaselinePostgres.test.mjs` replays EVERY migration
-- in this directory (phase C) and compares the result against
-- `seed/roleCapabilityAuthorityBaseline.json`. A grant-bearing migration landed without its
-- baseline makes the rebuild produce more rows than the baseline declares and the guard reports
-- MISSING DECLARATION -- which is exactly why lane BK, which was not authorized to activate
-- anything, authored NO migration and recorded its ten approved grants in
-- `seed/pendingAuthorityCorrections.json` instead. This file is the ACTIVATION half of that pair.
-- The approval half moves out of the pending manifest in the same commit, because a grant that is
-- both "pending" and "applied" is two answers to one question.
--
-- ════════════════════ WHAT IT DOES, IN THREE PARTS ════════════════════
--
-- PART 1 -- THE APPROVED CORRECTIONS (lane BK's set, rulings S1-S6). Ten grants, unchanged in
--           population from the manifest that recorded them:
--
--     owner                            -> receivingOrder.record.read   (S1, capability registered here)
--     owner                            -> workOrder.record.read        (S1, capability registered here)
--     warehouseManager                 -> warehouse.record.read        (S2, READ only)
--     warehouseAssociate               -> warehouse.record.read        (S2, READ only)
--     inventoryPutAwayOperator         -> inventory.placement.record   (S2, FUNCTIONAL Role)
--     inventoryStockRelocationOperator -> inventory.stock.relocate     (S2, FUNCTIONAL Role)
--     inventoryCycleCountReconciler    -> inventory.cycleCount.close   (S3, 0 holders today)
--     partsManager                     -> reorder.request.assign       (S4, 0 holders today)
--     fieldManager                     -> workOrder.lifecycle.dispatch (S6)
--     fieldManager                     -> workOrder.lifecycle.cancel   (S6)
--
--           FUNCTIONAL ROLES STAY FUNCTIONAL. `inventory.placement.record` and
--           `inventory.stock.relocate` land on the Roles that PERFORM put-away and relocation, and
--           deliberately NOT on `warehouseManager` / `warehouseAssociate`, which are job POSITIONS.
--           A position is not an operating authority, and the two warehouse Roles get the record
--           READ they were missing and nothing else. The census below refuses to run if any of
--           those four refused pairs is already held.
--
-- PART 2 -- THE EDIT-WITHOUT-READ RECONCILIATION (Owner ruling B). Thirteen measured rows where a
--           Role holds a governed WRITE on an Object it cannot read:
--
--     receivingOrder <- admin, dispatcher, inventoryReceivingClerk   via inventory.stock.receive
--     workOrder      <- admin, dispatcher, fieldManager, generalManager, operationsManager,
--                       partsAssociate, partsManager, shopAssociate, shopManager, technician
--                                                                    via workOrder.transition
--
--           EACH ROW WAS CLASSIFIED BEFORE ANY READ WAS ADDED, and all thirteen come out the same
--           way -- WRITE_LEGITIMATE_READ_REQUIRED -- for reasons that are measured rather than
--           assumed:
--
--             * the write is REAL, not a projection artifact. `inventory.stock.receive` carries
--               object_key `receivingOrder` and `workOrder.transition` carries object_key
--               `workOrder` in eos_policy.capabilities, so in both cases the Role holds a governed
--               capability whose canonical Object IS the Object it cannot read. Nothing here is a
--               matrix row pointing at a capability that names somewhere else.
--             * the write is NOT REVOCABLE BY THIS FILE. All thirteen grants are CANONICAL_CATALOG
--               in the authority baseline: the in-repo Role catalog declares them, and the eleven
--               `workOrder.transition` rows carry the live stamp `owner-ruling-2026-09-22`.
--               Classifying one as WRITE_NOT_LEGITIMATE would mean deleting a grant a recorded
--               Owner ruling made, from a Role catalog this change does not own.
--
--           So the narrowest READ authority is added, and only to the Roles that hold the write.
--           `officeManager` (workOrder.create, no transition) and `workOrderPartsPlanner` (a LEGACY
--           `workOrder.parts.plan` id that eos_policy.capabilities does not register at all) are
--           OUTSIDE the thirteen and get nothing here; they are recorded in
--           pendingAuthorityCorrections.json as measured, classified and open.
--
-- PART 3 -- REPORTING SLICE 1 (Owner ruling C). ONE Object and ONE capability:
--
--     reportDefinition              Administration domain, zero fields, CAPABILITY_AUTHORITY source
--     reportDefinition.read         reportDefinition / read / READ  ->  admin, owner, reportViewer
--
--           The Object is declared in `seed/capabilityGovernedObjects.json` beside
--           `workflowDefinition`, whose shape it mirrors exactly, because a capability's
--           `object_key` is NOT NULL (migration 1761350400000) and a capability naming an Object no
--           tenant seeds is unadministrable.
--
--           THE 34 FIELD-LEVEL REPORT IDS ARE DELIBERATELY NOT REGISTERED. `capabilities` has
--           `object_key` NOT NULL, `UNIQUE (object_key, action_key)` and NO FIELD COLUMN: the
--           relation cannot express a field dimension, so 34 rows would either collide or be 34
--           fake Objects. Field-level reporting is `eos_policy.role_field_permission_overrides`,
--           which exists and holds ZERO rows over the seeded object_fields. That is the
--           registration's real home and this file does not pre-empt it.
--
--           THE ROLE MODEL IS NOT A LADDER. `reportFinanceViewer` receives NO Object-level
--           reporting capability here: it is ADDITIVE finance-sensitive FIELD visibility, not a
--           superset of `reportViewer`, and giving it the Object read would make "reporting access"
--           one decision where the Role catalog deliberately made it two. `reportAuthor` receives
--           none either -- saved-report authoring is not reading, and no authoring verb is
--           registered by this file because their callables are not deployed.
--           `reportDefinition.delete` IS NOT REGISTERED AT ALL, so it cannot be granted by anyone.
--           No job-title Role receives Reporting in this tranche.
--
-- ════════════════════ WHAT THIS DELIBERATELY DOES NOT DO ════════════════════
--
-- It grants `workOrder.lifecycle.complete` to NOBODY. Completion remains technician execution
-- authority: the person who did the work attests that it is done, and a manager who may both
-- dispatch and complete can close work nobody performed. test/migrationChainSafety.test.mjs keeps
-- that key fully held against the whole chain, and this migration narrows the hold on `dispatch`
-- and `cancel` by exactly one Role -- fieldManager -- rather than switching the guard off.
--
-- It grants `reorder.request.assign` to partsManager ALONE. The Role catalog also declares it for
-- admin, dispatcher and owner; ruling S4 named partsManager and named dispatcher, technician and
-- purchasingManager as NOT holders, so the other three catalog declarations stay unactivated and
-- stay visible in the baseline rather than being swept in because they were nearby.
--
-- It adds NO Work Eligibility code and NO Operational Scope row. `PARTS_OPERATIONS` is a Work
-- Eligibility qualification, not a capability, and the technician's reorder-queue denial rests on a
-- withheld SCOPE row -- so the technician KEEPS `reorder.request.read` and gains only the work
-- order READ that ruling B's classification requires.
--
-- It writes NO direct Principal grant, creates and retires no relation, and contains no
-- "DELETE ... WHERE key NOT IN (...)": a rule like that deletes real configuration the moment a
-- snapshot lags behind a database.
--
-- Counts move: capabilities 76 -> 79, role_capabilities +26 per tenant that defines the named Roles.
-- Nonprod before: capabilities 76, objects 39, role_capabilities 387, principal_capabilities 0,
-- migrations 50. THIS MIGRATION HAS NOT BEEN APPLIED TO NONPROD; every proof was run against a
-- disposable local database.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_seeded   INT;
    v_missing  TEXT;
    v_existing INT;
    v_conflict TEXT;
    v_vocab    INT;
    v_writes   INT;
    v_held     INT;
    v_holder   TEXT;
BEGIN
    -- THE CENSUS REFUSES RATHER THAN GUESSES. Every fact below was measured on a disposable rebuild
    -- of the nonprod authority before this file was written; a database that disagrees stops the
    -- migration instead of writing rows on top of a shape nobody checked.

    -- 1. THE VOCABULARY THIS WAS WRITTEN AGAINST. 76 rows, the state migration 1762214400000 left.
    SELECT count(*) INTO v_vocab FROM capabilities;
    IF v_vocab <> 76 THEN
        RAISE EXCEPTION
          'AUTHORITY_ACTIVATION: expected the 76-row capability vocabulary this migration was '
          'written against and found % -- this database carries a different vocabulary', v_vocab;
    END IF;

    -- 2. THE OBJECTS MUST BE PROJECTABLE, asked only of a SEEDED database. `objects` rows are
    --    TENANT-SCOPED and written by the seed; `capabilities` rows are GLOBAL and written by
    --    migrations. A freshly migrated database has no tenant and therefore no Objects at all, so
    --    refusing there would make every clean migrate fail. Where a tenant DOES exist, a
    --    capability naming an Object it never seeded is invisible in the Object view and NOT_FOUND
    --    from getObjectSecurityMatrix -- the stranded-grant defect
    --    test/capabilityObjectAuthorityGuard.test.mjs exists to catch.
    SELECT count(*) INTO v_seeded FROM objects;
    IF v_seeded > 0 THEN
        SELECT string_agg(k, ', ' ORDER BY k) INTO v_missing
          FROM unnest(ARRAY['receivingOrder', 'workOrder', 'reportDefinition']) AS k
         WHERE NOT EXISTS (SELECT 1 FROM objects o WHERE o.key = k);
        IF v_missing IS NOT NULL THEN
            RAISE EXCEPTION
              'AUTHORITY_ACTIVATION: this database has been seeded with % Object(s) and % is not '
              'among them -- registering a capability against an Object Administration cannot '
              'project would strand the grant', v_seeded, v_missing;
        END IF;
    END IF;

    -- 3. THE THREE CELLS MUST BE GENUINELY EMPTY. A UNIQUE index on (object_key, action_key)
    --    already makes a duplicate impossible; this turns the constraint violation into a sentence,
    --    and it is also the measured PREMISE of ruling B: receivingOrder and workOrder have no READ
    --    authority at all, which is why their Roles' can_read is false rather than withheld.
    SELECT c.key INTO v_conflict FROM capabilities c
      WHERE c.action_key = 'read'
        AND c.object_key IN ('receivingOrder', 'workOrder', 'reportDefinition')
      LIMIT 1;
    IF v_conflict IS NOT NULL THEN
        RAISE EXCEPTION
          'AUTHORITY_ACTIVATION: a read is already governed by "%" on one of receivingOrder, '
          'workOrder, reportDefinition -- the measured premise of this migration does not hold '
          'in this database', v_conflict;
    END IF;

    -- 4. THE THREE KEYS MUST BE UNUSED, so no name acquires a second meaning.
    SELECT count(*) INTO v_existing FROM capabilities
      WHERE key IN ('receivingOrder.record.read', 'workOrder.record.read', 'reportDefinition.read');
    IF v_existing > 0 THEN
        RAISE EXCEPTION
          'AUTHORITY_ACTIVATION: % of the 3 capability keys this migration registers already exist '
          'and name a different cell -- refusing to create a second meaning for one name', v_existing;
    END IF;

    -- 5. THE WRITES RULING B RECONCILES MUST BE THE ONES THAT WERE REVIEWED. If either is absent,
    --    the edit-without-read finding this migration closes has no subject in this database.
    SELECT count(*) INTO v_writes FROM capabilities
      WHERE (key = 'inventory.stock.receive' AND object_key = 'receivingOrder')
         OR (key = 'workOrder.transition'    AND object_key = 'workOrder');
    IF v_writes <> 2 THEN
        RAISE EXCEPTION
          'AUTHORITY_ACTIVATION: expected the 2 reviewed writes (inventory.stock.receive on '
          'receivingOrder, workOrder.transition on workOrder) and found % -- ruling B was measured '
          'against a different vocabulary than this one', v_writes;
    END IF;

    -- 6. THE SEVEN ALREADY-REGISTERED KEYS THIS MIGRATION ONLY GRANTS must all exist. This file
    --    registers three keys and grants ten; the difference must already be vocabulary, or a grant
    --    would silently become a registration decision.
    SELECT count(*) INTO v_existing FROM capabilities
      WHERE key IN ('warehouse.record.read', 'inventory.placement.record', 'inventory.stock.relocate',
                    'inventory.cycleCount.close', 'reorder.request.assign',
                    'workOrder.lifecycle.dispatch', 'workOrder.lifecycle.cancel');
    IF v_existing <> 7 THEN
        RAISE EXCEPTION
          'AUTHORITY_ACTIVATION: expected the 7 already-registered keys this migration grants and '
          'found % -- refusing to turn a grant into a registration', v_existing;
    END IF;

    -- 7. THE ZERO-HOLDER PREMISES OF S3 AND S4. "Nobody can close a cycle count" and "nobody can
    --    assign a reorder request" are the findings those rulings answer. A database where somebody
    --    already can is not the one they were written for.
    SELECT count(*) INTO v_held
      FROM role_capabilities rc JOIN capabilities c ON c.id = rc.capability_id
     WHERE c.key IN ('inventory.cycleCount.close', 'reorder.request.assign');
    IF v_held > 0 THEN
        RAISE EXCEPTION
          'AUTHORITY_ACTIVATION: inventory.cycleCount.close / reorder.request.assign already carry '
          '% Role grant(s) -- rulings S3 and S4 answer a ZERO-holder finding and this database does '
          'not have one', v_held;
    END IF;

    -- 8. THE REFUSALS MUST STILL BE REFUSALS. Each pair below was considered and NOT AUTHORIZED,
    --    and each names the control it would have defeated. A database where one is already held is
    --    a finding, not something to write more rows on top of.
    SELECT r.key || '/' || c.key INTO v_holder
      FROM role_capabilities rc
      JOIN capabilities c ON c.id = rc.capability_id
      JOIN roles r        ON r.id = rc.role_id
     WHERE (r.key = 'fieldManager'               AND c.key = 'workOrder.lifecycle.complete')
        OR (r.key = 'inventoryCycleCountCounter' AND c.key = 'inventory.cycleCount.close')
        OR (r.key = 'partsAssociate'             AND c.key = 'reorder.request.assign')
        OR (r.key IN ('warehouseManager', 'warehouseAssociate')
            AND c.key IN ('inventory.placement.record', 'inventory.stock.relocate'))
     LIMIT 1;
    IF v_holder IS NOT NULL THEN
        RAISE EXCEPTION
          'AUTHORITY_ACTIVATION: a REFUSED grant is already held (%) -- a manager who may dispatch '
          'AND complete can close work nobody performed, a counter may not approve their own '
          'material variance, and a warehouse POSITION does not receive an inventory operating '
          'write because of its job title', v_holder;
    END IF;
END
$$;

-- ════════════════════ THE THREE REGISTRATIONS ════════════════════
--
-- Two close the ungoverned-READ defect ruling B measured; one opens Reporting Slice 1. Every one is
-- action_kind READ and confers nothing else: the UNIQUE index on (object_key, action_key) keeps
-- `workOrder/read` a different row from `workOrder/transition`, `workOrder/dispatch`,
-- `workOrder/cancel` and `workOrder/complete`, and `capabilitiesForRoleKeys` returns a flat set of
-- keys with no implication between them. Holding the read confers the read, by construction.
INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_receivingOrder_record_read', 'receivingOrder.record.read',
     'Read a receiving order: its lines, its expected and received quantities and its state. Confers no receipt -- inventory.stock.receive remains the separate authority to record one.',
     'receivingOrder', 'read', 'READ', 'View Receiving Orders'),
    ('cap_workOrder_record_read', 'workOrder.record.read',
     'Read a work order: its state, its schedule, its parts plan and its consumption. Confers no transition, no dispatch, no cancel, no completion and no creation.',
     'workOrder', 'read', 'READ', 'View Work Orders'),
    ('cap_reportDefinition_read', 'reportDefinition.read',
     'Read saved report definitions: open a definition and see what it selects. Confers no authoring, no rename, no duplicate and no delete, and carries NO field-level visibility -- which fields a definition may show is governed by role_field_permission_overrides, not by this row.',
     'reportDefinition', 'read', 'READ', 'View Report Definitions')
ON CONFLICT (key) DO NOTHING;

-- ════════════════════ THE GOVERNED ROLE GRANTS -- 26 PAIRS, ENUMERATED ════════════════════
--
-- Joined by Role KEY so the statement is correct in every tenant, and ON CONFLICT DO NOTHING so
-- re-running changes nothing. A Role this tenant does not define simply matches no row. The id
-- shape is the one migration 1761609600000 established and every grant migration since has reused.
--
-- THIS VALUES LIST IS THE ENTIRE GRANT POPULATION OF THIS MIGRATION. Nothing is derived, widened or
-- inferred from a family resemblance: a Role is here because a ruling named it.
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_x_' || substr(md5(r.tenant_id || r.id || c.id), 1, 26),
       r.tenant_id, r.id, c.id,
       'migration:1762300800000', now(), 'migration:1762300800000', now(), 'migration:1762300800000', now()
  FROM (VALUES
        -- ── ruling B: the Receiving READ, to the three Roles that hold the receipt write, and to Owner (S1)
        ('admin',                            'receivingOrder.record.read'),
        ('dispatcher',                       'receivingOrder.record.read'),
        ('inventoryReceivingClerk',          'receivingOrder.record.read'),
        ('owner',                            'receivingOrder.record.read'),
        -- ── ruling B: the Work Order READ, to the ten Roles that hold workOrder.transition, and to Owner (S1)
        ('admin',                            'workOrder.record.read'),
        ('dispatcher',                       'workOrder.record.read'),
        ('fieldManager',                     'workOrder.record.read'),
        ('generalManager',                   'workOrder.record.read'),
        ('operationsManager',                'workOrder.record.read'),
        ('owner',                            'workOrder.record.read'),
        ('partsAssociate',                   'workOrder.record.read'),
        ('partsManager',                     'workOrder.record.read'),
        ('shopAssociate',                    'workOrder.record.read'),
        ('shopManager',                      'workOrder.record.read'),
        ('technician',                       'workOrder.record.read'),
        -- ── S2: the warehouse POSITIONS get the record READ and no operating write
        ('warehouseAssociate',               'warehouse.record.read'),
        ('warehouseManager',                 'warehouse.record.read'),
        -- ── S2: the operating writes go to the FUNCTIONAL Roles that perform them
        ('inventoryPutAwayOperator',         'inventory.placement.record'),
        ('inventoryStockRelocationOperator', 'inventory.stock.relocate'),
        -- ── S3: close is reconciliation authority; the COUNTER is excluded by SOD_EXCLUSIVE_PAIRS
        ('inventoryCycleCountReconciler',    'inventory.cycleCount.close'),
        -- ── S4: assignment is queue management, and lands on partsManager alone
        ('partsManager',                     'reorder.request.assign'),
        -- ── S6: scheduling authority for the service manager -- dispatch and cancel, never complete
        ('fieldManager',                     'workOrder.lifecycle.dispatch'),
        ('fieldManager',                     'workOrder.lifecycle.cancel'),
        -- ── ruling C: Reporting Slice 1. reportFinanceViewer and reportAuthor are absent by design.
        ('admin',                            'reportDefinition.read'),
        ('owner',                            'reportDefinition.read'),
        ('reportViewer',                     'reportDefinition.read')
      ) AS g(role_key, capability_key)
  JOIN roles        r ON r.key = g.role_key
  JOIN capabilities c ON c.key = g.capability_key
 ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- ════════════════════ THE CRED PROJECTION, RECONCILED -- NO AUTHORITY CHANGES ════════════════════
--
-- `role_object_permissions` is a PROJECTION of the governed authority, written once per Role by the
-- seed. `deriveObjectCred` sets a verb true only when the Role holds one of the capability ids the
-- seed snapshot lists for that (Object, verb) -- and the snapshot listed `R: []` for employee,
-- rolesPermissions, receivingOrder and workOrder, so R stayed false for EVERY Role however much
-- READ authority it held. That empty list, not a withheld grant, is why `admin` and `owner` could
-- not read the Employee record or the security policy they already hold reads on.
--
-- The snapshot's R lists are wired in the same commit as this migration. This statement reconciles
-- databases that were seeded BEFORE that wiring, and it CHANGES NO EFFECTIVE AUTHORITY: it sets
-- can_read true only where the Role already holds a registered READ capability on that Object, so
-- every row it writes is the projection catching up with a grant that already exists. It grants
-- nothing, revokes nothing, and touches no other verb.
INSERT INTO role_object_permissions
       (id, tenant_id, role_id, object_id, can_create, can_read, can_edit, can_delete, created_by, updated_by)
-- DISTINCT because a Role may one day hold two READ capabilities on one Object, and ON CONFLICT
-- refuses to affect the same row twice within one statement.
SELECT DISTINCT
       'rop_x_' || substr(md5(o.tenant_id || r.id || o.id), 1, 26),
       o.tenant_id, r.id, o.id, false, true, false, false,
       'migration:1762300800000', 'migration:1762300800000'
  FROM objects o
  JOIN roles            r  ON r.tenant_id = o.tenant_id
  JOIN role_capabilities rc ON rc.tenant_id = o.tenant_id AND rc.role_id = r.id
  JOIN capabilities      c  ON c.id = rc.capability_id
 WHERE o.key IN ('employee', 'rolesPermissions', 'receivingOrder', 'workOrder', 'reportDefinition')
   AND c.object_key = o.key
   AND c.action_kind = 'READ'
 ON CONFLICT (tenant_id, role_id, object_id) DO UPDATE
    SET can_read   = true,
        updated_by = 'migration:1762300800000',
        updated_at = now()
  WHERE role_object_permissions.can_read = false;

-- Down Migration
SET search_path = eos_policy, public;

-- GUARDED. The grants this migration wrote are removed by their own provenance stamp, so a grant an
-- administrator made later through the governed command -- which carries a different granted_by --
-- survives a down. Each capability row is then removed only if NOTHING still holds it: a row that
-- acquired a holder this migration did not write is recorded authority, and a down migration does
-- not get to destroy it. It refuses to reverse instead.
--
-- THE PROJECTION IS NOT REVERSED. `can_read = false` on an Object whose READ the Role still holds
-- would be a FALSE projection, and the rows this statement wrote are indistinguishable from an
-- administrator's own later reconciliation. The three capability deletions below cascade nothing
-- into role_object_permissions, so reversing leaves the projection describing the authority that
-- remains -- which is the honest state, not a defect.
DO $$
DECLARE
    v_held   INT;
    v_holder TEXT;
BEGIN
    -- BY PROVENANCE ALONE. The stamp is unique to this migration, so this removes exactly the 26
    -- pairs it wrote -- both the ones on capabilities it registered and the ten on capabilities that
    -- outlive it -- and NOTHING an administrator granted later through the governed command.
    DELETE FROM role_capabilities WHERE granted_by = 'migration:1762300800000';

    SELECT count(*) INTO v_held FROM role_capabilities
     WHERE capability_id IN ('cap_receivingOrder_record_read', 'cap_workOrder_record_read',
                             'cap_reportDefinition_read');
    IF v_held > 0 THEN
        SELECT r.key || '/' || c.key INTO v_holder
          FROM role_capabilities rc
          JOIN capabilities c ON c.id = rc.capability_id
          JOIN roles r        ON r.id = rc.role_id
         WHERE c.id IN ('cap_receivingOrder_record_read', 'cap_workOrder_record_read',
                        'cap_reportDefinition_read')
         LIMIT 1;
        RAISE EXCEPTION
          'AUTHORITY_ACTIVATION: refuses to reverse -- a capability this migration registered is '
          'still held by % Role grant(s) it did not write (for example %)', v_held, v_holder;
    END IF;

    SELECT count(*) INTO v_held FROM principal_capabilities
     WHERE capability_id IN ('cap_receivingOrder_record_read', 'cap_workOrder_record_read',
                             'cap_reportDefinition_read');
    IF v_held > 0 THEN
        RAISE EXCEPTION
          'AUTHORITY_ACTIVATION: refuses to reverse -- a capability this migration registered is '
          'still held by % direct Principal grant(s)', v_held;
    END IF;

    DELETE FROM capabilities
     WHERE id IN ('cap_receivingOrder_record_read', 'cap_workOrder_record_read', 'cap_reportDefinition_read');
END
$$;
