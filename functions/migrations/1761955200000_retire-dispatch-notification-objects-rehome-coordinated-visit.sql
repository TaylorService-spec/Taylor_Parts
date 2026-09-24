-- Up Migration
-- RETIRE THE dispatchSchedule AND notifications ADMINISTRATION OBJECTS, AND GIVE THE
-- COORDINATED-VISIT READ A REAL OBJECT TO BELONG TO.
--
-- ════════════════════ WHY THESE TWO OBJECTS GO ════════════════════
--
-- Both are MATRIX_ONLY policy rows describing a data authority that does not exist. Measured in
-- nonprod before this was written: neither has a PostgreSQL table, neither has a Firestore
-- collection holding a single document, neither declares one field, and neither is named by any
-- canonical capability, workflow definition or workflow instance. What each carries is a READ row
-- per Role in role_object_permissions -- CRED cells for a record nobody can read, because there is
-- no record. They are the last two DATA_AUTHORITY_MIGRATION_BLOCKERS in the CRED equivalence
-- measurement, and they block it by describing nothing.
--
-- notifications additionally has no policy successor AT ALL, by ruling. The notification bell
-- surfaces Reorder Request queues, and that visibility is already governed where it belongs --
-- reorder.request.read.queue, in its existing SUPERSEDED posture, untouched here. Recipient
-- visibility is a property of the underlying record, never a Security Role, so no capability is
-- created for it and none should be.
--
-- ════════════════════ WHY dispatchSchedule KEEPS A SUCCESSOR ════════════════════
--
-- dispatchSchedule's READ verb was mapped by the governed seed to fulfillment.coordinatedVisit.read
-- -- the trusted listCoordinatedOperations projection. That capability governs something real, so
-- retiring the Object must not take it down with it. It is re-homed here onto the Object whose
-- state it actually reads: THE SALES ORDER IS THE COORDINATOR. There is no Dispatch/Visit/
-- WorkOrderGroup authority in this platform and this migration does not invent one.
--
-- MEASURED DIVERGENCE FROM THE REVIEWED CENSUS, STATED PLAINLY: this capability was NOT present in
-- eos_policy.capabilities. It lives in the Firebase-era permissionCatalog (active:false, sandbox-
-- activated) and is held by exactly five Roles there. The seed's capabilitiesByVerb pointed at it
-- BY NAME only -- the same shape stockLocation's warehouse.stockLocation.read had. So the re-home
-- is an INSERT of one capability plus its five evidence-derived grants, not an UPDATE of an
-- existing row. Counts move 74 -> 75 capabilities and 367 -> 372 role_capabilities.
--
-- THE FIVE GRANTS ARE DERIVED, NOT CHOSEN. They are exactly what deriveLegacyRoleGrants() returns
-- for this capability key from the governed role catalog: admin, dispatcher, fieldManager,
-- operationsManager, owner. No role was added to make a count come out, and none was dropped.
--
-- ════════════════════ CRED SAFETY ════════════════════
--
-- action_key is readCoordinatedVisits and action_kind is BUSINESS_ACTION, deliberately NOT READ.
-- A named business act does not collapse into the Object's generic verb: holding this capability
-- must never satisfy a generic salesOrder READ, and holding salesOrder.read must never satisfy
-- this. salesOrder.read keeps action_key 'read' and is untouched; the (object_key, action_key)
-- unique index keeps the two rows distinct by construction.
--
-- ════════════════════ WHAT THIS DOES NOT DO ════════════════════
--
-- It creates NO table for either retired Object. It performs NO runtime cutover:
-- listCoordinatedOperations still reads fieldops_wos through Firestore, tracked as
-- COORDINATED_VISIT_RUNTIME_CUTOVER_BLOCKER, and moving that read is a separate authorized slice.
-- It targets two literal keys -- there is deliberately no "DELETE WHERE key NOT IN (the seed)"
-- here, because a rule like that would delete real configuration the moment a snapshot lagged.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_key       TEXT;
    v_expect    INT;
    v_objects   INT;
    v_fields    INT;
    v_cred      INT;
    v_override  INT;
    v_caps      INT;
    v_wf        INT;
    v_wfi       INT;
