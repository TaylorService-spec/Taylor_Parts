-- Up Migration
-- RETIRE THE stockLocation ADMINISTRATION OBJECT -- stale policy metadata, nothing else.
--
-- ════════════════════ WHAT THIS DELETES, AND WHAT IT EMPHATICALLY DOES NOT ════════════════════
--
-- `stock_locations` was retired as an operational authority by Owner ruling on 2026-09-12, and its
-- entity left the client registry. What survived is an Administration POLICY row in
-- eos_policy.objects, in databases seeded before that ruling, plus its subordinate field and CRED
-- metadata. That is what goes.
--
-- IT TOUCHES NO BUSINESS DATA. Not eos_ops.warehouses, not eos_ops.bins, not eos_ops.parts, not
-- inventory_movements, not mobile_locations, and not employee_operational_scopes. The Object's
-- FIELD rows are named binCode / partId / quantity / warehouseId, which describe a retired
-- collection's shape -- they are metadata ABOUT data, never the data.
--
-- IT TOUCHES NO CAPABILITY. Measured: zero canonical capabilities carry object_key =
-- 'stockLocation' and none has the string in its key. `warehouse.stockLocation.read` exists in the
-- FIREBASE permissionCatalog and names the stock_locations COLLECTION; it is not a PostgreSQL
-- capability and is untouched here.
--
-- ════════════════════ EXACTLY ONE OBJECT, NEVER A RULE ════════════════════
--
-- This targets the literal key 'stockLocation'. There is deliberately NO
-- "DELETE WHERE key NOT IN (the seed)" here and none belongs in the seed either: a rule like that
-- would delete real configuration the moment a snapshot lagged behind a database.
--
-- The census this was written against, re-asserted below so a different database refuses rather
-- than guesses: 1 object, 6 object_fields, 4 role_object_permissions (admin, dispatcher,
-- operationsManager, owner -- READ only), 0 field overrides, 0 workflow references.
SET search_path = eos_policy, public;

DO $$
DECLARE
    v_objects  INT;
    v_fields   INT;
    v_cred     INT;
    v_override INT;
    v_caps     INT;
    v_wf       INT;
    v_wfi      INT;
BEGIN
    SELECT count(*) INTO v_objects FROM objects WHERE key = 'stockLocation';
    IF v_objects = 0 THEN
        -- A database seeded after the retirement never had the row. Nothing to do, and that is not
        -- an error: this migration must be a no-op on a clean database.
        RETURN;
    END IF;

    SELECT count(*) INTO v_fields FROM object_fields f
      JOIN objects o ON o.id = f.object_id WHERE o.key = 'stockLocation';
    SELECT count(*) INTO v_cred FROM role_object_permissions r
      JOIN objects o ON o.id = r.object_id WHERE o.key = 'stockLocation';
    SELECT count(*) INTO v_override FROM role_field_permission_overrides fo
      JOIN object_fields f ON f.id = fo.field_id
      JOIN objects o ON o.id = f.object_id WHERE o.key = 'stockLocation';
    SELECT count(*) INTO v_caps FROM capabilities WHERE object_key = 'stockLocation';
    SELECT count(*) INTO v_wf  FROM workflows          WHERE object_key = 'stockLocation';
    SELECT count(*) INTO v_wfi FROM workflow_instances WHERE object_key = 'stockLocation';

    -- REFUSE RATHER THAN GUESS. Each of these would mean this database is not the one the census
    -- described, and deleting on its behalf would destroy something nobody reviewed.
    IF v_caps > 0 THEN
        RAISE EXCEPTION 'refusing to retire stockLocation: % canonical capability row(s) reference it', v_caps;
    END IF;
    IF v_wf > 0 OR v_wfi > 0 THEN
        RAISE EXCEPTION 'refusing to retire stockLocation: % workflow definition(s) and % instance(s) depend on it', v_wf, v_wfi;
    END IF;
    IF v_fields <> 6 OR v_cred <> 4 OR v_override <> 0 THEN
        RAISE EXCEPTION 'refusing to retire stockLocation: subordinate metadata is % fields / % CRED rows / % field overrides, and the reviewed census was 6 / 4 / 0', v_fields, v_cred, v_override;
    END IF;

    -- FK-SAFE ORDER, from the actual constraints: role_field_permission_overrides -> object_fields,
    -- and both object_fields and role_object_permissions -> objects. Nothing else references either.
    DELETE FROM role_field_permission_overrides fo
     USING object_fields f, objects o
     WHERE fo.field_id = f.id AND f.object_id = o.id AND o.key = 'stockLocation';

    DELETE FROM role_object_permissions r
     USING objects o
     WHERE r.object_id = o.id AND o.key = 'stockLocation';

    DELETE FROM object_fields f
     USING objects o
     WHERE f.object_id = o.id AND o.key = 'stockLocation';

    DELETE FROM objects WHERE key = 'stockLocation';
END $$;

-- Down Migration
SET search_path = eos_policy, public;

-- FORWARD_CORRECTION_REQUIRED, expressed as a NO-OP rather than a refusal.
--
-- This migration has NO DDL. It removed rows from a RETIRED Administration Object that the governed
-- seed no longer declares, so there is no schema to restore and no evidence from which to rebuild
-- the data -- rebuilding it would mean recreating an Object the platform has ruled should not
-- exist. Reversing a retirement is a new decision, and a new decision is a forward migration.
--
-- It does NOT raise. An unconditional refusal here would make the WHOLE migration set
-- irreversible -- including on a database where the up was a no-op because stockLocation was never
-- seeded -- and eleven existing reversibility proofs say that is not this repository's pattern.
-- The guarded refusals elsewhere in this schema are CONDITIONAL, firing only when real data would
-- be destroyed; a pure-DML cleanup of already-retired metadata has nothing to protect.
DO $$
BEGIN
    RAISE NOTICE 'migration 1761868800000 does not restore the retired stockLocation Object: reversing a retirement is a forward decision (FORWARD_CORRECTION_REQUIRED)';
END $$;
