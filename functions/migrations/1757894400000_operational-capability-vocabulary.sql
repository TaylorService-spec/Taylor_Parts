-- Up Migration
-- EOS Administration policy — operational capability vocabulary, P1A extension.
--
-- ============================================================================
-- MIGRATION 006. Owner ruling step 2 of docs/design/
-- eos-operational-data-plane-inventory-authority-cutover.md: "Capability authority
-- seeded/reconciled in PostgreSQL." This migration is CATALOG ONLY -- it adds the
-- capability VOCABULARY the other seven inventory-authority writer families need, the
-- same way migration 004 added the five Cycle Count keys. It grants nothing to anyone:
-- a capability catalog row is a definition, not a grant. Role -> capability grants are
-- reconciled by the SEPARATE, operator-run tool in
-- functions/src/eosOps/migration/inventoryCapabilityGrantMigration.ts, never by SQL.
--
-- STANDARD POSTGRESQL ONLY, same as 001-005.
-- ============================================================================
--
-- ════════════════════ WHERE EACH KEY COMES FROM ════════════════════
--
-- Nine of the thirteen keys below are NOT new vocabulary -- they are the EXACT capability
-- strings already checked today by six of the eight inventory-authority writers, read
-- directly from source (never inferred from documentation):
--
--   inventory.stock.receive        functions/src/inventoryReceiving/receiveInventoryStockCommand.ts:56
--   inventory.transfer.create      functions/src/inventoryTransfer/transferOrderCommand.ts:76
--   inventory.transfer.dispatch    functions/src/inventoryTransfer/transferOrderCommand.ts:77
--   inventory.transfer.receive     functions/src/inventoryTransfer/transferOrderCommand.ts:78
--   inventory.transfer.cancel      functions/src/inventoryTransfer/transferOrderCommand.ts:79
--   inventory.stock.relocate       functions/src/inventoryLocation/stockRelocationCommand.ts:50
--   inventory.placement.record     functions/src/inventoryLocation/putAwayCommand.ts:64 (Relocation's
--                                  own second-stage capability -- see the census note on multi-stage
--                                  authorization)
--   equipment.install              functions/src/equipmentInstall/installSerializedAssetCommand.ts:45
--   admin.dataImport.execute       functions/src/access/permissionCatalog.ts:1036, checked by
--                                  functions/src/dataImport/dataImportCallables.ts:363 before it calls
--                                  openingInventoryBalance.ts's ledger primitives
--
-- The remaining FOUR keys are genuinely NEW vocabulary, because direct source inspection
-- (not the design doc's table, which reads "Same injected authorize(...)" for every
-- writer) found that TWO of the eight writers are gated by a hardcoded Firestore
-- `users/{uid}.role` string check, never the capability-catalog `authorize(...)` path at
-- all:
--
--   inventory.workOrderConsumption.record
--     functions/src/updateWorkOrderExecutionData.ts:128 hardcodes `caller.role !== "technician"`
--     plus an assignedTechId ownership guard. This is the LIVE physical-consumption writer
--     (PHYSICAL_CONSUMPTION_ACTIVE = true) -- there is no existing capability key for it.
--
--   workOrder.lifecycle.dispatch / .cancel / .complete
--     functions/src/transitionEngine.ts's ACTION_PERMISSIONS matrix gates the WO transitions
--     (Dispatch, Cancel, Complete) that drive inventoryService.ts's triggerInventoryEffects()
--     -- the RESERVED / RELEASED / CONSUMED commitment writes, the previously-uncounted 8th
--     writer. Dispatch and Cancel require {admin, dispatcher}; Complete requires {technician},
--     restricted to the WO's own assigned technician. inventoryService.ts itself performs NO
--     authorization check -- its authority is entirely inherited from whichever WO action
--     fired it. Scoped to exactly these three actions, not the full ACTION_PERMISSIONS table
--     (MarkReady/Schedule/Unschedule/Accept/Travel/Arrive/WorkStart are not part of the
--     inventory-authority writer boundary and are out of this packet's scope).
--
-- Preserves, verbatim, every key an established writer already checks. Invents nothing for
-- the six writers that already have a governed capability. No writer-specific duplicate
-- permission system, and no second Role model -- these rows extend the SAME
-- eos_policy.capabilities catalog migration 004 created for Cycle Count.

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_inventory_stock_receive',
     'inventory.stock.receive',
     'Accept purchased stock into the company''s custody at a governed receiving location.'),
    ('cap_inventory_transfer_create',
     'inventory.transfer.create',
     'Create a Transfer Order moving stock between inventory locations.'),
    ('cap_inventory_transfer_dispatch',
     'inventory.transfer.dispatch',
     'Dispatch an in-transit Transfer Order toward its destination.'),
    ('cap_inventory_transfer_receive',
     'inventory.transfer.receive',
     'Accept an in-transit Transfer Order at its destination (a warehouse or a technician''s truck).'),
    ('cap_inventory_transfer_cancel',
     'inventory.transfer.cancel',
     'Cancel a Transfer Order before it is received.'),
    ('cap_inventory_stock_relocate',
     'inventory.stock.relocate',
     'Move stock between locations of the same Warehouse (floor to bin, bin to bin, bin to floor).'),
    ('cap_inventory_placement_record',
     'inventory.placement.record',
     'Record that stock was placed into a specific BIN, as Relocation''s or Put-Away''s second-stage grant.'),
    ('cap_equipment_install',
     'equipment.install',
     'Install a serialized machine at a customer location, creating the Equipment record.'),
    ('cap_admin_dataImport_execute',
     'admin.dataImport.execute',
     'Turn an approved Data Import preview into governed EOS records, including opening inventory balances.'),
    ('cap_inventory_workOrderConsumption_record',
     'inventory.workOrderConsumption.record',
     'Record Work Order execution data that decrements physical inventory (qtyUsed) at the technician''s location. Legacy authority: a hardcoded technician-role + own-assignment check, not a capability grant.'),
    ('cap_workOrder_lifecycle_dispatch',
     'workOrder.lifecycle.dispatch',
     'Transition a Work Order to DISPATCHED, opening the RESERVED inventory commitment for its planned parts.'),
    ('cap_workOrder_lifecycle_cancel',
     'workOrder.lifecycle.cancel',
     'Transition a Work Order to CANCELLED, closing its open RESERVED inventory commitment as RELEASED.'),
    ('cap_workOrder_lifecycle_complete',
     'workOrder.lifecycle.complete',
     'Transition a Work Order to COMPLETED, closing its open RESERVED inventory commitment as CONSUMED.');

-- Down Migration
SET search_path = eos_policy, public;

DELETE FROM capabilities WHERE id IN (
    'cap_inventory_stock_receive',
    'cap_inventory_transfer_create',
    'cap_inventory_transfer_dispatch',
    'cap_inventory_transfer_receive',
    'cap_inventory_transfer_cancel',
    'cap_inventory_stock_relocate',
    'cap_inventory_placement_record',
    'cap_equipment_install',
    'cap_admin_dataImport_execute',
    'cap_inventory_workOrderConsumption_record',
    'cap_workOrder_lifecycle_dispatch',
    'cap_workOrder_lifecycle_cancel',
    'cap_workOrder_lifecycle_complete'
);
