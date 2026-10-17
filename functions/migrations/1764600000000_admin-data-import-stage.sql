-- Up Migration
-- ADMIN DATA IMPORT, STAGING -- the one Firebase-only capability a reachable EOS-sourced screen still needs
-- (Firebase exit F1, session and capability feed; DECISIONS #244).
--
-- The Data Import screen (Administration > Data Import, EOS surface administration.dataImport, earned by
-- admin.dataImport.execute) gates its upload / column-mapping / validated-preview step on `admin.dataImport.stage` and the
-- run itself on `admin.dataImport.execute`. Both ids are checked by the Firebase data-import callables. Where EOS is the
-- session source the screen's gates are answered by the caller's EOS capability set, and `execute` exists there but `stage`
-- did not -- so the preview step would have been dark for the very person the screen is for.
--
-- AUTHORITY, mirrored -- NO NEW HOLDER. `admin.dataImport.stage` is registered here and granted to exactly the one Role the
-- Firebase catalog grants it to: admin (functions/src/access/governedBusinessRoles.ts and compatibilityRoles.ts name no other
-- holder). It is the staging half of an import: it "writes no operational record and cannot", so it is a distinct, lesser act
-- than execute, not an alias for it. GRANT-BEARING (Owner ruling E): roleCapabilityAuthorityBaseline.json carries the pair in
-- the same change.
--
-- Registered on the existing `dataImport` Object, beside admin.dataImport.execute (migration 1761350400000).

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_admin_dataImport_stage', 'admin.dataImport.stage',
     'Upload a file, choose or confirm the entity, map columns, and see the validated preview of what an import would do. Writes no operational record; running the import is admin.dataImport.execute.',
     'dataImport', 'stage', 'ADMIN_ACTION', 'Stage Data Import')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_244_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764600000000', now(), 'migration:1764600000000', now(), 'migration:1764600000000', now()
  FROM capabilities c
  JOIN roles r ON r.key = 'admin'
 WHERE c.key = 'admin.dataImport.stage'
   AND NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
DO $$
DECLARE
    v_n BIGINT;
BEGIN
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions WHERE capability_key = 'admin.dataImport.stage';
    IF v_n > 0 THEN RAISE EXCEPTION 'ADMIN_DATA_IMPORT_STAGE: refuses to reverse -- % Administration decision(s) name the staging capability', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc JOIN eos_policy.capabilities c ON c.id = pc.capability_id
     WHERE c.key = 'admin.dataImport.stage';
    IF v_n > 0 THEN RAISE EXCEPTION 'ADMIN_DATA_IMPORT_STAGE: refuses to reverse -- % direct grant(s) hold the staging capability', v_n; END IF;
END
$$;

SET search_path = eos_policy, public;
DELETE FROM role_capabilities rc USING capabilities c WHERE c.id = rc.capability_id AND c.key = 'admin.dataImport.stage';
DELETE FROM capabilities WHERE key = 'admin.dataImport.stage';
