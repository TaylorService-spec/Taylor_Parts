-- Up Migration
-- CRED VOCABULARY + DETERMINISTIC GRANT PRESERVATION. A migration, not a policy decision.
--
-- ════════════════════ WHAT WAS MEASURED, AND WHY THIS EXISTS ════════════════════
--
-- The canonical model could not express what the platform already enforces. Measured against real
-- nonprod data (271 stored CRED rows, 390 granted cells): 267 named a verb the capability vocabulary
-- had no word for. Almost all were READ -- a Role could be granted "see the Parts Catalog" through
-- `role_object_permissions`, and eos_policy.capabilities had no capability to carry that across.
--
-- ════════════════════ THE KEYS ARE NOT NEW NAMES ════════════════════
--
-- Each key below is the EXACT identifier the running system already uses, read from the Object's own
-- `capabilitiesByVerb` in policySeedSnapshot.json -- the same source `deriveObjectCred` uses to
-- decide whether a Role may read that Object today. Renaming them here would break the only evidence
-- that connects the new row to the authority it preserves. This follows migration 1757894400000's
-- rule exactly: "The ids themselves are NOT renamed. They are the enforcement vocabulary the running
-- system uses, and a cosmetic rename would break every grant while proving nothing."
--
-- NOT derived from objectKey + ".read". `part` becomes `inventory.catalog.read`, `warehouse` becomes
-- `warehouse.record.read`, `equipmentModel` becomes `equipment.compatibility.view` -- because that is
-- what each one is actually called.
--
-- ════════════════════ WHAT IS DELIBERATELY NOT HERE ════════════════════
--
-- NO DELETE CAPABILITY. Not one. Measured: `can_delete` is true in ZERO of the 271 stored rows, so
-- there is nothing to preserve and nothing to invent. Every disposition this business performs is
-- already a governed action -- cancel, void, close, deactivate.
--
-- NO GENERIC EDIT for a command-governed record. Work Order carries `can_edit` for 12 Roles, and
-- that is NOT a generic edit: it is `workOrder.transition` and the lifecycle actions, which already
-- exist. Minting `workOrder.edit` would create a second way to change a Work Order that bypasses the
-- state machine. Same for the inventory ledger, Receiving, Transfers and Inventory Adjustments --
-- all recorded as SEMANTIC_REPLACEMENT in the equivalence report, none given a CRED capability.
--
-- NO BUSINESS OR ADMIN ACTION GRANTS. The three workOrder.lifecycle.* and six workflowDefinition.*
-- capabilities stay at ZERO grants. Generic CRED evidence cannot authorize a governed action, and
-- those decisions remain the Owner's.
SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_inventory_catalog_read', 'inventory.catalog.read',
     'View the canonical Part catalog.',
     'part', 'read', 'READ', 'View Parts Catalog'),
    ('cap_inventory_transaction_read', 'inventory.transaction.read',
     'View inventory stock movements -- the quantity ledger for a part at a location.',
     'inventoryTransaction', 'read', 'READ', 'View Inventory Stock'),
    ('cap_inventory_action_read', 'inventory.action.read',
     'View inventory adjustments and the counting activity behind them.',
     'inventoryAction', 'read', 'READ', 'View Inventory Adjustments'),
    ('cap_inventory_serializedAsset_read', 'inventory.serializedAsset.read',
     'View serialized assets and their custody.',
     'serializedAssets', 'read', 'READ', 'View Serialized Assets'),
    ('cap_warehouse_transferOrder_read', 'warehouse.transferOrder.read',
     'View Transfer Orders moving stock between inventory locations.',
     'transferOrder', 'read', 'READ', 'View Transfers'),
    ('cap_warehouse_record_read', 'warehouse.record.read',
     'View governed Warehouses.',
     'warehouse', 'read', 'READ', 'View Warehouses'),
    ('cap_equipment_compatibility_view', 'equipment.compatibility.view',
     'View Equipment Models and the parts compatible with them.',
     'equipmentModel', 'read', 'READ', 'View Equipment Models'),
    ('cap_audit_event_read', 'audit.event.read',
     'Read the governed audit history.',
     'auditLog', 'read', 'READ', 'View Audit Log');

-- ════════════════════ DETERMINISTIC GRANT PRESERVATION ════════════════════
--
-- This preserves an EXISTING active authorization decision. It is not a new Owner grant.
--
-- THE EXACTNESS RULE, and why the whitelist is not lazy. `deriveObjectCred` sets a verb true when the
-- Role holds ANY of that verb's governing keys. So for an Object whose verb has SEVERAL governing
-- keys, `can_edit = true` does NOT say WHICH one the Role held -- and granting the CRED one would
-- hand out authority the Role may never have had. Five (Object, verb) pairs are ambiguous that way
-- (account.E, part.E, salesOrder.E, salesAgreement.E, inventoryTransaction.R) and are DELIBERATELY
-- absent below; they are resolvable exactly by the established grant-reconcile tool, which reads the
-- Role catalog rather than a collapsed boolean.
--
-- Two more are excluded because the governing key belongs to a DIFFERENT Object -- inventoryAction.C
-- is governed by `inventory.cycleCount.create` (Object cycleCount) and manufacturer.R by
-- `inventory.catalog.read` (Object part). A cross-object key is not a CRED grant on this Object.
--
-- What remains is 16 (Object, verb) pairs where the verb has EXACTLY ONE governing key, that key is
-- the canonical capability of the matching CRED kind, and it belongs to THIS Object. For those, the
-- stored boolean and the capability say the same thing, and the migration can carry it across.
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT
    'rc_cred_' || substr(md5(rop.tenant_id || rop.role_id || c.id), 1, 24),
    rop.tenant_id, rop.role_id, c.id,
    'migration:1761523200000', now(), 'migration:1761523200000', now(), 'migration:1761523200000', now()
  FROM role_object_permissions rop
  JOIN objects o ON o.id = rop.object_id AND o.tenant_id = rop.tenant_id
  JOIN (VALUES
        ('account',          'CREATE'),
        ('account',          'READ'),
        ('auditLog',         'READ'),
        ('equipmentModel',   'READ'),
        ('inventoryAction',  'READ'),
        ('opportunity',      'EDIT'),
        ('opportunity',      'READ'),
        ('part',             'READ'),
        ('salesAgreement',   'CREATE'),
        ('salesAgreement',   'READ'),
        ('salesOrder',       'READ'),
        ('serializedAssets', 'READ'),
        ('transferOrder',    'CREATE'),
        ('transferOrder',    'READ'),
        ('warehouse',        'READ'),
        ('workOrder',        'CREATE')
      ) AS v(object_key, kind) ON v.object_key = o.key
  JOIN capabilities c ON c.object_key = o.key AND c.action_kind = v.kind
 WHERE CASE v.kind
         WHEN 'CREATE' THEN rop.can_create
         WHEN 'READ'   THEN rop.can_read
         WHEN 'EDIT'   THEN rop.can_edit
         ELSE FALSE
       END
 ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
SET search_path = eos_policy, public;

DELETE FROM role_capabilities WHERE granted_by = 'migration:1761523200000';
DELETE FROM capabilities WHERE id IN (
    'cap_inventory_catalog_read',
    'cap_inventory_transaction_read',
    'cap_inventory_action_read',
    'cap_inventory_serializedAsset_read',
    'cap_warehouse_transferOrder_read',
    'cap_warehouse_record_read',
    'cap_equipment_compatibility_view',
    'cap_audit_event_read'
);
