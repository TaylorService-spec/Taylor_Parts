-- Up Migration
-- THE CANONICAL OBJECT <- ACTION MAPPING. Security is governed UNDER THE OBJECT (Owner ruling).
--
-- ════════════════════ WHAT THIS ADDS, AND WHY IT IS NOT A SECOND CATALOG ════════════════════
--
-- `eos_policy.capabilities` stays the ONE capability authority and the capability KEY stays the
-- runtime identifier -- nothing here changes what any capability means or who holds it. Four
-- columns are added so the same rows can be PROJECTED two ways:
--
--     Object view   GROUP BY object_key     "Work Order -> who may Dispatch"
--     Role view     GROUP BY role           "Dispatcher -> Work Order: Create, Transition"
--
-- Before this migration there was no join between a capability and the Object it governs, which is
-- why Administration had to keep its own map (field-ops-app-vite/src/access/objectPermissionMap.js)
-- and why that map drifted to referencing 27 capabilities this table has never defined. That file
-- did NOT author anything below: every row was read from the capability's own registered
-- description and from the command that checks it. Naming prefixes were deliberately not trusted --
-- see `inventory.workOrderConsumption.record`, which is prefixed `inventory.` and governs a Work
-- Order.
--
-- ════════════════════ THE RULE THAT DECIDES object_key ════════════════════
--
-- THE OBJECT IS THE RECORD WHOSE STATE THE ACTION ADVANCES. An inventory effect is a CONSEQUENCE,
-- not the subject. This is the rule migration 1757894400000 already used in its own descriptions:
-- `workOrder.lifecycle.dispatch` is described as "Transition a Work Order to DISPATCHED, opening
-- the RESERVED inventory commitment", so its Object is the Work Order and the commitment is what
-- follows. Applied consistently, the same rule puts `inventory.workOrderConsumption.record` --
-- "Record Work Order execution data that decrements physical inventory" -- on workOrder too,
-- because the Work Order's qtyUsed is what advances and the inventory transaction is the effect.
--
-- ════════════════════ ONE KNOWN EXCEPTION, RECORDED NOT HIDDEN ════════════════════
--
-- `workOrder.lifecycle.dispatch` is ALSO checked by eosOps/workOrderAssignmentAuthority.ts, which
-- writes eos_ops.work_order_assignments -- a different record. Its registered description names
-- exactly one act ("Transition a Work Order to DISPATCHED"), so the mapping below is that one, and
-- the assignment command's reuse of the key is recorded as a defect to be resolved by giving
-- assignment its own capability. Mapping it to two Objects would make the reuse look intentional.
--
-- NO GRANTS. Not one role_capabilities row is written, read or implied here.
SET search_path = eos_policy, public;

ALTER TABLE capabilities ADD COLUMN object_key     text;
ALTER TABLE capabilities ADD COLUMN action_key     text;
ALTER TABLE capabilities ADD COLUMN action_kind    text;
ALTER TABLE capabilities ADD COLUMN display_label  text;

-- ACTION_KEY, NOT "verb": EOS governs dispatch/reconcile/publish, which no CRUD vocabulary names.
ALTER TABLE capabilities ADD CONSTRAINT capabilities_action_kind_known
    CHECK (action_kind IN ('CREATE', 'READ', 'EDIT', 'DELETE', 'BUSINESS_ACTION', 'ADMIN_ACTION'));

-- ════════════════════ WORKFLOW ADMINISTRATION VOCABULARY ════════════════════
--
-- Owner ruling: Workflow Administration becomes capability-governed. Exactly SIX keys, one per
-- configuration operation that EXISTS TODAY in adminPolicyApi.ts's closed operation list
-- (createWorkflowDraft, listWorkflows/readWorkflowVersion, updateWorkflowDefinition,
-- createWorkflowVersion, publishWorkflowVersion, setWorkflowRoleBinding).
--
-- DELIBERATELY ABSENT: execute, activate, deactivate, test, archive. Each names an operation this
-- platform does not have -- `decideWorkflowAction` has no caller, publish is one-way, and
-- `validateWorkflowVersion` has no transport. Minting a key for a button nobody can press creates
-- vocabulary that drifts, and Owner ruling forbids inventing future-plan vocabulary.
--
-- workflowInstance is registered as an Object with NO capability: its execution security must be
-- designed together with target-Object enforcement, not back-filled to populate a matrix.
INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_workflowDefinition_create', 'workflowDefinition.create',
     'Create a new Workflow Definition draft.',
     'workflowDefinition', 'create', 'CREATE', 'Create Workflow'),
    ('cap_workflowDefinition_read', 'workflowDefinition.read',
     'View Workflow Definitions and their versions, steps, actions and Role bindings.',
     'workflowDefinition', 'read', 'READ', 'View Workflows'),
    ('cap_workflowDefinition_edit', 'workflowDefinition.edit',
     'Edit a DRAFT Workflow Definition. A PUBLISHED version is immutable and the store refuses to edit it.',
     'workflowDefinition', 'edit', 'EDIT', 'Edit Workflow'),
    ('cap_workflowDefinition_version', 'workflowDefinition.version',
     'Create a new version of a Workflow Definition. In-flight instances stay pinned to the version they began under.',
     'workflowDefinition', 'version', 'ADMIN_ACTION', 'Create Workflow Version'),
    ('cap_workflowDefinition_publish', 'workflowDefinition.publish',
     'Publish a Workflow Definition version, making it the definition new instances begin under.',
     'workflowDefinition', 'publish', 'ADMIN_ACTION', 'Publish Workflow'),
    ('cap_workflowDefinition_bindRole', 'workflowDefinition.bindRole',
     'Bind a Security Role to a workflow action. A binding NARROWS who may attempt an action; it never widens target Object authority.',
     'workflowDefinition', 'bindRole', 'ADMIN_ACTION', 'Bind Workflow Roles');

