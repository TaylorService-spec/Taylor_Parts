-- Up Migration
--
-- THE REORDER LIFECYCLE CAPABILITIES, REGISTERED IN THE CURRENT ADMINISTRATION MODEL (Controller ruling, 2026-09-28).
--
-- Replaces the Reorder Domain Cutover's stale capability migration (#1961 `1760313600000_reorder-lifecycle-capabilities`),
-- which was never applied to any environment and is NOT replayed: it re-inserted three keys this schema already governs
-- (reorder.request.read.queue / create.manual / create.system, migration 1761609600000) and predated the canonical
-- Object <- action metadata every capability now carries (migration 1761350400000).
--
-- WHAT THIS DOES: registers the eight Reorder business actions the existing lifecycle commands need and current main
-- did not yet govern. Each is a DISTINCT business act on its Object, never a generic write:
--
--   reorderRequest  approve               Approve a Reorder Request under review
--   reorderRequest  reject                Reject a Reorder Request under review
--   reorderRequest  startPurchasing       Start purchasing on an ASSIGNED Reorder Request
--   reorderRequest  postPurchasingUpdate  Post purchasing progress on an ASSIGNED Reorder Request
--   reorderRequest  markReceived          Close an ASSIGNED Reorder Request as received
--   reorderRequest  cancel                Cancel a Reorder Request that has not been ordered
--   reorderRequest  recordPurchaseOrder   Record the Purchase Order placed for an existing ASSIGNED Reorder Request
--                                         -- distinct from purchaseOrder.create, which is the broader purchasing act
--   purchaseOrder   void                  Void a Reorder Purchase Order
--
-- WHAT THIS DOES NOT DO: grant anything. Registration and assignment are separate decisions (ruling 2): no
-- role_capabilities or principal_capabilities row is written, and no Firebase-era holder list is reproduced. Until
-- Administration grants one, every command that requires it fails closed (CAPABILITY_REQUIRED). The assignment
-- invariant of startPurchasing / postPurchasingUpdate / markReceived / recordPurchaseOrder is enforced by the command
-- through the governed record relationship (eos_ops.reorder_request_assignments), never by a Role (ruling 4).
SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description, object_key, action_key, action_kind, display_label) VALUES
    ('cap_reorder_request_approve', 'reorder.request.approve',
     'Approve a Reorder Request under review.',
     'reorderRequest', 'approve', 'BUSINESS_ACTION', 'Approve Reorder Request'),
    ('cap_reorder_request_reject', 'reorder.request.reject',
     'Reject a Reorder Request under review.',
     'reorderRequest', 'reject', 'BUSINESS_ACTION', 'Reject Reorder Request'),
    ('cap_reorder_request_start_purchasing', 'reorder.request.startPurchasing',
     'Start purchasing on a Reorder Request assigned to the acting Employee.',
     'reorderRequest', 'startPurchasing', 'BUSINESS_ACTION', 'Start Purchasing'),
    ('cap_reorder_request_post_purchasing_update', 'reorder.request.postPurchasingUpdate',
     'Post purchasing progress (notes, vendor contact, expected availability) on a Reorder Request assigned to the acting Employee.',
     'reorderRequest', 'postPurchasingUpdate', 'BUSINESS_ACTION', 'Post Purchasing Update'),
    ('cap_reorder_request_mark_received', 'reorder.request.markReceived',
     'Close a Reorder Request assigned to the acting Employee as received.',
     'reorderRequest', 'markReceived', 'BUSINESS_ACTION', 'Mark Received'),
    ('cap_reorder_request_cancel', 'reorder.request.cancel',
     'Cancel a Reorder Request that has not yet been ordered.',
     'reorderRequest', 'cancel', 'BUSINESS_ACTION', 'Cancel Reorder Request'),
    ('cap_reorder_request_record_purchase_order', 'reorder.request.recordPurchaseOrder',
     'Record the Purchase Order placed for an existing Reorder Request assigned to the acting Employee. Grants no authority to raise an arbitrary supplier Purchase Order (that is reorder.purchaseOrder.create).',
     'reorderRequest', 'recordPurchaseOrder', 'BUSINESS_ACTION', 'Record Purchase Order'),
    ('cap_reorder_purchase_order_void', 'reorder.purchaseOrder.void',
     'Void a Reorder Purchase Order.',
     'purchaseOrder', 'void', 'BUSINESS_ACTION', 'Void Purchase Order');

-- Down Migration
--
-- REFUSES once any of the eight is granted, to a Role or a Principal: a grant is an authorization decision
-- Administration made, and a down migration must never silently revoke it.
SET search_path = eos_policy, public;

DO $$
DECLARE refs integer;
BEGIN
  SELECT (SELECT count(*) FROM role_capabilities WHERE capability_id IN (
            'cap_reorder_request_approve', 'cap_reorder_request_reject', 'cap_reorder_request_start_purchasing',
            'cap_reorder_request_post_purchasing_update', 'cap_reorder_request_mark_received', 'cap_reorder_request_cancel',
            'cap_reorder_request_record_purchase_order', 'cap_reorder_purchase_order_void'))
       + (SELECT count(*) FROM principal_capabilities WHERE capability_id IN (
            'cap_reorder_request_approve', 'cap_reorder_request_reject', 'cap_reorder_request_start_purchasing',
            'cap_reorder_request_post_purchasing_update', 'cap_reorder_request_mark_received', 'cap_reorder_request_cancel',
            'cap_reorder_request_record_purchase_order', 'cap_reorder_purchase_order_void'))
    INTO refs;
  IF refs > 0 THEN
    RAISE EXCEPTION 'migration 1763337600000 refuses to remove the Reorder lifecycle capabilities: % grant(s) reference them', refs;
  END IF;
END $$;

DELETE FROM capabilities WHERE id IN (
    'cap_reorder_request_approve', 'cap_reorder_request_reject', 'cap_reorder_request_start_purchasing',
    'cap_reorder_request_post_purchasing_update', 'cap_reorder_request_mark_received', 'cap_reorder_request_cancel',
    'cap_reorder_request_record_purchase_order', 'cap_reorder_purchase_order_void');
