-- Up Migration
-- FINANCE, ADMINISTRATION AND THE UNCONDITIONED REORDER VOCABULARY, plus exact conflict resolution.
--
-- ════════════════════ GRANTS COME FROM THE ROLE CATALOG, NOT FROM A BOOLEAN ════════════════════
--
-- Migration 1761523200000 preserved the grants it could derive EXACTLY and deliberately left 30
-- cells alone: `deriveObjectCred` sets a verb true when a Role holds ANY of that verb's governing
-- keys, so for `account.E` (two keys) the stored `can_edit` cannot say which one the Role held.
--
-- Every grant below is read from `role.permissions` in the governed Role catalog -- the same objects
-- `resolveEffectivePermission` consults -- so it says exactly which capability each Role actually
-- holds. No boolean was consulted. That is why `inventory.catalog.manage` lands on NINE Roles here
-- while the CRED projection showed a different shape: nine is what the catalog declares.
--
-- ════════════════════ FINANCE: A CAPABILITY NAMES ONE OBJECT ════════════════════
--
-- `finance.read` governed BOTH Invoices and Payments, which a canonical capability cannot do. Owner
-- ruling: split it. `finance.invoice.read` and `finance.payment.read` each go to exactly the 14
-- Roles that hold `finance.read` today -- nobody gains, nobody loses, and each Object can now show
-- its own security.
--
-- The four named Finance acts are registered AS BUSINESS ACTIONS, not as generic create/edit. An
-- Invoice is not "created" and "edited": it is ISSUED, and then ADJUSTED by a separate record.
-- Minting `invoice.create` to satisfy a CRUD column would give one business act two names.
--
-- ════════════════════ REORDER: ONLY THE UNCONDITIONED HALF ════════════════════
--
-- Three reorder keys carry a CONDITION in the Role catalog -- `reorder.purchaseOrder.read`,
-- `reorder.purchaseOrder.create` and `reorder.request.read.own` are all conditioned by
-- `operationalRoleActive`. Under the accepted ConditionKind dispositions that Kind is
-- BUSINESS_ELIGIBILITY_SCOPE: it is answered by Work Eligibility and Operational Scope and must
-- NEVER become a security condition. `role_capabilities` has no scope column and
-- `capabilitiesForRoleKeys` returns a flat set, so registering those keys here would drop the gate
-- that limits them today. They are NOT registered; the gap is reported as
-- REORDER_READ_SCOPE_MODEL_MISSING.
--
-- The three unconditioned reorder keys ARE registered, with their exact holders. Note what this
-- does NOT do: `technician` holds only `reorder.request.read.own`, so it does not appear among the
-- queue holders. That is preservation, not narrowing -- the technician's access was never the queue.
--
-- ════════════════════ STILL NOT GRANTED ════════════════════
--
-- workOrder.lifecycle.dispatch / .cancel / .complete and every workflowDefinition.* stay at ZERO.
-- No direct Principal grant is written. No DELETE capability exists anywhere, still.
SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_finance_invoice_read', 'finance.invoice.read',
     'View Invoices and accounts receivable.',
     'invoice', 'read', 'READ', 'View Invoices'),
    ('cap_finance_payment_read', 'finance.payment.read',
     'View Payments and how they were applied.',
     'payment', 'read', 'READ', 'View Payments'),
    ('cap_finance_invoice_issue', 'finance.invoice.issue',
     'Issue an Invoice, turning a draft into a receivable.',
     'invoice', 'issue', 'BUSINESS_ACTION', 'Issue Invoice'),
    ('cap_finance_adjustment_record', 'finance.adjustment.record',
     'Record an adjustment against an issued Invoice.',
     'invoice', 'recordAdjustment', 'BUSINESS_ACTION', 'Record Invoice Adjustment'),
    ('cap_finance_payment_apply', 'finance.payment.apply',
     'Apply a Payment against one or more Invoices.',
     'payment', 'apply', 'BUSINESS_ACTION', 'Apply Payment'),
    ('cap_finance_refund_record', 'finance.refund.record',
     'Record a refund against a Payment.',
     'payment', 'recordRefund', 'BUSINESS_ACTION', 'Record Refund'),
    ('cap_admin_userStatus_write', 'admin.userStatus.write',
     'Activate or deactivate an Employee account through the trusted writer.',
     'employee', 'setStatus', 'ADMIN_ACTION', 'Set Account Status'),
    ('cap_admin_credentialReset_initiate', 'admin.credentialReset.initiate',
     'Initiate a governed credential reset for an Employee account.',
     'employee', 'resetCredential', 'ADMIN_ACTION', 'Initiate Credential Reset'),
    ('cap_admin_roleAssignment_write', 'admin.roleAssignment.write',
     'Assign and revoke Security Roles through the trusted writer.',
     'rolesPermissions', 'assignRole', 'ADMIN_ACTION', 'Assign Security Roles'),
    ('cap_admin_accessRequest_decide', 'admin.accessRequest.decide',
     'Approve or reject a pending access request.',
     'rolesPermissions', 'decideAccessRequest', 'ADMIN_ACTION', 'Decide Access Requests'),
    ('cap_reorder_request_read_queue', 'reorder.request.read.queue',
     'View the Reorder Request queue.',
     'reorderRequest', 'readQueue', 'READ', 'View Reorder Queue'),
    ('cap_reorder_request_create_manual', 'reorder.request.create.manual',
     'Raise a Reorder Request by hand.',
     'reorderRequest', 'createManual', 'CREATE', 'Create Reorder Request'),
    ('cap_reorder_request_create_system', 'reorder.request.create.system',
     'Raise a Reorder Request from a system trigger.',
     'reorderRequest', 'createSystem', 'CREATE', 'Raise System Reorder Request');