-- ════════════════════ BACKFILL: every pre-existing capability, explicitly ════════════════════
UPDATE capabilities AS c
   SET object_key    = m.object_key,
       action_key    = m.action_key,
       action_kind   = m.action_kind,
       display_label = m.display_label
  FROM (VALUES
    -- ── Account (CRM customer record) ──
    ('customer.record.create',                'account',            'create',              'CREATE',          'Create Customer'),
    ('customer.record.read',                  'account',            'read',                'READ',            'View Customers'),
    ('customer.record.update',                'account',            'edit',                'EDIT',            'Edit Customer'),
    ('customer.governedField.write',          'account',            'editGovernedField',   'BUSINESS_ACTION', 'Edit Governed Customer Fields'),
    -- ── Employee (workforce record; NOT the Principal) ──
    ('employee.record.read',                  'employee',           'read',                'READ',            'View Employees'),
    ('admin.employeeProfile.write',           'employee',           'edit',                'EDIT',            'Edit Employee Profile'),
    ('admin.employeeJobRole.write',           'employee',           'assignJobRole',       'ADMIN_ACTION',    'Assign Job Role'),
    ('admin.employeeWorkEligibility.write',   'employee',           'setWorkEligibility',  'ADMIN_ACTION',    'Set Work Eligibility'),
    ('admin.employeeOperationalScope.write',  'employee',           'setOperationalScope', 'ADMIN_ACTION',    'Set Operational Scope'),
    -- ── Principal (security actor; NOT the Employee) ──
    ('admin.principalAccess.read',            'principal',          'read',                'READ',            'View Principal Access'),
    -- ── Parts catalog ──
    ('inventory.catalog.manage',              'part',               'edit',                'EDIT',            'Manage Part Catalog'),
    ('inventory.catalog.activate',            'part',               'activate',            'BUSINESS_ACTION', 'Activate Part'),
    -- ── Equipment ──
    ('equipment.model.manage',                'equipmentModel',     'edit',                'EDIT',            'Manage Equipment Models'),
    ('equipment.install',                     'equipment',          'install',             'BUSINESS_ACTION', 'Install Equipment'),
    -- ── Cycle Count ──
    ('inventory.cycleCount.create',           'cycleCount',         'create',              'CREATE',          'Create Cycle Count'),
    ('inventory.cycleCount.submit',           'cycleCount',         'submit',              'BUSINESS_ACTION', 'Submit Cycle Count'),
    ('inventory.cycleCount.reconcile',        'cycleCount',         'reconcile',           'BUSINESS_ACTION', 'Reconcile Cycle Count'),
    ('inventory.cycleCount.close',            'cycleCount',         'close',               'BUSINESS_ACTION', 'Close Cycle Count'),
    ('inventory.cycleCount.cancel',           'cycleCount',         'cancel',              'BUSINESS_ACTION', 'Cancel Cycle Count'),
    -- ── Transfer Order ──
    ('inventory.transfer.create',             'transferOrder',      'create',              'CREATE',          'Create Transfer'),
    ('inventory.transfer.dispatch',           'transferOrder',      'dispatch',            'BUSINESS_ACTION', 'Dispatch Transfer'),
    ('inventory.transfer.receive',            'transferOrder',      'receive',             'BUSINESS_ACTION', 'Receive Transfer'),
    ('inventory.transfer.cancel',             'transferOrder',      'cancel',              'BUSINESS_ACTION', 'Cancel Transfer'),
    -- ── Receiving ──
    ('inventory.stock.receive',               'receivingOrder',     'receive',             'BUSINESS_ACTION', 'Receive Stock'),
    -- ── Inventory Stock (movement of stock between locations and bins) ──
    -- NOT `stockLocation`: the Owner retired stock_locations as an operational authority on
    -- 2026-09-12, and its entity left the registry precisely so nobody would be invited to
    -- configure access to a collection with no writer. Both of these commands write an inventory
    -- movement -- stockRelocationCommand.ts imports INVENTORY_TRANSACTIONS_COLLECTION, and
    -- putAwayCommand.ts records the placement -- so the record whose state advances is the stock.
    ('inventory.stock.relocate',              'inventoryTransaction', 'relocate',          'BUSINESS_ACTION', 'Relocate Stock'),
    ('inventory.placement.record',            'inventoryTransaction', 'recordPlacement',   'BUSINESS_ACTION', 'Record Bin Placement'),
    -- ── Work Order ──
    ('workOrder.create',                      'workOrder',          'create',              'CREATE',          'Create Work Order'),
    ('workOrder.transition',                  'workOrder',          'transition',          'BUSINESS_ACTION', 'Advance Work Order'),
    ('workOrder.lifecycle.dispatch',          'workOrder',          'dispatch',            'BUSINESS_ACTION', 'Dispatch Work Order'),
    ('workOrder.lifecycle.cancel',            'workOrder',          'cancel',              'BUSINESS_ACTION', 'Cancel Work Order'),
    ('workOrder.lifecycle.complete',          'workOrder',          'complete',            'BUSINESS_ACTION', 'Complete Work Order'),
    ('inventory.workOrderConsumption.record', 'workOrder',          'recordConsumption',   'BUSINESS_ACTION', 'Record Parts Used'),
    -- ── Opportunity ──
    ('opportunity.read',                      'opportunity',        'read',                'READ',            'View Opportunities'),
    ('opportunity.write',                     'opportunity',        'edit',                'EDIT',            'Edit Opportunity'),
    ('opportunity.createSalesOrder',          'opportunity',        'createSalesOrder',    'BUSINESS_ACTION', 'Create Sales Order from Opportunity'),
    -- ── Sales Order ──
    ('salesOrder.read',                       'salesOrder',         'read',                'READ',            'View Sales Orders'),
    ('salesOrder.write',                      'salesOrder',         'edit',                'EDIT',            'Edit Sales Order'),
    -- ── Sales Agreement ──
    ('salesAgreement.create',                 'salesAgreement',     'create',              'CREATE',          'Create Sales Agreement'),
    ('salesAgreement.read',                   'salesAgreement',     'read',                'READ',            'View Sales Agreements'),
    ('salesAgreement.updateDraft',            'salesAgreement',     'edit',                'EDIT',            'Edit Draft Sales Agreement'),
    ('salesAgreement.accept',                 'salesAgreement',     'accept',              'BUSINESS_ACTION', 'Accept Sales Agreement'),
    -- ── Reorder Request ──
    ('reorder.request.assign',                'reorderRequest',     'assign',              'BUSINESS_ACTION', 'Assign Reorder Request'),
    -- ── Data Import (Administration tooling; NONPROD-only, retirement tracked separately) ──
    ('admin.dataImport.execute',              'dataImport',         'execute',             'ADMIN_ACTION',    'Execute Data Import')
  ) AS m(key, object_key, action_key, action_kind, display_label)
 WHERE c.key = m.key;

