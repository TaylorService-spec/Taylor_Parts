-- Up Migration
-- GRANT-1 OWNER POLICY GRANTS (Owner decisions A1, A2, A3, A4, A7, 2026-10-19), nonprod. GRANT-BEARING (Owner ruling E): roleCapabilityAuthorityBaseline.json carries the same pairs.
--
-- OWNER AUTHORIZATION (2026-10-19): the policy grants below, exactly. No production permission change is authorized; production is promoted only by its own ruling.
--   A1  Parts Managers activate and deactivate Parts and Manufacturers, WITHOUT also gaining Supplier status. Part and Manufacturer status move from inventory.catalog.activate to a NEW key,
--       inventory.catalog.part.activate (registered here, PostgreSQL-native: absent from the in-repo PERMISSION_CATALOG, whose compiled admin Role composes the whole catalog). It is granted to
--       partsManager AND to every current holder of inventory.catalog.activate (admin), so nobody loses part or manufacturer activation. inventory.catalog.activate keeps its holders and now
--       governs Supplier status only (eosOps/supplierAdministration.ts).
--   A2  inventory.stock.receive and receivingOrder.record.read -> partsAssociate, warehouseAssociate (a holder of receive also holds the receipt read, ruling B). The WAREHOUSE operational scope,
--       company authority and the Employee link are still required per call.
--   A3a ownership.handoff.correct -> salesManager, generalManager (the administrative handoff sources also now require a stated reason, in code).
--   A3b serviceInboundWorkReviewer -> inboundWork.request.read / .accept / .decline / .attach, workOrder.create and workOrder.record.read (the read so the new create grant adds no edit-without-read row).
--   A4  equipment.model.manage and inventory.catalog.read -> warehouseManager, generalManager, fieldManager, partsManager. The four inventory.catalog.read pairs are already held (migration
--       1761523200000): ON CONFLICT skips them, so this migration writes 4 of the 8.
--   A7  the 12 verified Firebase purchasing-parity pairs (docs/architecture/grant1-owner-policy-grants.json, derived from the Firebase catalogs): admin, dispatcher, purchasingManager hold
--       reorder.request.startPurchasing / .postPurchasingUpdate / .recordPurchaseOrder; generalManager holds .postPurchasingUpdate; admin and inventoryStockRelocationOperator hold
--       inventory.catalog.alias.read. Technicians are EXCLUDED (the Firebase grant was conditioned); the four keys leave ADMINISTRATION_GRANT_ONLY_CAPABILITIES in the same change and the three
--       technician pairs are fenced pair-level in CATALOG_DECLARATIONS_WITHOUT_SYSTEM_DEFAULT, so a reconcile never re-imports them.
--
-- 1 capability + 30 NEW grants (A1 2, A2 4, A3a 2, A3b 6, A4 4, A7 12). Evidence: docs/architecture/grant1-owner-policy-grants.json; functions/test/grant1OwnerPolicyGrants.test.mjs proves the VALUES below
-- equal the evidence and the baseline, and that no other Role gains a pair.
-- An Administration ADMIN_REVOKED decision is honoured (never re-granted), as in every grant migration since B1; the protected Roles (admin, owner) are matched only as the protected rows.
-- Drafted by the GRANT-1 lane; reviewed and written into the repository by the controller under the Owner's 2026-10-19 authorization (agents cannot write migrations directly -- the B4 pattern).
-- Pre-write checks (nonprod, read-only): no direct (Principal) grant of inventory.catalog.activate exists; (part, changeStatus) is unused; P-1 migration 1764660000000 is applied.
SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_catalog_part_activate', 'inventory.catalog.part.activate',
     'Change the status of a Part or a Manufacturer (activate, deactivate, discontinue). Split from inventory.catalog.activate (GRANT-1 A1), which now governs Supplier status only. Confers no create or edit (inventory.catalog.manage) and no Supplier status.',
     'part', 'changeStatus', 'BUSINESS_ACTION', 'Change Part and Manufacturer Status')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_g1_' || substr(md5(r.tenant_id || r.id || c.id), 1, 25),
       r.tenant_id, r.id, c.id,
       'migration:1764670000000', now(), 'migration:1764670000000', now(), 'migration:1764670000000', now()
  FROM capabilities c
  JOIN (VALUES
        -- A1: the new Part / Manufacturer status key (admin = every current holder of inventory.catalog.activate; partsManager = the Owner's grant)
        ('admin', 'inventory.catalog.part.activate'), ('partsManager', 'inventory.catalog.part.activate'),
        -- A2: ordinary receiving through the job Roles
        ('partsAssociate', 'inventory.stock.receive'), ('warehouseAssociate', 'inventory.stock.receive'),
        ('partsAssociate', 'receivingOrder.record.read'), ('warehouseAssociate', 'receivingOrder.record.read'),
        -- A3a: administrative ownership-handoff corrections
        ('salesManager', 'ownership.handoff.correct'), ('generalManager', 'ownership.handoff.correct'),
        -- A3b: designated service intake
        ('serviceInboundWorkReviewer', 'inboundWork.request.read'), ('serviceInboundWorkReviewer', 'inboundWork.request.accept'),
        ('serviceInboundWorkReviewer', 'inboundWork.request.decline'), ('serviceInboundWorkReviewer', 'inboundWork.request.attach'),
        ('serviceInboundWorkReviewer', 'workOrder.create'), ('serviceInboundWorkReviewer', 'workOrder.record.read'),
        -- A4: equipment model management (4 new) plus catalog read (4 already held by migration 1761523200000: skipped by ON CONFLICT)
        ('warehouseManager', 'equipment.model.manage'), ('generalManager', 'equipment.model.manage'),
        ('fieldManager', 'equipment.model.manage'), ('partsManager', 'equipment.model.manage'),
        ('warehouseManager', 'inventory.catalog.read'), ('generalManager', 'inventory.catalog.read'),
        ('fieldManager', 'inventory.catalog.read'), ('partsManager', 'inventory.catalog.read'),
        -- A7: verified Firebase purchasing parity (technicians excluded)
        ('admin', 'reorder.request.startPurchasing'), ('admin', 'reorder.request.postPurchasingUpdate'),
        ('admin', 'reorder.request.recordPurchaseOrder'), ('admin', 'inventory.catalog.alias.read'),
        ('dispatcher', 'reorder.request.startPurchasing'), ('dispatcher', 'reorder.request.postPurchasingUpdate'),
        ('dispatcher', 'reorder.request.recordPurchaseOrder'),
        ('purchasingManager', 'reorder.request.startPurchasing'), ('purchasingManager', 'reorder.request.postPurchasingUpdate'),
        ('purchasingManager', 'reorder.request.recordPurchaseOrder'),
        ('generalManager', 'reorder.request.postPurchasingUpdate'), ('inventoryStockRelocationOperator', 'inventory.catalog.alias.read')
       ) AS g(role_key, capability_key) ON g.capability_key = c.key
  JOIN roles r ON r.key = g.role_key AND (r.key NOT IN ('owner', 'admin') OR r.protected = TRUE)
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = c.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- A1, "every current holder": any OTHER Role that holds inventory.catalog.activate in a tenant (an Administration grant the repository does not know) keeps Part and Manufacturer status.
-- Zero rows in a clean rebuild (admin's holding is applied after the migrations) and in a database where admin is the only holder; the same protected-Role and ADMIN_REVOKED rules apply.
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_g1_' || substr(md5(r.tenant_id || r.id || n.id), 1, 25),
       r.tenant_id, r.id, n.id,
       'migration:1764670000000', now(), 'migration:1764670000000', now(), 'migration:1764670000000', now()
  FROM role_capabilities h
  JOIN capabilities o ON o.id = h.capability_id AND o.key = 'inventory.catalog.activate'
  JOIN capabilities n ON n.key = 'inventory.catalog.part.activate'
  JOIN roles r ON r.id = h.role_id AND r.tenant_id = h.tenant_id AND (r.key NOT IN ('owner', 'admin') OR r.protected = TRUE)
 WHERE NOT EXISTS (SELECT 1 FROM role_capability_decisions d
                    WHERE d.tenant_id = r.tenant_id AND d.role_key = r.key AND d.capability_key = n.key
                      AND d.superseded_at IS NULL AND d.decision = 'ADMIN_REVOKED')
ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
DO $$
DECLARE v_n integer;
BEGIN
    -- An Administration decision about the new key, or about a pair this migration wrote, is a decision the reversal must not erase.
    SELECT count(*) INTO v_n FROM eos_policy.role_capability_decisions d
     WHERE d.superseded_at IS NULL
       AND (d.capability_key = 'inventory.catalog.part.activate'
            OR EXISTS (SELECT 1 FROM eos_policy.role_capabilities rc
                         JOIN eos_policy.roles r ON r.id = rc.role_id
                         JOIN eos_policy.capabilities c ON c.id = rc.capability_id
                        WHERE rc.granted_by = 'migration:1764670000000' AND r.tenant_id = d.tenant_id AND r.key = d.role_key AND c.key = d.capability_key));
    IF v_n > 0 THEN RAISE EXCEPTION 'GRANT1_OWNER_POLICY_GRANTS: refuses to reverse -- % Administration decision(s) name the new key or a pair this migration wrote', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.principal_capabilities pc
      JOIN eos_policy.capabilities c ON c.id = pc.capability_id WHERE c.key = 'inventory.catalog.part.activate';
    IF v_n > 0 THEN RAISE EXCEPTION 'GRANT1_OWNER_POLICY_GRANTS: refuses to reverse -- inventory.catalog.part.activate is held by % direct grant(s)', v_n; END IF;
    SELECT count(*) INTO v_n FROM eos_policy.role_capabilities rc
      JOIN eos_policy.capabilities c ON c.id = rc.capability_id
     WHERE c.key = 'inventory.catalog.part.activate' AND rc.granted_by <> 'migration:1764670000000';
    IF v_n > 0 THEN RAISE EXCEPTION 'GRANT1_OWNER_POLICY_GRANTS: refuses to reverse -- inventory.catalog.part.activate is held by % Role grant(s) this migration did not write', v_n; END IF;
END
$$;

DELETE FROM eos_policy.role_capabilities WHERE granted_by = 'migration:1764670000000';
DELETE FROM eos_policy.capabilities WHERE key = 'inventory.catalog.part.activate';