BEGIN
    -- The reviewed census, re-asserted per Object so a different database refuses rather than
    -- guesses: 0 fields / 0 field overrides / 0 capabilities / 0 workflow references for both,
    -- 5 CRED rows for dispatchSchedule and 6 for notifications.
    FOR v_key, v_expect IN SELECT * FROM (VALUES ('dispatchSchedule', 5), ('notifications', 6)) AS c(k, n)
    LOOP
        SELECT count(*) INTO v_objects FROM objects WHERE key = v_key;
        IF v_objects = 0 THEN
            -- A database seeded after the retirement never had the row. That is not an error:
            -- this migration must be a no-op on a clean database.
            CONTINUE;
        END IF;

        SELECT count(*) INTO v_fields FROM object_fields f
          JOIN objects o ON o.id = f.object_id WHERE o.key = v_key;
        SELECT count(*) INTO v_cred FROM role_object_permissions r
          JOIN objects o ON o.id = r.object_id WHERE o.key = v_key;
        SELECT count(*) INTO v_override FROM role_field_permission_overrides fo
          JOIN object_fields f ON f.id = fo.field_id
          JOIN objects o ON o.id = f.object_id WHERE o.key = v_key;
        SELECT count(*) INTO v_caps FROM capabilities       WHERE object_key = v_key;
        SELECT count(*) INTO v_wf   FROM workflows          WHERE object_key = v_key;
        SELECT count(*) INTO v_wfi  FROM workflow_instances WHERE object_key = v_key;

        IF v_caps > 0 THEN
            RAISE EXCEPTION 'refusing to retire %: % canonical capability row(s) reference it', v_key, v_caps;
        END IF;
        IF v_wf > 0 OR v_wfi > 0 THEN
            RAISE EXCEPTION 'refusing to retire %: % workflow definition(s) and % instance(s) depend on it', v_key, v_wf, v_wfi;
        END IF;
        IF v_fields <> 0 OR v_override <> 0 OR v_cred <> v_expect THEN
            RAISE EXCEPTION 'refusing to retire %: subordinate metadata is % fields / % CRED rows / % field overrides, and the reviewed census was 0 / % / 0', v_key, v_fields, v_cred, v_override, v_expect;
        END IF;

        -- FK-safe order: role_field_permission_overrides -> object_fields, and both object_fields
        -- and role_object_permissions -> objects. Nothing else references either.
        DELETE FROM role_field_permission_overrides fo
         USING object_fields f, objects o
         WHERE fo.field_id = f.id AND f.object_id = o.id AND o.key = v_key;

        DELETE FROM role_object_permissions r
         USING objects o
         WHERE r.object_id = o.id AND o.key = v_key;

        DELETE FROM object_fields f
         USING objects o
         WHERE f.object_id = o.id AND o.key = v_key;

        DELETE FROM objects WHERE key = v_key;
    END LOOP;
END $$;

-- ──────────────── RE-HOME THE COORDINATED-VISIT READ ONTO salesOrder ────────────────
DO $$
DECLARE
    v_existing INT;
    v_pair     INT;
    v_roles    INT;
