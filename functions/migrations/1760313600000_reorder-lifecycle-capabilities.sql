-- Up Migration
-- REORDER LIFECYCLE CAPABILITIES, REGISTERED -- phase 5 of the Reorder Domain Cutover.
--
-- ============================================================================
-- MIGRATION 036. The PostgreSQL capability vocabulary gains the Reorder lifecycle capabilities that
-- ALREADY EXIST in access/permissionCatalog.ts and are already held by the Roles that should hold
-- them. NOT ONE IS NEW.
-- ============================================================================
--
-- ════════════════════ REGISTRATION IS NOT A GRANT ════════════════════
--
-- Who holds these still comes from the Role catalog through the existing reconciliation. Registering
-- a capability here says only that a PostgreSQL-governed command may now ask whether the caller
-- holds it -- which nothing could ask before, because nothing governed by PostgreSQL performed a
-- Reorder lifecycle action.
--
-- Inventing new keys because the Reorder object moved database would split each authority in two and
-- leave a reviewer asking which one really governs the action. That is the same reasoning migration
-- 1760140800000 gave for reusing `reorder.request.assign`, and the same answer applies to the other
-- nine.

SET search_path = eos_policy, public;

INSERT INTO capabilities (id, key, description) VALUES
    ('cap_reorder_request_create_manual', 'reorder.request.create.manual',
     'Raise a Reorder Request by hand, stating the requested quantity.'),
    ('cap_reorder_request_create_system', 'reorder.request.create.system',
     'Raise a Reorder Request from a system recommendation rather than by hand.'),
    ('cap_reorder_request_approve', 'reorder.request.approve',
     'Approve a Reorder Request under review.'),
    ('cap_reorder_request_reject', 'reorder.request.reject',
     'Reject a Reorder Request under review.'),
    ('cap_reorder_request_start_purchasing', 'reorder.request.startPurchasing',
     'Begin purchasing work on an assigned Reorder Request.'),
    ('cap_reorder_request_post_update', 'reorder.request.postPurchasingUpdate',
     'Record purchasing progress against a Reorder Request: notes, vendor contact and expected availability.'),
    ('cap_reorder_request_mark_received', 'reorder.request.markReceived',
     'Close out a Reorder Request as received.'),
    ('cap_reorder_request_cancel', 'reorder.request.cancel',
     'Cancel a Reorder Request that has not yet been ordered.'),
    ('cap_reorder_request_read_queue', 'reorder.request.read.queue',
     'Read the Reorder Request queue across assignees.'),
    ('cap_reorder_request_read_own', 'reorder.request.read.own',
     'Read the Reorder Requests assigned to the calling Employee. Scoped by the governed Employee assignment authority, never by a Firebase uid.');

-- Down Migration
SET search_path = eos_policy, public;

DELETE FROM role_capabilities WHERE capability_id IN (
    'cap_reorder_request_create_manual', 'cap_reorder_request_create_system',
    'cap_reorder_request_approve', 'cap_reorder_request_reject',
    'cap_reorder_request_start_purchasing', 'cap_reorder_request_post_update',
    'cap_reorder_request_mark_received', 'cap_reorder_request_cancel',
    'cap_reorder_request_read_queue', 'cap_reorder_request_read_own');

DELETE FROM capabilities WHERE id IN (
    'cap_reorder_request_create_manual', 'cap_reorder_request_create_system',
    'cap_reorder_request_approve', 'cap_reorder_request_reject',
    'cap_reorder_request_start_purchasing', 'cap_reorder_request_post_update',
    'cap_reorder_request_mark_received', 'cap_reorder_request_cancel',
    'cap_reorder_request_read_queue', 'cap_reorder_request_read_own');