-- ════════════════════ EXACT GRANTS ════════════════════
--
-- (Role key, capability key) pairs read from the governed Role catalog. Joined by Role KEY so the
-- same statement is correct in every tenant, and ON CONFLICT DO NOTHING so re-running changes
-- nothing. A pair naming a Role this tenant does not have simply matches no row.
INSERT INTO role_capabilities (id, tenant_id, role_id, capability_id, granted_by, granted_at, created_by, created_at, updated_by, updated_at)
SELECT 'rc_x_' || substr(md5(r.tenant_id || r.id || c.id), 1, 26),
       r.tenant_id, r.id, c.id,
       'migration:1761609600000', now(), 'migration:1761609600000', now(), 'migration:1761609600000', now()
  FROM (VALUES
        ('admin', 'admin.accessRequest.decide'),
        ('owner', 'admin.accessRequest.decide'),
        ('admin', 'admin.credentialReset.initiate'),
        ('owner', 'admin.credentialReset.initiate'),
        ('admin', 'admin.roleAssignment.write'),
        ('owner', 'admin.roleAssignment.write'),
        ('admin', 'admin.userStatus.write'),
        ('owner', 'admin.userStatus.write'),
        ('admin', 'customer.record.update'),
        ('dispatcher', 'customer.record.update'),
        ('generalManager', 'customer.record.update'),
        ('officeManager', 'customer.record.update'),
        ('owner', 'customer.record.update'),
        ('salesManager', 'customer.record.update'),
        ('salesperson', 'customer.record.update'),
        ('accountingManager', 'finance.adjustment.record'),
        ('admin', 'finance.adjustment.record'),
        ('controller', 'finance.adjustment.record'),
        ('financeManager', 'finance.adjustment.record'),
        ('generalManager', 'finance.adjustment.record'),
        ('owner', 'finance.adjustment.record'),
        ('partsManager', 'finance.adjustment.record'),
        ('accountingManager', 'finance.invoice.issue'),
        ('admin', 'finance.invoice.issue'),
        ('controller', 'finance.invoice.issue'),
        ('financeManager', 'finance.invoice.issue'),
        ('generalManager', 'finance.invoice.issue'),
        ('owner', 'finance.invoice.issue'),
        ('partsManager', 'finance.invoice.issue'),
        ('accountingManager', 'finance.invoice.read'),
        ('admin', 'finance.invoice.read'),
        ('controller', 'finance.invoice.read'),
        ('fieldManager', 'finance.invoice.read'),
        ('financeManager', 'finance.invoice.read'),
        ('generalManager', 'finance.invoice.read'),
        ('owner', 'finance.invoice.read'),
        ('partsAssociate', 'finance.invoice.read'),
        ('partsManager', 'finance.invoice.read'),
        ('purchasingManager', 'finance.invoice.read'),
        ('salesManager', 'finance.invoice.read'),
        ('salesperson', 'finance.invoice.read'),
        ('shopAssociate', 'finance.invoice.read'),
        ('shopManager', 'finance.invoice.read'),
        ('accountingManager', 'finance.payment.apply'),
        ('admin', 'finance.payment.apply'),
        ('controller', 'finance.payment.apply'),
        ('financeManager', 'finance.payment.apply'),
        ('generalManager', 'finance.payment.apply'),
        ('owner', 'finance.payment.apply'),
        ('accountingManager', 'finance.payment.read'),
        ('admin', 'finance.payment.read'),
        ('controller', 'finance.payment.read'),
        ('fieldManager', 'finance.payment.read'),
        ('financeManager', 'finance.payment.read'),
        ('generalManager', 'finance.payment.read'),
        ('owner', 'finance.payment.read'),
        ('partsAssociate', 'finance.payment.read'),
        ('partsManager', 'finance.payment.read'),
        ('purchasingManager', 'finance.payment.read'),
        ('salesManager', 'finance.payment.read'),
        ('salesperson', 'finance.payment.read'),
        ('shopAssociate', 'finance.payment.read'),
        ('shopManager', 'finance.payment.read'),
        ('accountingManager', 'finance.refund.record'),
        ('admin', 'finance.refund.record'),
        ('controller', 'finance.refund.record'),
        ('financeManager', 'finance.refund.record'),
        ('generalManager', 'finance.refund.record'),
        ('owner', 'finance.refund.record'),
        ('admin', 'inventory.catalog.manage'),
        ('fieldManager', 'inventory.catalog.manage'),
        ('generalManager', 'inventory.catalog.manage'),
        ('inventoryCatalogAdministrator', 'inventory.catalog.manage'),
        ('inventoryCreateExecutor', 'inventory.catalog.manage'),
        ('operationsManager', 'inventory.catalog.manage'),
        ('owner', 'inventory.catalog.manage'),
        ('partsManager', 'inventory.catalog.manage'),
        ('warehouseManager', 'inventory.catalog.manage'),
        ('accountingManager', 'inventory.transaction.read'),
        ('admin', 'inventory.transaction.read'),
        ('controller', 'inventory.transaction.read'),
        ('dispatcher', 'inventory.transaction.read'),
        ('fieldManager', 'inventory.transaction.read'),
        ('financeManager', 'inventory.transaction.read'),
        ('generalManager', 'inventory.transaction.read'),
        ('operationsManager', 'inventory.transaction.read'),
        ('owner', 'inventory.transaction.read'),
        ('partsAssociate', 'inventory.transaction.read'),
        ('partsManager', 'inventory.transaction.read'),
        ('purchasingManager', 'inventory.transaction.read'),
        ('salesManager', 'inventory.transaction.read'),
        ('salesperson', 'inventory.transaction.read'),
        ('shopAssociate', 'inventory.transaction.read'),
        ('shopManager', 'inventory.transaction.read'),
        ('warehouseAssociate', 'inventory.transaction.read'),
        ('warehouseManager', 'inventory.transaction.read'),
        ('admin', 'reorder.request.create.manual'),
        ('dispatcher', 'reorder.request.create.manual'),
        ('owner', 'reorder.request.create.manual'),
        ('partsManager', 'reorder.request.create.manual'),
        ('warehouseManager', 'reorder.request.create.manual'),
        ('admin', 'reorder.request.create.system'),
        ('dispatcher', 'reorder.request.create.system'),
        ('owner', 'reorder.request.create.system'),
        ('admin', 'reorder.request.read.queue'),
        ('dispatcher', 'reorder.request.read.queue'),
        ('operationsManager', 'reorder.request.read.queue'),
        ('owner', 'reorder.request.read.queue'),
        ('partsManager', 'reorder.request.read.queue'),
        ('purchasingManager', 'reorder.request.read.queue'),
        ('admin', 'salesAgreement.updateDraft'),
        ('dispatcher', 'salesAgreement.updateDraft'),
        ('generalManager', 'salesAgreement.updateDraft'),
        ('owner', 'salesAgreement.updateDraft'),
        ('salesManager', 'salesAgreement.updateDraft'),
        ('salesperson', 'salesAgreement.updateDraft'),
        ('admin', 'salesOrder.write'),
        ('dispatcher', 'salesOrder.write'),
        ('generalManager', 'salesOrder.write'),
        ('owner', 'salesOrder.write'),
        ('salesManager', 'salesOrder.write'),
        ('salesperson', 'salesOrder.write')
      ) AS g(role_key, capability_key)
  JOIN roles        r ON r.key = g.role_key
  JOIN capabilities c ON c.key = g.capability_key
 ON CONFLICT (tenant_id, role_id, capability_id) DO NOTHING;

-- Down Migration
SET search_path = eos_policy, public;

DELETE FROM role_capabilities WHERE granted_by = 'migration:1761609600000';
DELETE FROM capabilities WHERE id IN (
    'cap_finance_invoice_read', 'cap_finance_payment_read', 'cap_finance_invoice_issue',
    'cap_finance_adjustment_record', 'cap_finance_payment_apply', 'cap_finance_refund_record',
    'cap_admin_userStatus_write', 'cap_admin_credentialReset_initiate',
    'cap_admin_roleAssignment_write', 'cap_admin_accessRequest_decide',
    'cap_reorder_request_read_queue', 'cap_reorder_request_create_manual',
    'cap_reorder_request_create_system'
);