BEGIN
    SELECT count(*) INTO v_existing FROM capabilities WHERE key = 'fulfillment.coordinatedVisit.read';
    IF v_existing > 0 THEN
        -- The census said this row does not exist. If a database has it, its object_key/action_key
        -- were decided by something this migration has not read. Refuse rather than overwrite.
        RAISE EXCEPTION 'refusing to re-home fulfillment.coordinatedVisit.read: the capability already exists and this migration was written against its absence';
    END IF;

    SELECT count(*) INTO v_pair FROM capabilities
     WHERE object_key = 'salesOrder' AND action_key = 'readCoordinatedVisits';
    IF v_pair > 0 THEN
        RAISE EXCEPTION 'refusing to re-home fulfillment.coordinatedVisit.read: (salesOrder, readCoordinatedVisits) is already taken';
    END IF;

    -- HOW MANY OF THE DERIVED SET THIS DATABASE ACTUALLY DEFINES. The seed writes Roles AFTER
    -- migrations, so a freshly created database legitimately has zero and the insert below lands
    -- zero rows -- the same posture every other grant migration in this directory has. A fixture
    -- database that defines only some of them is equally legitimate, so this is MEASURED here and
    -- checked against what the insert wrote, not turned into a precondition: refusing a partial
    -- Role catalog would fail migrations for databases that were never meant to hold the others.
    SELECT count(*) INTO v_roles FROM roles
     WHERE key IN ('admin', 'dispatcher', 'fieldManager', 'operationsManager', 'owner');
END $$;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_fulfillment_coordinated_visit_read', 'fulfillment.coordinatedVisit.read',
     'Read the governed coordinated-Work-Order projection for a Sales Order via the trusted listCoordinatedOperations read service. A named business act, not a generic Sales Order read: it returns only the coordination projection and never satisfies salesOrder.read.',
     'salesOrder', 'readCoordinatedVisits', 'BUSINESS_ACTION', 'Read Coordinated Visits');

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_cv_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1761955200000', now(), 'migration:1761955200000', now(), 'migration:1761955200000', now()
  FROM (VALUES
        ('admin'), ('dispatcher'), ('fieldManager'), ('operationsManager'), ('owner')
      ) AS g(role_key)
  JOIN roles        r ON r.key = g.role_key
  JOIN capabilities c ON c.key = 'fulfillment.coordinatedVisit.read'
 ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

DO $$
DECLARE
    v_granted INT;
    v_roles   INT;
BEGIN
    SELECT count(*) INTO v_granted FROM role_capabilities rc
      JOIN capabilities c ON c.id = rc.capability_id
     WHERE c.key = 'fulfillment.coordinatedVisit.read';
    SELECT count(*) INTO v_roles FROM roles
     WHERE key IN ('admin', 'dispatcher', 'fieldManager', 'operationsManager', 'owner');
    -- EXACTLY ONE GRANT PER GOVERNED ROLE THIS DATABASE DEFINES: 5 in a fully seeded database, 0 in
    -- a fresh one, and whatever a partial fixture holds. This is the assertion that makes the
    -- preservation claim true -- a silent subset, a duplicate, or a Role outside the derived set
    -- all break the equality.
    IF v_granted <> v_roles THEN
        RAISE EXCEPTION 'coordinated-visit read landed on % Role grants, and the derived set present in this database is %', v_granted, v_roles;
    END IF;
END $$;

-- Down Migration
SET search_path = eos_policy, public;

-- The RE-HOME half is additive DDL-free data this migration alone created, so it reverses exactly.
DELETE FROM role_capabilities rc
 USING capabilities c
 WHERE rc.capability_id = c.id AND c.key = 'fulfillment.coordinatedVisit.read';

DELETE FROM capabilities WHERE key = 'fulfillment.coordinatedVisit.read';

-- The RETIREMENT half is FORWARD_CORRECTION_REQUIRED, expressed as a NO-OP rather than a refusal.
-- It removed rows from two retired Administration Objects the governed seed no longer declares, so
-- there is no schema to restore and no evidence from which to rebuild them -- rebuilding would mean
-- recreating Objects the platform has ruled should not exist. Reversing a retirement is a new
-- decision, and a new decision is a forward migration. It does NOT raise: an unconditional refusal
-- would make the whole migration set irreversible, including on a database where the up was a
-- no-op, and this repository's guarded refusals are CONDITIONAL, firing only when real data would
-- be destroyed.
DO $$
BEGIN
    RAISE NOTICE 'migration 1761955200000 does not restore the retired dispatchSchedule and notifications Objects: reversing a retirement is a forward decision (FORWARD_CORRECTION_REQUIRED)';
END $$;