-- THE DRIFT GUARD, enforced by the database rather than by review. A capability row that arrives
-- without its Object and action cannot be inserted at all, so a future migration cannot quietly
-- add a key that Administration then cannot project.
ALTER TABLE capabilities ALTER COLUMN object_key    SET NOT NULL;
ALTER TABLE capabilities ALTER COLUMN action_key    SET NOT NULL;
ALTER TABLE capabilities ALTER COLUMN action_kind   SET NOT NULL;
ALTER TABLE capabilities ALTER COLUMN display_label SET NOT NULL;

-- One Object may not name the same action twice: two rows meaning "Cancel Work Order" is exactly
-- the workOrder.cancel / workOrder.lifecycle.cancel duplication the Owner refused.
CREATE UNIQUE INDEX capabilities_object_action_unique ON capabilities (object_key, action_key);

-- Down Migration
SET search_path = eos_policy, public;

DROP INDEX IF EXISTS capabilities_object_action_unique;
DELETE FROM capabilities WHERE id IN (
    'cap_workflowDefinition_create',
    'cap_workflowDefinition_read',
    'cap_workflowDefinition_edit',
    'cap_workflowDefinition_version',
    'cap_workflowDefinition_publish',
    'cap_workflowDefinition_bindRole'
);
ALTER TABLE capabilities DROP CONSTRAINT IF EXISTS capabilities_action_kind_known;
ALTER TABLE capabilities DROP COLUMN IF EXISTS display_label;
ALTER TABLE capabilities DROP COLUMN IF EXISTS action_kind;
ALTER TABLE capabilities DROP COLUMN IF EXISTS action_key;
ALTER TABLE capabilities DROP COLUMN IF EXISTS object_key;
